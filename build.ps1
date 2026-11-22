# Builds the upload zip for CrazyGames / Poki.
#
#   Right-click > Run with PowerShell, or in a terminal:  powershell -ExecutionPolicy Bypass -File build.ps1
#
# What it does:
#   1. rebuilds tw.css from the classes used in the game (needs Node; skipped with a warning if npx is missing)
#   2. copies only the files the game needs into dist\game\
#   3. stamps every ?v=N in index.html with the build time, so players never get a mix of old and new cached files
#   4. zips it to dist\spin-arena-<date>.zip  (upload that file)
#
# To update the game on a portal later: change the game, run this again, upload the new zip as a new version.
# New spinner or arena files are picked up automatically (every .js in the root, spinners\ and vendor\).

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

# 1. styles
if (Get-Command npx -ErrorAction SilentlyContinue) {
  Write-Host 'Building tw.css...'
  cmd /c "npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.src.css -o tw.css --minify >nul 2>nul"   # (its warnings are harmless)
  if ($LASTEXITCODE -ne 0) { throw 'Tailwind build failed' }
} else { Write-Warning 'npx not found: using the existing tw.css' }

# 2. copy the game files
$dist = Join-Path $root 'dist'
$out  = Join-Path $dist 'game'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
if (Test-Path $dist) { Get-ChildItem $dist -Filter 'spin-arena-*.zip' | Remove-Item -Force }   # only the newest zip is kept
New-Item -ItemType Directory -Force $out | Out-Null
$skip = @('tailwind.config.js')   # build-only files in the root
$files = @('index.html','style.css','tw.css','LICENSES.txt') +
  (Get-ChildItem -File *.js | Where-Object { $skip -notcontains $_.Name } | ForEach-Object { $_.Name })
foreach ($f in $files) { Copy-Item $f (Join-Path $out $f) }
foreach ($d in @('spinners','vendor')) {
  New-Item -ItemType Directory -Force (Join-Path $out $d) | Out-Null
  Get-ChildItem -File (Join-Path $root $d) -Filter *.js | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "$d\$($_.Name)") }
}

# 3. cache-busting stamp
$stamp = Get-Date -Format 'yyyyMMddHHmm'
$html  = [IO.File]::ReadAllText((Join-Path $out 'index.html'))
$html  = [regex]::Replace($html, '\?v=\d+', "?v=$stamp")
[IO.File]::WriteAllText((Join-Path $out 'index.html'), $html, (New-Object Text.UTF8Encoding $false))

# every script and stylesheet index.html asks for must be in the build
$missing = [regex]::Matches($html, '(?:src|href)="([^"?#:]+)\?v=') | ForEach-Object { $_.Groups[1].Value } |
  Where-Object { -not (Test-Path (Join-Path $out $_)) }
if ($missing) { throw "index.html loads files that are not in the build: $($missing -join ', ')" }

# 4. zip (paths use forward slashes, which upload servers expect)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zipPath = Join-Path $dist "spin-arena-$stamp.zip"
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  Get-ChildItem -Recurse -File $out | ForEach-Object {
    $rel = $_.FullName.Substring($out.Length + 1).Replace('\','/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal')
  }
} finally { $zip.Dispose() }

$kb = [math]::Round((Get-Item $zipPath).Length / 1KB)
Write-Host ''
Write-Host "Done: dist\spin-arena-$stamp.zip ($kb KB, $((Get-ChildItem -Recurse -File $out).Count) files)"
Write-Host "Test it first: open dist\game\index.html, or add ?crazygames to the address when it is served."
