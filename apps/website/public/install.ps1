#Requires -Version 5.1

# The Windows counterpart to install.sh. It downloads the same release asset,
# verifies it against the same SHA256SUMS file, and drops the executable
# somewhere on the user's own PATH so no elevation is needed.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = 'v5x-dev/v5x'

function Fail([string] $message) {
    Write-Error "v5x installer: $message"
    exit 1
}

$installDir = if ($env:V5X_INSTALL_DIR) {
    $env:V5X_INSTALL_DIR
} elseif ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'v5x\bin'
} else {
    Fail 'LOCALAPPDATA or V5X_INSTALL_DIR must be set'
}

$architecture = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'x64' }
    # Bun ships no Windows arm64 build yet; the x64 binary runs under emulation.
    'ARM64' { 'x64' }
    default { Fail "unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)" }
}

$version = $env:V5X_VERSION
if (-not $version) {
    try {
        $metadata = Invoke-RestMethod -UseBasicParsing `
            -Uri 'https://registry.npmjs.org/%40v5x%2Fcli/latest'
        $version = $metadata.version
    } catch {
        Fail 'could not determine the latest version'
    }
}
if (-not $version) { Fail 'could not determine the latest version' }

$asset = "v5x-windows-$architecture.exe"
$releaseUrl = "https://github.com/$repo/releases/download/%40v5x%2Fcli%40$version"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "v5x-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    Write-Host "Downloading v5x $version for windows-$architecture..."
    $download = Join-Path $tempDir $asset
    $checksums = Join-Path $tempDir 'SHA256SUMS'

    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$asset" -OutFile $download
    } catch {
        Fail "could not download $asset"
    }
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHA256SUMS" -OutFile $checksums
    } catch {
        Fail 'could not download checksums'
    }

    $expected = $null
    foreach ($line in Get-Content $checksums) {
        $fields = $line -split '\s+' | Where-Object { $_ }
        if ($fields.Count -ge 2 -and $fields[1] -eq $asset) { $expected = $fields[0] }
    }
    if (-not $expected) { Fail "release does not contain a checksum for $asset" }

    $actual = (Get-FileHash -Algorithm SHA256 -Path $download).Hash
    if ($actual -ne $expected.ToUpperInvariant()) { Fail 'checksum verification failed' }

    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Copy-Item -Path $download -Destination (Join-Path $installDir 'v5x.exe') -Force
} finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}

Write-Host "Installed v5x to $installDir\v5x.exe"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$onPath = ($userPath -split ';' | Where-Object { $_ -eq $installDir }).Count -gt 0
if (-not $onPath) {
    Write-Host "Add $installDir to your PATH to run v5x."
}
