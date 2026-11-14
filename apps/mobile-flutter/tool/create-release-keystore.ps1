<#
.SYNOPSIS
  Creates the RetailERP Android release (upload) keystore and key.properties, outside the repository.

.DESCRIPTION
  Run once per business, on the owner's PC. Every APK must be signed with this same key or
  phones refuse to install it over the previous version. Back up BOTH files it creates
  (keystore + key.properties) to a password manager or encrypted cloud drive: if they are
  lost, every phone has to uninstall the app (losing its offline copy) to install a new key's build.

.EXAMPLE
  .\tool\create-release-keystore.ps1
#>
param(
  [string]$Directory = (Join-Path $env:USERPROFILE '.retailerp\android'),
  [string]$Alias = 'upload',
  [string]$DistinguishedName = 'CN=RetailERP, O=RetailERP, C=IN',
  # Prompted for when omitted.
  [SecureString]$Password
)
$ErrorActionPreference = 'Stop'

$keystore = Join-Path $Directory 'upload-keystore.jks'
$properties = Join-Path $Directory 'key.properties'
if ((Test-Path $keystore) -or (Test-Path $properties)) {
  throw "A release key already exists in $Directory. Never replace it: installed apps could no longer be upgraded."
}
$keytool = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\keytool.exe' } else { 'keytool' }

$secure = if ($Password) { $Password } else { Read-Host 'Choose a keystore password (at least 12 characters)' -AsSecureString }
$confirm = if ($Password) { $Password } else { Read-Host 'Repeat the password' -AsSecureString }
$plain = [Net.NetworkCredential]::new('', $secure).Password
if ($plain -ne [Net.NetworkCredential]::new('', $confirm).Password) { throw 'Passwords differ.' }
if ($plain.Length -lt 12) { throw 'Use at least 12 characters.' }

New-Item -ItemType Directory -Force $Directory | Out-Null
& $keytool -genkeypair -v -keystore $keystore -storetype PKCS12 -keyalg RSA -keysize 4096 `
  -validity 10000 -alias $Alias -dname $DistinguishedName -storepass $plain -keypass $plain | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'keytool failed.' }

# Gradle reads this file; forward slashes avoid escaping in .properties.
@(
  "storeFile=$($keystore.Replace('\', '/'))"
  "storePassword=$plain"
  "keyAlias=$Alias"
  "keyPassword=$plain"
) | Set-Content -Encoding ascii $properties

# Only the current user may read the key material.
foreach ($file in $keystore, $properties) {
  icacls $file /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
}

& $keytool -list -v -keystore $keystore -storepass $plain -alias $Alias |
  Select-String 'SHA256:' | Select-Object -First 1 | ForEach-Object { "Certificate $($_.Line.Trim())" }
Write-Host "Created $keystore and $properties."
Write-Host 'Back up both files now (password manager / encrypted drive). They are not in git.'