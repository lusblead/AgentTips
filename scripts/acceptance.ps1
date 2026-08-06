$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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
    @{ Name = "pnpm test:tauri-ui (real WebView UI chain)"; Command = "pnpm test:tauri-ui" }
)

$failed = @()
foreach ($step in $steps) {
    Write-Host "`n==== $($step.Name) ===="
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

Write-Host "`nacceptance: PASS"
exit 0
