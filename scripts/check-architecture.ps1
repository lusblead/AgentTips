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

# 5. Rust application 层不依赖 adapters 或 commands（application → domain + ports）
$applicationFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src\application") -Recurse -Filter *.rs -ErrorAction SilentlyContinue
foreach ($file in $applicationFiles) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    foreach ($forbidden in @("crate::adapters", "crate::commands", "rusqlite")) {
        if ($content -match [regex]::Escape($forbidden)) {
            $failures += "application 违反依赖边界: $($file.FullName) 包含 $forbidden"
        }
    }
}

# 6. SQL 只能出现在 migrations/*.sql 与 adapters/（sqlite.rs、sqlite_hotkey_settings.rs 等 SQLite adapter）
$rustFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src") -Recurse -Filter *.rs
foreach ($file in $rustFiles) {
    if ($file.FullName -match 'adapters\\(sqlite\.rs|sqlite_hotkey_settings\.rs)$') { continue }
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -cmatch '\b(SELECT |INSERT INTO|CREATE TABLE|UPDATE |DELETE FROM)\b') {
        $failures += "SQL 出现在非 SQLite adapter 文件: $($file.FullName)"
    }
}

# 7. Tauri commands 不直接引用 rusqlite
$commandFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src\commands") -Recurse -Filter *.rs -ErrorAction SilentlyContinue
foreach ($file in $commandFiles) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -match 'rusqlite') {
        $failures += "command 直接引用 rusqlite: $($file.FullName)"
    }
}

# 8. 生产 composition root（src/App.tsx）必须在 Tauri 分支实例化 TauriDesktopApi
$appEntry = Join-Path $root "src\App.tsx"
if (Test-Path $appEntry) {
    $content = Get-Content -Raw -Encoding UTF8 $appEntry
    if ($content -notmatch 'new TauriDesktopApi\(\)') {
        $failures += "App.tsx 未实例化 TauriDesktopApi（生产适配器缺失）"
    }
    if ($content -match 'if \(window\.__TAURI__\)') {
        $failures += "App.tsx 使用被禁止的 window.__TAURI__ 分支"
    }
}

# 9. feature 组件测试不得直接实例化 TauriDesktopApi
$featureTests = Get-ChildItem -Path (Join-Path $root "src\features") -Recurse -Include *.test.ts, *.test.tsx -ErrorAction SilentlyContinue
foreach ($file in $featureTests) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -match 'TauriDesktopApi') {
        $failures += "feature 测试直接引用 TauriDesktopApi（应注入 mock adapter）: $($file.FullName)"
    }
}

# 10. feature 目录不得 import @tauri-apps/api/window|webviewWindow 或 new WebviewWindow
$featureAllFiles = Get-ChildItem -Path (Join-Path $root "src\features") -Recurse -Include *.ts, *.tsx
foreach ($file in $featureAllFiles) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -match '@tauri-apps/api/window|@tauri-apps/api/webviewWindow|new\s+WebviewWindow\s*\(') {
        $failures += "feature 使用 Tauri 窗口 API: $($file.FullName)"
    }
}

# 11. Rust application 不依赖具体 Tauri window 类型
$appRustFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src\application") -Recurse -Filter *.rs -ErrorAction SilentlyContinue
foreach ($file in $appRustFiles) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -match 'tauri::WebviewWindow|WebviewWindowBuilder') {
        $failures += "application 依赖具体 Tauri window 类型: $($file.FullName)"
    }
}

# 12. feature 不得 import @tauri-apps/plugin-global-shortcut 或直接 register/unregister
foreach ($file in $featureAllFiles) {
    $content = Get-Content -Raw -Encoding UTF8 $file.FullName
    if ($content -match '@tauri-apps/plugin-global-shortcut|\bregister\s*\(|\bunregister\s*\(') {
        $failures += "feature 直接操作 global shortcut 插件: $($file.FullName)"
    }
}

# 13. Rust domain/application/ports 不得依赖 tauri_plugin_global_shortcut（仅 adapter）
$hotkeyBoundaryLayers = @("domain", "application", "ports")
foreach ($layer in $hotkeyBoundaryLayers) {
    $layerFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src\$layer") -Recurse -Filter *.rs -ErrorAction SilentlyContinue
    foreach ($file in $layerFiles) {
        $content = Get-Content -Raw -Encoding UTF8 $file.FullName
        if ($content -match 'tauri_plugin_global_shortcut') {
            $failures += "$layer 依赖 global-shortcut 插件: $($file.FullName)"
        }
    }
}

# 14. Rust domain/application/ports 不得依赖 windows/windows-sys/winapi（仅 adapter）
$windowsBoundaryLayers = @("domain", "application", "ports")
foreach ($layer in $windowsBoundaryLayers) {
    $layerFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src\$layer") -Recurse -Filter *.rs -ErrorAction SilentlyContinue
    foreach ($file in $layerFiles) {
        $content = Get-Content -Raw -Encoding UTF8 $file.FullName
        if ($content -match 'windows_sys|windows::|winapi') {
            $failures += "$layer 依赖 Windows API: $($file.FullName)"
        }
    }
}

# 15. Rust domain/application/ports 不得依赖 Toolhelp/WMI（仅 adapter）
$processBoundaryLayers = @("domain", "application", "ports")
foreach ($layer in $processBoundaryLayers) {
    $layerFiles = Get-ChildItem -Path (Join-Path $root "src-tauri\src\$layer") -Recurse -Filter *.rs -ErrorAction SilentlyContinue
    foreach ($file in $layerFiles) {
        $content = Get-Content -Raw -Encoding UTF8 $file.FullName
        if ($content -match 'CreateToolhelp32Snapshot|TH32CS_SNAPPROCESS|Win32_Process|WmiMonitor') {
            $failures += "$layer 依赖进程/WMI API: $($file.FullName)"
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
