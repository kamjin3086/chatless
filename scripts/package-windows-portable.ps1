param(
  [string]$TauriDirectory = (Join-Path $PSScriptRoot '../src-tauri'),
  [string]$ReleaseDirectory = '',
  [string]$Version = ''
)
$ErrorActionPreference = 'Stop'
$tauriRoot = (Resolve-Path -LiteralPath $TauriDirectory).Path
if (!$ReleaseDirectory) { $ReleaseDirectory = Join-Path $tauriRoot 'target/release' }
$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$config = Get-Content -LiteralPath (Join-Path $tauriRoot 'tauri.conf.json') -Raw | ConvertFrom-Json
$windowsConfig = Get-Content -LiteralPath (Join-Path $tauriRoot 'tauri.windows.conf.json') -Raw | ConvertFrom-Json
if (!$Version) { $Version = $config.version }
$Version = $Version -replace '^v', ''
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version' }
$exe = Join-Path $releaseRoot 'chatless.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Missing executable: $exe" }
$output = Join-Path $releaseRoot 'bundle/portable'
New-Item -ItemType Directory -Path $output -Force | Out-Null
# Use a fresh staging directory; never delete or move an existing build directory.
$stage = Join-Path $output ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'Chatless.exe')
# Keep the resource layout declared by the Windows bundle config. Fail explicitly
# if that config moves to globs or mappings so a release cannot silently omit DLLs.
foreach ($resource in $windowsConfig.bundle.resources) {
  if ($resource -isnot [string] -or $resource -match '[*?]' -or [IO.Path]::IsPathRooted($resource)) {
    throw 'Portable packaging requires relative, explicit resource file paths'
  }
  $source = [IO.Path]::GetFullPath((Join-Path $tauriRoot $resource))
  $destination = [IO.Path]::GetFullPath((Join-Path $stage $resource))
  if (!$source.StartsWith($tauriRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      !$destination.StartsWith($stage + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resource path escapes the packaging directory'
  }
  if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing resource: $resource" }
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
}
# Include runtime DLLs emitted beside the executable (for example WebView2Loader).
Get-ChildItem -LiteralPath $releaseRoot -Filter '*.dll' -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $stage
}
@'
Chatless for Windows x64 - no-install distribution

Extract the entire ZIP and run Chatless.exe. Keep the bundled DLLs with it.
Microsoft Edge WebView2 Runtime must already be installed.
Settings, databases and downloaded models use the normal Windows user-data
directory and are shared with the installed edition. This is not a USB-isolated
data mode. In-app updates use the normal installer; to remain installation-free,
download and extract the next portable ZIP manually.
'@ | Set-Content -LiteralPath (Join-Path $stage 'README.txt') -Encoding utf8
$archive = Join-Path $output "Chatless_${Version}_windows_x64_portable.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -Force
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
Write-Output $archive
