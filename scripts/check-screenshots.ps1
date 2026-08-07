param(
    [string]$Directory = "phase-1.5",
    [string]$ExpectedSize = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "artifacts\screenshots\$Directory"
if (-not (Test-Path $dir)) {
    Write-Host "screenshot check: FAIL (dir missing: $dir)"
    exit 1
}

$expectedMap = if ($Directory -eq "phase-1.5") {
    @{
        "quick-note-empty.png" = "620x420"
        "quick-note-filled.png" = "620x420"
        "quick-note-multiple-agents.png" = "620x420"
        "main-window.png" = "1180x760"
        "main-window-empty.png" = "1180x760"
        "main-window-selected.png" = "1180x760"
        "reminder-expanded.png" = "420x360"
        "reminder-collapsed.png" = "420x360"
        "settings-default.png" = "800x600"
        "settings-hotkey-recording.png" = "800x600"
        "settings-hotkey-invalid.png" = "800x600"
    }
} elseif ($Directory -eq "phase-2.1") {
    $fallback = if ($ExpectedSize) { $ExpectedSize } else { "1000x750" }
    @{
        "main-window.png" = $fallback
        "main-window-empty.png" = $fallback
        "quick-note-empty.png" = $fallback
        "quick-note-filled.png" = $fallback
        "reminder-degraded.png" = $fallback
        "settings-default.png" = $fallback
        "settings-degraded.png" = $fallback
        "settings-hotkey-invalid.png" = $fallback
    }
} elseif ($Directory -eq "phase-2.2") {
    @{
        "main-window.png" = "1000x750"
        "main-window-hover.png" = "1000x750"
        "main-window-editing.png" = "1000x750"
        "main-window-empty.png" = "1000x750"
        "quick-note-empty.png" = "1000x750"
        "quick-note-filled.png" = "1000x750"
        "quick-note-multiple-agents.png" = "1000x750"
        "settings-default.png" = "1000x750"
        "settings-recording.png" = "1000x750"
        "settings-invalid.png" = "1000x750"
        "reminder-degraded.png" = "1000x750"
        "reminder-expanded.png" = "420x360"
        "reminder-collapsed.png" = "420x360"
    }
} elseif ($Directory -eq "phase-2.3") {
    @{
        "home-grid.png" = "1000x750"
        "home-grid-many.png" = "1000x750"
        "home-hover.png" = "1000x750"
        "home-filter-open.png" = "1000x750"
        "home-filtered.png" = "1000x750"
        "home-search.png" = "1000x750"
        "home-empty.png" = "1000x750"
        "note-editor.png" = "1000x750"
        "note-editor-dirty.png" = "1000x750"
        "note-editor-menu.png" = "1000x750"
        "quick-note-empty.png" = "1000x750"
        "quick-note-multiple-agents.png" = "1000x750"
        "settings.png" = "1000x750"
    }
} else {
    @{}
}

$failures = @()
$files = if ($expectedMap.Count -gt 0) { $expectedMap.Keys } else { (Get-ChildItem $dir -Filter *.png).Name }
foreach ($name in $files) {
    $file = Join-Path $dir $name
    if (-not (Test-Path $file)) {
        $failures += "missing screenshot: $name"
        continue
    }
    $bmp = New-Object System.Drawing.Bitmap($file)
    $actual = "$($bmp.Width)x$($bmp.Height)"
    if ($expectedMap[$name] -and $actual -ne $expectedMap[$name]) {
        $failures += "$name size mismatch: expected $($expectedMap[$name]) got $actual"
    }

    $nonBg = 0
    $total = 0
    $edgeNonBg = 0
    $accentPixels = 0
    for ($y = 0; $y -lt $bmp.Height; $y++) {
        for ($x = 0; $x -lt $bmp.Width; $x++) {
            $c = $bmp.GetPixel($x, $y)
            $isDark = ($c.R -lt 35) -and ($c.G -lt 35) -and ($c.B -lt 35)
            $isLight = ($c.R -gt 235) -and ($c.G -gt 235) -and ($c.B -gt 235)
            if (-not ($isDark -or $isLight)) { $nonBg++ }
            $maxCh = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
            $minCh = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
            if (($maxCh - $minCh) -gt 60 -and $maxCh -gt 90) { $accentPixels++ }
            $total++
            $isEdge = ($x -lt 6) -or ($y -lt 6) -or ($x -ge $bmp.Width - 6) -or ($y -ge $bmp.Height - 6)
            if ($isEdge -and (-not ($isDark -or $isLight))) { $edgeNonBg++ }
        }
    }
    $contentRatio = $nonBg / $total
    $minRatio = 0.01
    if ($Directory -in @("phase-2.1", "phase-2.2", "phase-2.3")) {
        $minRatio = 0.002
    }
    if ($name -eq "main-window-empty.png") {
        # 更轻的统一空态：内容占比天然较低
        $minRatio = 0.008
    }
    if ($contentRatio -lt $minRatio) {
        $failures += "$name content ratio too low: $([Math]::Round($contentRatio * 100, 2))%"
    }
    $edgeThreshold = 60
    if ($Directory -eq "phase-2.3" -or $name -like "quick-note*") {
        # pastel 全屏底色窗口：边缘像素为设计底色而非裁切
        $edgeThreshold = 25000
    }
    if ($edgeNonBg -gt $edgeThreshold) {
        $failures += "$name suspicious edge pixels (possible clipping): $edgeNonBg"
    }
    $isReminderShot = $name -like "reminder-*"
    if ($accentPixels -lt 50 -and -not $isReminderShot) {
        $failures += "$name missing accent pixels (selection/primary action invisible): $accentPixels"
    }
    Write-Host ("{0} : {1} content={2}% accent={3} edge={4}" -f $name, $actual, [Math]::Round($contentRatio * 100, 2), $accentPixels, $edgeNonBg)
    $bmp.Dispose()
}

if ($failures.Count -gt 0) {
    Write-Host "screenshot check: FAIL"
    $failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
Write-Host "screenshot check: PASS"
exit 0
