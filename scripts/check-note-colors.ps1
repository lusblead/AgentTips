$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "artifacts\screenshots\phase-2.4R"

# Official LIGHT Palette RGB (matches src/lib/palette.ts NOTE_BG)
$palette = @{
    "lemon" = @(255, 240, 166)
    "apricot" = @(255, 215, 181)
    "coral" = @(255, 199, 194)
    "rose" = @(247, 198, 220)
    "lavender" = @(222, 205, 251)
    "periwinkle" = @(201, 214, 255)
    "sky" = @(191, 228, 255)
    "aqua" = @(189, 237, 231)
    "mint" = @(199, 239, 212)
    "sage" = @(221, 234, 181)
}

function Count-Color([string]$File, [int[]]$Target) {
    $bmp = New-Object System.Drawing.Bitmap($File)
    $count = 0
    for ($y = 0; $y -lt $bmp.Height; $y += 2) {
        for ($x = 0; $x -lt $bmp.Width; $x += 2) {
            $c = $bmp.GetPixel($x, $y)
            if ($c.R -eq $Target[0] -and $c.G -eq $Target[1] -and $c.B -eq $Target[2]) {
                $count++
            }
        }
    }
    $bmp.Dispose()
    return $count
}

function Get-PaletteColorCounts([string]$File) {
    $bmp = New-Object System.Drawing.Bitmap($File)
    $counts = @{}
    foreach ($name in $palette.Keys) {
        $counts[$name] = 0
    }
    for ($y = 0; $y -lt $bmp.Height; $y += 2) {
        for ($x = 0; $x -lt $bmp.Width; $x += 2) {
            $c = $bmp.GetPixel($x, $y)
            foreach ($name in $palette.Keys) {
                $rgb = $palette[$name]
                if ($c.R -eq $rgb[0] -and $c.G -eq $rgb[1] -and $c.B -eq $rgb[2]) {
                    $counts[$name]++
                    break
                }
            }
        }
    }
    $bmp.Dispose()
    return $counts
}

function Get-PixelDiff([string]$A, [string]$B) {
    $bmpA = New-Object System.Drawing.Bitmap($A)
    $bmpB = New-Object System.Drawing.Bitmap($B)
    $diff = 0
    $h = [Math]::Min($bmpA.Height, $bmpB.Height)
    $w = [Math]::Min($bmpA.Width, $bmpB.Width)
    for ($y = 0; $y -lt $h; $y += 2) {
        for ($x = 0; $x -lt $w; $x += 2) {
            $ca = $bmpA.GetPixel($x, $y)
            $cb = $bmpB.GetPixel($x, $y)
            if ($ca.R -ne $cb.R -or $ca.G -ne $cb.G -or $ca.B -ne $cb.B) {
                $diff++
            }
        }
    }
    $bmpA.Dispose()
    $bmpB.Dispose()
    return $diff
}

$failures = @()

$wall = Join-Path $dir "home-color-wall-many.png"
$lemonShot = Join-Path $dir "quick-note-lemon.png"
$mintShot = Join-Path $dir "quick-note-mint.png"

if (-not (Test-Path $wall)) { $failures += "missing: $wall" }
if (-not (Test-Path $lemonShot)) { $failures += "missing: $lemonShot" }
if (-not (Test-Path $mintShot)) { $failures += "missing: $mintShot" }

if ($failures.Count -eq 0) {
    # 1. home-color-wall-many: at least 6 palette colors with large area
    $counts = Get-PaletteColorCounts $wall
    $visible = @($counts.GetEnumerator() | Where-Object { $_.Value -gt 10000 } | ForEach-Object { $_.Key })
    Write-Host "wall palette colors (area > 10000): $($visible -join ', ')"
    if ($visible.Count -lt 6) {
        $failures += "home-color-wall-many has fewer than 6 palette colors: $($visible.Count)"
    }

    # 2. lemon large area
    $lemonCount = Count-Color $lemonShot $palette["lemon"]
    Write-Host "quick-note-lemon lemon pixels: $lemonCount"
    if ($lemonCount -lt 10000) {
        $failures += "quick-note-lemon lacks lemon pixels: $lemonCount"
    }

    # 3. mint large area
    $mintCount = Count-Color $mintShot $palette["mint"]
    Write-Host "quick-note-mint mint pixels: $mintCount"
    if ($mintCount -lt 10000) {
        $failures += "quick-note-mint lacks mint pixels: $mintCount"
    }

    # 4. lemon != mint real pixel diff
    $diff = Get-PixelDiff $lemonShot $mintShot
    Write-Host "lemon vs mint pixel diff: $diff"
    if ($diff -le 0) {
        $failures += "quick-note-lemon and quick-note-mint are identical"
    }
}

if ($failures.Count -gt 0) {
    Write-Host "check-note-colors: FAIL"
    $failures | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
Write-Host "check-note-colors: PASS"
exit 0
