# k6 load tests — smkdarmasiswa1.my.id

Load, smoke, spike, and stress tests for **https://smkdarmasiswa1.my.id** (SMK Darma Siswa).

The tests were written against routes verified to answer `HTTP 200` on 2026-10-01:

| Route | Route | Route |
|---|---|---|
| `/` | `/visi-misi` | `/berita-sekolah` |
| `/fasilitas` | `/prestasi` | `/profil-guru` |
| `/jurumatch` | `/spmb` | `/karir` |
| `/alumni` | `/download-information` | `/tefa` |
| `/virtualtour` | `/css/*`, `/js/*`, `/images/*` | |

## Files

```
k6/
├── config.js       # target URL, routes, headers, timeouts, SLO targets
├── lib.js          # shared metrics, request helpers, threshold builder, summary report
├── smoke-test.js   # 1 VU, one pass over every route — is the site healthy?
├── load-test.js    # the main load test: ramp to a plateau and hold
├── spike-test.js   # sudden burst, then recovery
├── stress-test.js  # push past the limit to find the breaking point
├── run.ps1         # convenience wrapper for the above
└── results/        # JSON + CSV summary output (created on first run)
```

## Prerequisites

`k6` must be on your `PATH`. Check with `k6 version`. If it is missing:

```powershell
winget install GrafanaLabs.k6
# or download the zip from https://github.com/grafana/k6/releases and extract it
```

## Running

```powershell
cd "c:\Users\MyBook Hype AMD\OneDrive\Documents\New folder"

# 1. Sanity check first — always a good idea.
k6 run k6/smoke-test.js

# 2. The main load test (default: ramps to 50 VUs, holds 2 minutes).
k6 run k6/load-test.js

# 3. A bigger run.
$env:K6_PEAK_VUS = "150"; $env:K6_PLATEAU = "5m"
k6 run k6/load-test.js
```

Or use the wrapper, which sets sane defaults and prints a summary:

```powershell
.\k6\run.ps1 -Scenario load -PeakVus 100 -Plateau 3m
.\k6\run.ps1 -Scenario smoke
.\k6\run.ps1 -Scenario stress -MaxVus 250
```

## What each test measures

**`load-test.js`** — the load test. Virtual users land on a weighted-random page,
fetch the page's CSS/JS/image assets in parallel like a browser does, browse 2–5
more pages with 1–6 s of think time between them, then log off. Load ramps in
steps to a plateau and holds there. Pass/fail is decided by the thresholds below.

**`smoke-test.js`** — one VU visits every route exactly once with zero tolerance
for failed requests. Use this before and after any bigger test.

**`spike-test.js`** — traffic jumps from 5 to 200 VUs in 10 s. Answers "what
happens when everyone shows up at once?" and shows whether the site recovers.

**`stress-test.js`** — climbs to 250 VUs in steps and holds, with an automatic
abort if more than 20 % of requests fail. Finds the breaking point.

## Thresholds and pass criteria

`load-test.js` fails the run if any of these are breached (defaults in `config.js`):

| Metric | Limit | Meaning |
|---|---|---|
| `http_req_duration` p95 | < 3000 ms | 95 % of requests under 3 s |
| `http_req_duration` p99 | < 6000 ms | 99 % of requests under 6 s |
| `html_duration_ms` p95 | < 4000 ms | page HTML, excluding assets |
| `http_req_failed` rate | < 1 % | failed-request budget |
| `checks` rate | > 95 % | content checks passed |
| `timeout_errors` count | == 0 | no request may time out |

Every page response is also checked for: `status is 200`, no 5xx, an HTML
`Content-Type`, the string `SMK Darma Siswa` in the body, a body larger than
500 bytes, and a total duration under 5 s.

## Tuning with environment variables

All of these are read by `config.js` / the test scripts:

| Variable | Default | Purpose |
|---|---|---|
| `K6_BASE_URL` | `https://smkdarmasiswa1.my.id` | target host — point at staging |
| `K6_PEAK_VUS` | `50` | load-test plateau size |
| `K6_PLATEAU` | `2m` | how long to hold peak load |
| `K6_SPIKE_VUS` | `200` | spike-test peak |
| `K6_MAX_VUS` | `250` | stress-test ceiling |
| `K6_LOAD_ASSETS` | `true` | fetch CSS/JS/images too |
| `K6_THINK_MIN` / `K6_THINK_MAX` | `1` / `6` | think-time seconds |
| `K6_SLO_P95_MS` | `3000` | p95 latency budget |
| `K6_SLO_P99_MS` | `6000` | p99 latency budget |
| `K6_SLO_MAX_ERROR_RATE` | `0.01` | allowed error rate |
| `K6_SLO_MIN_CHECK_RATE` | `0.95` | required check pass rate |
| `K6_RESULTS_DIR` | `results` | where JSON/CSV are written |

Example — HTML-only load, no assets, tighter latency budget:

```powershell
$env:K6_LOAD_ASSETS="false"; $env:K6_SLO_P95_MS="1500"
k6 run k6/load-test.js
```

## Output artefacts

Each run prints a summary table to the console and writes:

- `k6/results/<scenario>-summary.json` — full metrics, for Grafana/dashboards
- `k6/results/<scenario>-metrics.csv` — flattened metrics, for Excel/Sheets

To stream metrics elsewhere instead, k6 supports `--out json=<file>` and
`--out experimental-prometheus-rw`.

## Please read before running

These tests generate real HTTP traffic against a **live production website**.

- Only run them against a site you own or have explicit written permission to test.
- Start with `smoke-test.js`, then the default 50-VU load test. Do not jump to
  `stress-test.js` on a shared host — it is designed to cause failures.
- Keep runs short. A sustained load test on a small Apache host can look like an
  attack and may trigger rate limiting or a block from your ISP or the host.
- Point `K6_BASE_URL` at a staging server if one exists. That is always the right
  first answer to "can we load test this?"
