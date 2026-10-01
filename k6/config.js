// Shared configuration for the k6 load tests against https://smkdarmasiswa1.my.id
//
// Everything here can be overridden with environment variables so the same
// scripts can be used for a smoke test, a sustained load test, or a stress test
// without editing code. Example:
//   $env:K6_BASE_URL="https://smkdarmasiswa1.my.id"; $env:K6_VUS="100"

const env = (key, fallback) => {
  const v = __ENV[key];
  return v === undefined || v === '' ? fallback : v;
};

const num = (key, fallback) => {
  const v = env(key, null);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (key, fallback) => env(key, null) === null ? fallback : env(key, '').toLowerCase() !== 'false';

export const BASE_URL = String(env('K6_BASE_URL', 'https://smkdarmasiswa1.my.id')).replace(/\/+$/, '');

// Pages verified to answer HTTP 200 at the time these tests were written.
// A virtual visitor picks from this list, so the load is spread the way real
// traffic would be spread across the site.
export const PAGES = [
  { path: '/', name: 'home', weight: 30 },
  { path: '/visi-misi', name: 'visi-misi', weight: 8 },
  { path: '/berita-sekolah', name: 'berita-sekolah', weight: 8 },
  { path: '/fasilitas', name: 'fasilitas', weight: 7 },
  { path: '/prestasi', name: 'prestasi', weight: 7 },
  { path: '/profil-guru', name: 'profil-guru', weight: 7 },
  { path: '/jurumatch', name: 'jurumatch', weight: 6 },
  { path: '/spmb', name: 'spmb', weight: 6 },
  { path: '/karir', name: 'karir', weight: 5 },
  { path: '/alumni', name: 'alumni', weight: 4 },
  { path: '/download-information', name: 'download-information', weight: 3 },
  { path: '/tefa', name: 'tefa', weight: 1 },
  { path: '/virtualtour', name: 'virtualtour', weight: 1 },
];

// Static assets fetched alongside a page visit, mimicking a browser.
export const ASSETS = {
  css: [
    '/css/bootstrap.min.css',
    '/css/navbar.css',
    '/css/home.css',
    '/css/mainfitur.css',
    '/css/footer.css',
    '/css/animations.css?v=10',
    '/css/scrollbar.css',
  ],
  js: ['/js/animations.js?v=10'],
  images: ['/images/logomawa.webp'],
};

// Content markers used by checks. "SMK Darma Siswa" appears in the document
// <title> and in the logo alt text of every page, so it is a stable signal that
// the real page was served rather than an error or interstitial.
export const CONTENT_MARKERS = ['SMK Darma Siswa', '<!DOCTYPE html>'];

export const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 k6-loadtest/1.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

// k6 accepts a single total request timeout as a duration string.
export const TIMEOUTS = env('K6_TIMEOUT', '30s');

// Think time between page views, in seconds. Real visitors read the page.
export const THINK_TIME = { min: num('K6_THINK_MIN', 1), max: num('K6_THINK_MAX', 6) };

// Should a visit also fetch the page's CSS/JS/images? Turning this off makes the
// test measure raw server throughput instead of realistic browser load.
export const LOAD_ASSETS = bool('K6_LOAD_ASSETS', true);

// Fail the run if quality targets are missed. These are deliberately modest for
// a shared Apache host; tighten them once you have a baseline.
export const SLO = {
  p95HtmlMs: num('K6_SLO_P95_MS', 3000),
  p99HtmlMs: num('K6_SLO_P99_MS', 6000),
  maxFailedRequests: num('K6_SLO_MAX_ERROR_RATE', 0.01), // 1%
  minChecksPassRate: num('K6_SLO_MIN_CHECK_RATE', 0.95),
};

// Where handleSummary writes its artefacts. Default assumes k6 is run from the
// project root (k6 run k6/load-test.js). run.ps1 overrides this with an
// absolute path.
export const RESULTS_DIR = env('K6_RESULTS_DIR', 'k6/results');

export function pickWeightedPage() {
  const total = PAGES.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * total;
  for (const page of PAGES) {
    roll -= page.weight;
    if (roll <= 0) return page;
  }
  return PAGES[0];
}

export function url(path) {
  return path.startsWith('http') ? path : `${BASE_URL}${path}`;
}
