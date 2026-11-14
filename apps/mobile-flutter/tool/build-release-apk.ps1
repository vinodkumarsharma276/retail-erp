<#
.SYNOPSIS
  Builds a release-signed RetailERP APK for the shops.

.DESCRIPTION
  - Requires the release key (tool/create-release-keystore.ps1) and an https API address.
  - BuildNumber must be higher than every APK released before (Android refuses downgrades);
    the script checks the release folder for it.
  - Obfuscates Dart code; the symbol files needed to read crash stack traces are kept
    next to the APK, outside the repository.
  - Verifies the signature is the release key (not the debug key) and prints the SHA-256 to
    share with staff alongside the APK.

.EXAMPLE
  .\tool\build-release-apk.ps1 -BuildNumber 2
#>
param(
  [Parameter(Mandatory)] [ValidateRange(1, 2100000000)] [int]$BuildNumber,
  [string]$BuildName,
  [string]$ApiBaseUrl = 'https://api.retailerpai.com',
  [string]$OutputDirectory = (Join-Path $env:USERPROFILE '.retailerp\android\releases')
)
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app

if (-not $ApiBaseUrl.StartsWith('https://')) { throw 'Release builds must use an https:// API address.' }
$keyProperties = if ($env:RETAILERP_ANDROID_KEY_PROPERTIES) { $env:RETAILERP_ANDROID_KEY_PROPERTIES } `
  else { Join-Path $env:USERPROFILE '.retailerp\android\key.properties' }
if (-not (Test-Path $keyProperties)) { throw "Release key not found ($keyProperties). Run tool\create-release-keystore.ps1 first." }
if (-not $BuildName) {
  $BuildName = (Select-String -Path pubspec.yaml -Pattern '^version:\s*([0-9.]+)').Matches[0].Groups[1].Value
}

New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$released = Get-ChildItem $OutputDirectory -Filter 'RetailERP-*.apk' |
  ForEach-Object { if ($_.Name -match '\+(\d+)\.apk$') { [int]$Matches[1] } } |
  Measure-Object -Maximum
if ($released.Count -gt 0 -and $BuildNumber -le $released.Maximum) {
  throw "BuildNumber must be greater than $($released.Maximum), the highest build already released."
}

$label = "$BuildName+$BuildNumber"
$symbols = Join-Path $OutputDirectory "symbols-$label"
flutter build apk --release --build-name $BuildName --build-number $BuildNumber `
  "--dart-define=API_BASE_URL=$ApiBaseUrl" --obfuscate "--split-debug-info=$symbols"
if ($LASTEXITCODE -ne 0) { throw 'flutter build failed.' }

$apk = Join-Path $OutputDirectory "RetailERP-$label.apk"
Copy-Item build\app\outputs\flutter-apk\app-release.apk $apk -Force

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else {
  ((Get-Content android\local.properties | Select-String '^sdk\.dir=').Line -replace '^sdk\.dir=', '') -replace '\\\\', '\'
}
$apksigner = Get-ChildItem (Join-Path $sdk 'build-tools') -Recurse -Filter apksigner.bat |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $apksigner) { throw 'apksigner not found in the Android SDK build-tools.' }
$certs = & $apksigner.FullName verify --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
if ($certs -match 'CN=Android Debug') { throw 'APK is signed with the debug key; refusing to release it.' }

Write-Host ''
Write-Host "Release APK : $apk"
Write-Host "Version     : $label   API: $ApiBaseUrl"
Write-Host ($certs | Select-String 'Signer #1 certificate DN|SHA-256 digest' | Out-String).Trim()
Write-Host "APK SHA-256 : $((Get-FileHash $apk -Algorithm SHA256).Hash.ToLower())"
Write-Host "Symbols     : $symbols  (keep; needed to read crash reports)"