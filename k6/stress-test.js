// Stress test: find the breaking point and how the site recovers.
//
//   k6 run k6/stress-test.js
//
// Pushes load well past what the load test uses, in steps, until errors appear
// or latency collapses. The final ramp-down stage tells you whether the server
// recovers on its own or stays degraded.
//
// WARNING: this deliberately drives the site past its limits. Run it against a
// staging environment if you have one, keep it short, and only test sites you
// own or are authorised to test.

import http from 'k6/http';
import { sleep } from 'k6';

import {
  ASSETS,
  HEADERS,
  LOAD_ASSETS,
  TIMEOUTS,
  pickWeightedPage,
  url,
} from './config.js';
import { makeSummaryHandler, requestPage } from './lib.js';

const MAX_VUS = Number(__ENV.K6_MAX_VUS || 250);

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 10,
      exec: 'stress',
      stages: [
        { duration: '1m', target: 30 }, // baseline
        { duration: '1m', target: 60 }, // step up
        { duration: '1m', target: 100 }, // step up
        { duration: '1m', target: Math.round(MAX_VUS * 0.6) }, // step up
        { duration: '1m', target: MAX_VUS }, // approaching the limit
        { duration: '2m', target: MAX_VUS }, // hold at the limit
        { duration: '1m', target: 0 }, // recovery: does it bounce back?
      ],
    },
  },

  // No latency thresholds here — a stress test is expected to breach them.
  // The abort conditions below stop the run before it becomes abusive.
  thresholds: {
    http_req_failed: [
      // Stop the test if more than 20% of requests are failing.
      { threshold: 'rate<0.2', abortOnFail: true, delayAbortEval: '10s' },
    ],
  },

  maxRedirects: 5,
};

export function handleSummary(data) {
  return makeSummaryHandler('stress')(data);
}

export function stress() {
  const baseParams = { headers: HEADERS, timeout: TIMEOUTS };

  // Minimal think time: the goal is maximum pressure, not realistic browsing.
  const page = pickWeightedPage();
  requestPage(page.path, `stress:${page.name}`, baseParams);

  if (LOAD_ASSETS) {
    http.batch([
      ['GET', url(ASSETS.css[0]), null, { ...baseParams, tags: { name: 'css-bootstrap' } }],
      ['GET', url(ASSETS.js[0]), null, { ...baseParams, tags: { name: 'js-animations' } }],
    ]);
  }

  sleep(0.1);
}
