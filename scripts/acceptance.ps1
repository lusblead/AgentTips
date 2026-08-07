$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$userDbSnapshot = Join-Path $env:TEMP "agenttips-user-db-snapshot.json"

function Invoke-CleanRuntime {
    # Before each runtime/E2E step ensure the previous test's agent-tips /
    # Vite / terminal processes have exited to avoid port and WebView races.
    foreach ($name in @("agent-tips", "WindowsTerminal", "OpenConsole", "notepad")) {
        $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
        foreach ($proc in $procs) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 3
    $portDeadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $portDeadline) {
        $listener = Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue
        if ($null -eq $listener) { break }
        foreach ($conn in @($listener)) {
            $own = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($own) { Stop-Process -Id $own.Id -Force -ErrorAction SilentlyContinue }
        }
        Start-Sleep -Seconds 1
    }
}

# User DB protection: snapshot before acceptance, verify checksum/mtime
# is unchanged after all tests.
node scripts/check-user-db-untouched.mjs --snapshot $userDbSnapshot
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL: user db snapshot"
    exit 1
}

$steps = @(
    @{ Name = "pnpm install (frozen lockfile)"; Command = "pnpm install --frozen-lockfile" },
    @{ Name = "pnpm format:check"; Command = "pnpm format:check" },
    @{ Name = "pnpm check:architecture"; Command = "pnpm check:architecture" },
    @{ Name = "pnpm lint"; Command = "pnpm lint" },
    @{ Name = "pnpm typecheck"; Command = "pnpm typecheck" },
    @{ Name = "pnpm test"; Command = "pnpm test" },
    @{ Name = "pnpm test:e2e"; Command = "pnpm test:e2e" },
    @{ Name = "pnpm build"; Command = "pnpm build" },
    @{ Name = "cargo fmt"; Command = "cargo fmt --check --manifest-path src-tauri/Cargo.toml" },
    @{ Name = "cargo clippy"; Command = "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings" },
    @{ Name = "cargo test"; Command = "cargo test --manifest-path src-tauri/Cargo.toml" },
    @{ Name = "pnpm test:tauri-ui (real WebView UI chain)"; Command = "pnpm test:tauri-ui" },
    @{ Name = "pnpm test:windows-runtime (real multi-window lifecycle)"; Command = "pnpm test:windows-runtime" },
    @{ Name = "pnpm test:global-hotkey (real global hotkey runtime)"; Command = "pnpm test:global-hotkey" },
    @{ Name = "pnpm test:desktop-detection (real foreground detection)"; Command = "pnpm test:desktop-detection" },
    @{ Name = "pnpm test:terminal-detection (real terminal session detection)"; Command = "pnpm test:terminal-detection" }
)

$failed = @()
foreach ($step in $steps) {
    Write-Host "`n==== $($step.Name) ===="
    Invoke-CleanRuntime
    Invoke-Expression $step.Command
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL: $($step.Name)"
        $failed += $step.Name
    } else {
        Write-Host "PASS: $($step.Name)"
    }
}

if ($failed.Count -gt 0) {
    Write-Host "`nacceptance: FAIL"
    $failed | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

# Verify the user DB was not modified by any test.
node scripts/check-user-db-untouched.mjs --verify $userDbSnapshot
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nacceptance: FAIL (user db modified)"
    exit 1
}

Write-Host "`nacceptance: PASS"
exit 0
