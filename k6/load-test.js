// Main load test for https://smkdarmasiswa1.my.id
//
//   k6 run k6/load-test.js
//
// Profile: gradual ramp-up to a sustained plateau, then ramp-down. This is the
// classic "load test" shape — it answers "can the site hold this traffic level
// without degrading?" rather than "where does it break?" (see stress-test.js).
//
// Heavier run, from PowerShell:
//   $env:K6_PEAK_VUS="150"; $env:K6_PLATEAU="5m"; k6 run k6/load-test.js

import http from 'k6/http';
import { sleep } from 'k6';

import {
  ASSETS,
  HEADERS,
  LOAD_ASSETS,
  PAGES,
  THINK_TIME,
  TIMEOUTS,
  pickWeightedPage,
  url,
} from './config.js';
import { buildThresholds, makeSummaryHandler, randomIntBetween, requestPage } from './lib.js';

const PEAK_VUS = Number(__ENV.K6_PEAK_VUS || 50);
const PLATEAU = __ENV.K6_PLATEAU || '2m';

export const options = {
  scenarios: {
    browsing: {
      executor: 'ramping-vus',
      startVUs: 0,
      exec: 'browsing',
      stages: [
        { duration: '30s', target: 15 }, // warm-up: confirm the site accepts traffic
        { duration: '30s', target: 35 }, // first step
        { duration: '1m', target: 35 }, // settle and observe
        { duration: '30s', target: PEAK_VUS }, // push to peak
        { duration: PLATEAU, target: PEAK_VUS }, // sustained load
        { duration: '30s', target: 0 }, // ramp down
      ],
    },
  },

  thresholds: buildThresholds({
    extra: {
      // Per-page latency budget, separate from the global http_req_duration.
      html_duration_ms: ['p(95)<4000'],
      timeout_errors: ['count==0'],
    },
  }),

  // Stop hammering a site that is clearly failing.
  insecureSkipTLSVerify: false,
  maxRedirects: 5,
  setupTimeout: '60s',
};

export function handleSummary(data) {
  return makeSummaryHandler('load')(data);
}

/** Warm-up request so the first measured virtual user does not hit a cold cache. */
export function setup() {
  const res = requestPage('/', 'setup-warmup');
  return { reachable: res.status === 200 };
}

export function browsing() {
  const baseParams = { headers: HEADERS, timeout: TIMEOUTS };

  // Landing page — every session starts somewhere.
  const landing = pickWeightedPage();
  requestPage(landing.path, `landing:${landing.name}`, baseParams);

  // A browser does not render HTML alone: pull the assets in parallel.
  if (LOAD_ASSETS) {
    http.batch([
      ['GET', url(ASSETS.css[0]), null, { ...baseParams, tags: { name: 'css-bootstrap' } }],
      ['GET', url(ASSETS.css[1]), null, { ...baseParams, tags: { name: 'css-navbar' } }],
      ['GET', url(ASSETS.js[0]), null, { ...baseParams, tags: { name: 'js-animations' } }],
      ['GET', url(ASSETS.images[0]), null, { ...baseParams, tags: { name: 'img-logo' } }],
    ]);
  }

  const pagesThisVisit = randomIntBetween(2, 5);
  for (let i = 0; i < pagesThisVisit; i++) {
    // Human think time between navigations.
    sleep(randomIntBetween(THINK_TIME.min, THINK_TIME.max));

    const page = pickWeightedPage();
    const res = requestPage(page.path, `visit:${page.name}`, baseParams);

    // Some visitors click through immediately after a page loads.
    if (res.status === 200 && Math.random() < 0.3) {
      const follow = PAGES[Math.floor(Math.random() * PAGES.length)];
      requestPage(follow.path, `follow:${follow.name}`, {
        ...baseParams,
        headers: { ...HEADERS, Referer: url(page.path) },
      });
    }
  }

  // Time on the last page before the session ends.
  sleep(randomIntBetween(THINK_TIME.min, THINK_TIME.max));
}
