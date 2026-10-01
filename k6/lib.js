// Shared thresholds, custom metrics, and the handleSummary reporter.
import { Counter, Trend, Rate } from 'k6/metrics';
import { check } from 'k6';
import http from 'k6/http';
import { BASE_URL, CONTENT_MARKERS, PAGES, RESULTS_DIR, SLO } from './config.js';

// Extra metrics beyond the built-in ones, tagged per route so the summary can
// break down latency by page.
export const htmlTtfb = new Trend('html_ttfb_ms', true);
export const htmlDuration = new Trend('html_duration_ms', true);
export const htmlSize = new Trend('html_size_bytes');
export const pageChecks = new Rate('page_check_success');
export const serverErrors = new Counter('server_errors');
export const timeoutErrors = new Counter('timeout_errors');

/**
 * Fetch a page and assert it is a healthy, real response.
 * Returns the k6 response object so callers can reuse params for a second hop.
 */
export function requestPage(path, name, params = {}) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: { 'Cache-Control': 'no-cache' },
    ...params,
    tags: { name, route: path, ...params.tags },
  });

  const ok = check(
    res,
    {
      'status is 200': (r) => r.status === 200,
      'no server error': (r) => r.status < 500,
      'html content-type': (r) =>
        String(r.headers['Content-Type'] || '').includes('text/html'),
      'body contains site identity': (r) =>
        CONTENT_MARKERS.some((m) => String(r.body || '').includes(m)),
      'body is non-trivial': (r) => String(r.body || '').length > 500,
      'responded within 5s': (r) => r.timings.duration < 5000,
    },
    { name: `page:${name}` }
  );

  pageChecks.add(ok);
  htmlTtfb.add(res.timings.waiting);
  htmlDuration.add(res.timings.duration);
  htmlSize.add(res.body ? res.body.length : 0);

  if (res.status >= 500) serverErrors.add(1);
  if (res.error && /timeout/i.test(res.error)) timeoutErrors.add(1);

  return res;
}

/**
 * Inclusive random integer between min and max. Kept local so the tests have no
 * runtime dependency on remote jslib modules.
 */
export function randomIntBetween(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** Fetch a static asset. Softer checks: assets are not expected to be HTML. */
export function requestAsset(path, name, params = {}) {
  const res = http.get(`${BASE_URL}${path}`, {
    ...params,
    tags: { name, route: path, asset: 'true', ...params.tags },
  });
  check(
    res,
    { 'asset served': (r) => r.status === 200 || r.status === 304 },
    { name: `asset:${name}` }
  );
  if (res.status >= 500) serverErrors.add(1);
  return res;
}

/**
 * Thresholds applied to every run. A breach marks the test as failed, which is
 * how you turn a load test into an automated regression gate in CI.
 *
 * k6 only surfaces a metric's per-tag breakdown in handleSummary when a
 * threshold references that tag. So we emit one per-route latency threshold:
 * it doubles as a real per-endpoint SLO and unlocks the "slowest routes" table.
 */
export function buildThresholds(overrides = {}) {
  const t = {
    http_req_duration: [
      `p(95)<${SLO.p95HtmlMs}`,
      `p(99)<${SLO.p99HtmlMs}`,
      ...(overrides.http_req_duration || []),
    ],
    http_req_failed: [`rate<${1 - SLO.maxFailedRequests}`],
    checks: [`rate>${SLO.minChecksPassRate}`],
    page_check_success: [`rate>${SLO.minChecksPassRate}`],
    ...(overrides.extra || {}),
  };

  if (!overrides.perRoute) {
    for (const p of PAGES) {
      t[`http_req_duration{route:${p.path}}`] = [`p(95)<${SLO.p95HtmlMs}`];
    }
  }

  return t;
}

function pct(v) {
  return v === undefined || v === null ? 'n/a' : Math.round(v);
}

function rate(v) {
  return v === undefined || v === null ? 'n/a' : (v * 100).toFixed(2) + '%';
}

/** Build a compact human-readable report plus JSON/CSV artefacts. */
export function makeSummaryHandler(label) {
  return function handleSummary(data) {
    const m = data.metrics || {};
    const req = (m.http_reqs && m.http_reqs.values && m.http_reqs.values.count) || 0;
    const d = (m.http_req_duration && m.http_req_duration.values) || {};
    const failed = (m.http_req_failed && m.http_req_failed.values) || {};
    const chk = (m.checks && m.checks.values) || {};
    const vu = (m.vus_max && m.vus_max.values) || {};
    const dur = (data.state && data.state.testRunDurationMs) || 0;
    const rps = dur > 0 ? (req / (dur / 1000)).toFixed(2) : 'n/a';
    const mbIn = (((m.data_received && m.data_received.values || {}).count) / 1048576) || 0;
    const mbOut = (((m.data_sent && m.data_sent.values || {}).count) / 1048576) || 0;

    const lines = [];
    lines.push('');
    lines.push('='.repeat(74));
    lines.push(`  k6 ${label} - ${BASE_URL}`);
    lines.push('='.repeat(74));
    lines.push(`  Duration        : ${Math.round(dur / 1000)}s`);
    lines.push(`  Peak VUs        : ${vu.max || 'n/a'}`);
    lines.push(`  Requests        : ${req}   (${rps} req/s)`);
    lines.push(`  Throughput      : ${mbIn.toFixed(1)} MB in / ${mbOut.toFixed(1)} MB out`);
    lines.push('');
    lines.push('  HTML page latency (ms)');
    lines.push(`    avg ${pct(d.avg)}   med ${pct(d.med)}   min ${pct(d.min)}   max ${pct(d.max)}`);
    lines.push(`    p(90) ${pct(d['p(90)'])}   p(95) ${pct(d['p(95)'])}   p(99) ${pct(d['p(99)'])}`);
    lines.push('');
    lines.push('  Reliability');
    lines.push(`    failed requests : ${rate(failed.rate)}`);
    lines.push(`    checks passed   : ${rate(chk.rate)}  (${chk.passes || 0} passed / ${chk.fails || 0} failed)`);
    lines.push(`    page checks     : ${rate((m.page_check_success && m.page_check_success.values || {}).rate)}`);
    lines.push(`    server 5xx      : ${(m.server_errors && m.server_errors.values.count) || 0}`);
    lines.push(`    timeouts        : ${(m.timeout_errors && m.timeout_errors.values.count) || 0}`);
    lines.push('');

    // Per-route latency comes from the flat "http_req_duration{route:/x}" keys,
    // which only exist because buildThresholds emits a threshold per route.
    const byRoute = {};
    for (const [key, metric] of Object.entries(m)) {
      const match = /^http_req_duration\{route:(.+)\}$/.exec(key);
      if (match && metric && metric.values) byRoute[match[1]] = metric.values;
    }
    const routes = Object.keys(byRoute).sort(
      (a, b) => (byRoute[b]['p(95)'] || 0) - (byRoute[a]['p(95)'] || 0)
    );
    if (routes.length) {
      lines.push('  Route latency (ms, by p95)');
      for (const r of routes.slice(0, 15)) {
        lines.push(
          `    ${String(r).padEnd(24)} avg ${pct(byRoute[r].avg)}  p95 ${pct(
            byRoute[r]['p(95)']
          )}  max ${pct(byRoute[r].max)}`
        );
      }
      lines.push('');
    }

    // Threshold failures are recorded per metric, not in a top-level array.
    const breaches = [];
    for (const [key, metric] of Object.entries(m)) {
      const th = (metric && metric.thresholds) || {};
      for (const [expr, info] of Object.entries(th)) {
        if (info && info.ok === false) breaches.push(`${key}: ${expr}`);
      }
    }
    if (breaches.length) {
      lines.push(`  !! ${breaches.length} THRESHOLD BREACH(ES)`);
      for (const b of breaches.slice(0, 20)) lines.push(`    ${b}`);
    } else {
      lines.push('  All thresholds satisfied.');
    }
    lines.push('='.repeat(74));
    lines.push('');

    return {
      stdout: lines.join('\n'),
      [`${RESULTS_DIR}/${label}-summary.json`]: JSON.stringify(data, null, 2),
      [`${RESULTS_DIR}/${label}-metrics.csv`]: toCsv(data),
    };
  };
}

/** Flatten k6 summary data into a CSV of metric -> value rows. */
function toCsv(data) {
  const rows = ['metric,submetric,type,value'];
  for (const [name, metric] of Object.entries(data.metrics || {})) {
    for (const [key, value] of Object.entries(metric.values || {})) {
      rows.push(`${name},,${metric.type},${value}`);
    }
    for (const [sub, sm] of Object.entries(metric.submetrics || {})) {
      for (const [key, value] of Object.entries(sm.values || {})) {
        rows.push(`${name},${sub},${metric.type},${value}`);
      }
    }
  }
  return rows.join('\n');
}
