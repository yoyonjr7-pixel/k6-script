// Spike test: how does the site behave when traffic jumps without warning?
//
//   k6 run k6/spike-test.js
//
// Simulates a sudden burst — e.g. a announcement going out, or parents all
// checking the school site at once. Load goes from near-zero to the spike level
// in seconds, holds briefly, then drops back. Watch for a spike in latency and
// 5xx errors at the top, and check how quickly the site recovers afterwards.

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
import { makeSummaryHandler, randomIntBetween, requestPage } from './lib.js';

const SPIKE_VUS = Number(__ENV.K6_SPIKE_VUS || 200);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 1,
      exec: 'spike',
      stages: [
        { duration: '20s', target: 5 }, // quiet baseline
        { duration: '10s', target: SPIKE_VUS }, // the spike hits
        { duration: '30s', target: SPIKE_VUS }, // hold under pressure
        { duration: '15s', target: 5 }, // recovery
        { duration: '30s', target: 5 }, // observe post-spike stability
        { duration: '10s', target: 0 },
      ],
    },
  },

  // Thresholds are relaxed versus the load test: a spike is expected to hurt.
  // What matters is that it does not fall over completely.
  thresholds: {
    http_req_failed: ['rate<0.10'], // under 10% failures even at the peak
    checks: ['rate>0.85'],
    page_check_success: ['rate>0.85'],
  },

  maxRedirects: 5,
};

export function handleSummary(data) {
  return makeSummaryHandler('spike')(data);
}

export function spike() {
  const baseParams = { headers: HEADERS, timeout: TIMEOUTS };
  const page = pickWeightedPage();
  requestPage(page.path, `spike:${page.name}`, baseParams);

  if (LOAD_ASSETS) {
    http.batch([
      ['GET', url(ASSETS.css[0]), null, { ...baseParams, tags: { name: 'css-bootstrap' } }],
      ['GET', url(ASSETS.css[1]), null, { ...baseParams, tags: { name: 'css-navbar' } }],
    ]);
  }

  // Short think time: spikes come from impatient visitors refreshing.
  sleep(randomIntBetween(1, 3));
}
