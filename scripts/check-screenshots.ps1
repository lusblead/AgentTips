$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "artifacts\screenshots\phase-1.5"
if (-not (Test-Path $dir)) {
    Write-Host "screenshot check: FAIL (dir missing: $dir)"
    exit 1
}

$expectedSize = @{
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

$failures = @()
foreach ($name in $expectedSize.Keys) {
    $file = Join-Path $dir $name
    if (-not (Test-Path $file)) {
        $failures += "missing screenshot: $name"
        continue
    }
    $bmp = New-Object System.Drawing.Bitmap($file)
    $actual = "$($bmp.Width)x$($bmp.Height)"
    if ($actual -ne $expectedSize[$name]) {
        $failures += "$name size mismatch: expected $($expectedSize[$name]) got $actual"
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
    if ($contentRatio -lt 0.01) {
        $failures += "$name content ratio too low: $([Math]::Round($contentRatio * 100, 2))%"
    }
    if ($edgeNonBg -gt 60) {
        $failures += "$name suspicious edge pixels (possible clipping): $edgeNonBg"
    }
    if ($accentPixels -lt 50) {
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
