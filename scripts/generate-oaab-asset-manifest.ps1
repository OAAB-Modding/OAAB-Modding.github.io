param(
  [string]$Repository = '.tmp/OAAB_Data.git',
  [string]$Output = 'assets/data/library/oaab-assets.json'
)

$ErrorActionPreference = 'Stop'

$revision = (git --git-dir=$Repository rev-parse HEAD).Trim()
$paths = git --git-dir=$Repository ls-tree -r --name-only HEAD '00 Core'
$caseMap = [ordered]@{}

foreach ($path in $paths) {
  if ($path -notmatch '^00 Core/(meshes|textures|icons)/') { continue }
  $relative = $path.Substring('00 Core/'.Length).Replace('\\', '/')
  $canonical = $relative.ToLowerInvariant()
  if ($relative -cne $canonical) {
    $caseMap[$canonical] = $relative
  }
}

$manifest = [ordered]@{
  revision = $revision
  generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  caseMap = $caseMap
}

$json = $manifest | ConvertTo-Json -Depth 4
$absoluteOutput = [IO.Path]::GetFullPath((Join-Path (Get-Location) $Output))
$outputDirectory = [IO.Path]::GetDirectoryName($absoluteOutput)
if (-not [IO.Directory]::Exists($outputDirectory)) {
  [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
}
[IO.File]::WriteAllText($absoluteOutput, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

Write-Output "Wrote $($caseMap.Count) case overrides from $revision to $Output"
