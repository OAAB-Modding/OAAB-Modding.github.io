param(
  [string]$DataRepo = "",
  [switch]$Latest
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$websiteRoot = Resolve-Path (Join-Path $scriptDir "..")

function Test-DataRepo {
  param([string]$Path)

  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $head = Join-Path $Path "HEAD"
  $objects = Join-Path $Path "objects"
  if ((Test-Path -LiteralPath $head) -and (Test-Path -LiteralPath $objects)) {
    return $true
  }

  $gitDir = Join-Path $Path ".git"
  return Test-Path -LiteralPath $gitDir
}

if (-not $DataRepo) {
  $cwd = (Get-Location).Path
  if (Test-DataRepo $cwd) {
    $remote = ""
    try {
      $remote = git -C $cwd remote get-url origin 2>$null
    } catch {
      $remote = ""
    }

    if ($remote -match "OAAB-Modding[/\\]Data|OAAB-Modding/Data|OAAB_Data") {
      $DataRepo = $cwd
    }
  }
}

if (-not $DataRepo) {
  $defaultBare = Join-Path $websiteRoot ".tmp\OAAB_Data.git"
  if (Test-DataRepo $defaultBare) {
    $DataRepo = $defaultBare
  }
}

if (-not $DataRepo) {
  throw "Could not find OAAB_Data. Run from the Data repo, pass -DataRepo <path>, or create .tmp\OAAB_Data.git in the website repo."
}

$resolvedDataRepo = (Resolve-Path -LiteralPath $DataRepo).Path
$env:OAAB_DATA_REPO = $resolvedDataRepo

$args = @("scripts\build-mesh-diffs.mjs")
if ($Latest) {
  $args += "--latest"
}

Write-Host "Website repo: $websiteRoot"
Write-Host "Data repo:    $resolvedDataRepo"
Push-Location $websiteRoot
try {
  node @args
} finally {
  Pop-Location
}
