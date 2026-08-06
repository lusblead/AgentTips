$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$failures = @()

# 1. Rust domain 层不得依赖 Tauri / SQLite / Windows 平台代码（AT-ARCH-001）
$domainFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src\domain") -Recurse -Filter *.rs -ErrorAction SilentlyContinue
foreach ($file in $domainFiles) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    foreach ($forbidden in @("tauri::", "rusqlite", "windows::")) {
        if ($content -match [regex]::Escape($forbidden)) {
            $failures += "domain 违反依赖边界: $($file.FullName) 包含 $forbidden"
        }
    }
}

# 2. React feature 层不得直接 import @tauri-apps/api（AT-ARCH-002）
$featureFiles = Get-ChildItem -Path (Join-Path $root "src\features") -Recurse -Include *.ts, *.tsx -ErrorAction SilentlyContinue
foreach ($file in $featureFiles) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -match 'from\s+["'']@tauri-apps/api') {
        $failures += "feature 直接导入 @tauri-apps/api: $($file.FullName)"
    }
}

# 3. React 源码不得出现 SQL 查询语句（前端不直接访问数据库）
$srcFiles = Get-ChildItem -Path (Join-Path $root "src") -Recurse -Include *.ts, *.tsx
foreach ($file in $srcFiles) {
    if ($file.Name -match '\.test\.(ts|tsx)$') { continue }
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -cmatch '\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b') {
        $failures += "React 源码疑似包含 SQL: $($file.FullName)"
    }
}

# 4. feature 之间不得通过私有路径深层导入其他 feature（AT-ARCH-004）
$featureDirs = Get-ChildItem -Path (Join-Path $root "src\features") -Directory -ErrorAction SilentlyContinue
$featureFiles = Get-ChildItem -Path (Join-Path $root "src\features") -Recurse -Include *.ts, *.tsx
foreach ($file in $featureFiles) {
    $relative = $file.FullName.Substring((Join-Path $root "src\features").Length + 1)
    $thisFeature = ($relative -split '[\\/]')[0]
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    foreach ($dir in $featureDirs) {
        $otherName = $dir.Name
        if ($otherName -eq $thisFeature) { continue }
        if ($content -match [regex]::Escape("features/$otherName/")) {
            $failures += "feature 深层导入其他 feature: $($file.FullName) -> features/$otherName"
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host "check-architecture: FAIL"
    $failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

Write-Host "check-architecture: PASS"
exit 0
