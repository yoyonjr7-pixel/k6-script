<#
.SYNOPSIS
  Convenience wrapper for the k6 tests against smkdarmasiswa1.my.id.

.EXAMPLE
  .\k6\run.ps1 -Scenario smoke
  .\k6\run.ps1 -Scenario load -PeakVus 100 -Plateau 3m
  .\k6\run.ps1 -Scenario spike -SpikeVus 300
  .\k6\run.ps1 -Scenario stress -MaxVus 250
  .\k6\run.ps1 -Scenario load -BaseUrl "https://staging.example.org"
#>
[CmdletBinding()]
param(
    [ValidateSet('smoke', 'load', 'spike', 'stress')]
    [string]$Scenario = 'load',

    [string]$BaseUrl   = 'https://smkdarmasiswa1.my.id',
    [int]$PeakVus      = 50,
    [string]$Plateau   = '2m',
    [int]$SpikeVus     = 200,
    [int]$MaxVus       = 250,

    # Emit a JSON file of raw samples in addition to the summary.
    [switch]$JsonOutput,

    # Open the summary report when the run finishes.
    [switch]$Open
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Host "k6 was not found on PATH." -ForegroundColor Red
    Write-Host "Install it with:  winget install GrafanaLabs.k6" -ForegroundColor Yellow
    Write-Host "Then re-open your terminal and run this script again." -ForegroundColor Yellow
    exit 1
}

$env:K6_BASE_URL   = $BaseUrl
$env:K6_PEAK_VUS   = "$PeakVus"
$env:K6_PLATEAU    = $Plateau
$env:K6_SPIKE_VUS  = "$SpikeVus"
$env:K6_MAX_VUS    = "$MaxVus"
$env:K6_RESULTS_DIR = Join-Path $root 'results'

New-Item -ItemType Directory -Force -Path $env:K6_RESULTS_DIR | Out-Null

$script = Join-Path $root "$Scenario-test.js"
if (-not (Test-Path $script)) {
    Write-Host "Missing test script: $script" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Scenario : $Scenario" -ForegroundColor Cyan
Write-Host "  Target   : $BaseUrl" -ForegroundColor Cyan
Write-Host "  Script   : $script" -ForegroundColor Cyan
if ($Scenario -eq 'load')   { Write-Host "  Peak VUs : $PeakVus for $Plateau" -ForegroundColor Cyan }
if ($Scenario -eq 'spike')  { Write-Host "  Spike VUs: $SpikeVus" -ForegroundColor Cyan }
if ($Scenario -eq 'stress') { Write-Host "  Max VUs  : $MaxVus  (this can take the site down)" -ForegroundColor Yellow }
if ($Scenario -eq 'smoke')  { Write-Host "  One pass over every route, 1 VU." -ForegroundColor Cyan }
Write-Host ""

$k6Args = @('run', $script, '--summary-export', (Join-Path $env:K6_RESULTS_DIR "$Scenario-k6-summary.json"))
if ($JsonOutput) {
    $k6Args += @('--out', "json=$(Join-Path $env:K6_RESULTS_DIR "$Scenario-samples.json")")
}

& k6 @k6Args
$exit = $LASTEXITCODE

if ($exit -eq 0) {
    Write-Host "`n  PASSED — all thresholds met." -ForegroundColor Green
} elseif ($exit -eq 99) {
    Write-Host "`n  FAILED — one or more thresholds were breached." -ForegroundColor Red
} else {
    Write-Host "`n  Aborted (exit $exit) — test stopped early, or k6 could not run." -ForegroundColor Yellow
}

if ($Open) {
    Get-ChildItem $env:K6_RESULTS_DIR -Filter "$Scenario-*" | ForEach-Object { Invoke-Item $_.FullName }
}

exit $exit
