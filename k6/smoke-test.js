// Smoke test: is the site up and are all routes healthy?
//
//   k6 run k6/smoke-test.js
//
// Tiny (1 VU, a handful of iterations), so it is safe to run at any time and
// ideal for CI or a quick sanity check before a bigger test.

import { sleep } from 'k6';

import { HEADERS, PAGES, TIMEOUTS } from './config.js';
import { makeSummaryHandler, requestPage } from './lib.js';

export const options = {
  vus: 1,
  iterations: PAGES.length,
  maxRedirects: 5,
  thresholds: {
    // Every route must be healthy — no tolerance on a smoke test.
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    page_check_success: ['rate==1'],
  },
};

export function handleSummary(data) {
  return makeSummaryHandler('smoke')(data);
}

export default function () {
  // __ITER walks the route list once, in order, so every page is verified.
  const page = PAGES[__ITER % PAGES.length];
  requestPage(page.path, `smoke:${page.name}`, {
    headers: HEADERS,
    timeout: TIMEOUTS,
  });
  sleep(0.2);
}
