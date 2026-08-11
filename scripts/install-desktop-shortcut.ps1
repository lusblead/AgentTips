[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$DesktopPath = [Environment]::GetFolderPath("Desktop"),
    [string]$ExecutablePath = "",
    [string]$ShortcutName = "AgentTips.lnk"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ExecutablePath)) {
    $ExecutablePath = Join-Path $projectRoot "src-tauri\target\release\agent-tips.exe"
}

function Invoke-AgentTipsReleaseBuild {
    param([Parameter(Mandatory = $true)][string]$Root)

    $pnpm = Get-Command "pnpm.cmd" -ErrorAction Stop
    Push-Location $Root
    try {
        & $pnpm.Source exec tauri build --no-bundle --ci
        if ($LASTEXITCODE -ne 0) {
            throw "Release build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Get-AgentTipsPeSubsystem {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        if ($stream.Length -lt 256) {
            throw "Executable is too small to contain a valid PE header: $Path"
        }

        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        if ($peOffset -lt 0 -or ($peOffset + 94) -gt $stream.Length) {
            throw "Executable has an invalid PE header offset: $Path"
        }

        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) {
            throw "Executable does not contain a PE signature: $Path"
        }

        $optionalHeaderOffset = $peOffset + 24
        $stream.Position = $optionalHeaderOffset
        $magic = $reader.ReadUInt16()
        if ($magic -ne 0x010B -and $magic -ne 0x020B) {
            throw "Executable has an unsupported PE optional header: $Path"
        }

        $stream.Position = $optionalHeaderOffset + 68
        return $reader.ReadUInt16()
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Assert-AgentTipsReleaseExecutable {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Release executable was not found: $Path"
    }

    $resolved = (Resolve-Path -LiteralPath $Path).Path
    if (-not [string]::Equals([System.IO.Path]::GetExtension($resolved), ".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Desktop shortcut target must be an executable: $resolved"
    }

    $windowsGuiSubsystem = 2
    $subsystem = Get-AgentTipsPeSubsystem -Path $resolved
    if ($subsystem -ne $windowsGuiSubsystem) {
        throw "Release executable must use the Windows GUI subsystem (2), actual value: $subsystem"
    }

    return $resolved
}

function New-AgentTipsShortcutCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$CandidatePath,
        [Parameter(Mandatory = $true)][string]$ResolvedExecutable
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($CandidatePath)
    $shortcut.TargetPath = $ResolvedExecutable
    $shortcut.Arguments = ""
    $shortcut.WorkingDirectory = Split-Path -Parent $ResolvedExecutable
    $shortcut.WindowStyle = 1
    $shortcut.Description = "AgentTips"
    $shortcut.IconLocation = "$ResolvedExecutable,0"
    $shortcut.Save()
}

function Assert-AgentTipsShortcutCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$CandidatePath,
        [Parameter(Mandatory = $true)][string]$ResolvedExecutable
    )

    if (-not (Test-Path -LiteralPath $CandidatePath -PathType Leaf)) {
        throw "Shortcut candidate was not created: $CandidatePath"
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($CandidatePath)
    $expectedWorkingDirectory = Split-Path -Parent $ResolvedExecutable
    $actualTarget = [System.IO.Path]::GetFullPath([string]$shortcut.TargetPath)
    $actualWorkingDirectory = [System.IO.Path]::GetFullPath([string]$shortcut.WorkingDirectory)

    if (-not [string]::Equals($actualTarget, $ResolvedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Shortcut target mismatch: $actualTarget"
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$shortcut.Arguments)) {
        throw "Shortcut arguments must be empty."
    }
    if (-not [string]::Equals($actualWorkingDirectory, $expectedWorkingDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Shortcut working directory mismatch: $actualWorkingDirectory"
    }
}

function Remove-AgentTipsShortcutCandidate {
    param([Parameter(Mandatory = $true)][string]$CandidatePath)

    if (Test-Path -LiteralPath $CandidatePath) {
        Remove-Item -LiteralPath $CandidatePath -Force
    }
}

function Install-AgentTipsDesktopShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$ResolvedDesktop,
        [Parameter(Mandatory = $true)][string]$ResolvedExecutable,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ([System.IO.Path]::GetFileName($Name) -ne $Name -or
        -not [string]::Equals([System.IO.Path]::GetExtension($Name), ".lnk", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "ShortcutName must be a plain .lnk file name."
    }

    $shortcutPath = Join-Path $ResolvedDesktop $Name
    $operationId = [Guid]::NewGuid().ToString('N')
    $candidateName = ".agenttips-shortcut-candidate-$PID-$operationId.lnk"
    $candidatePath = Join-Path $ResolvedDesktop $candidateName
    $backupPath = Join-Path $ResolvedDesktop ".agenttips-shortcut-backup-$PID-$operationId.lnk"

    try {
        New-AgentTipsShortcutCandidate -CandidatePath $candidatePath -ResolvedExecutable $ResolvedExecutable
        Assert-AgentTipsShortcutCandidate -CandidatePath $candidatePath -ResolvedExecutable $ResolvedExecutable

        if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
            try {
                [System.IO.File]::Replace($candidatePath, $shortcutPath, $backupPath)
            }
            catch {
                if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf) -and
                    (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
                    [System.IO.File]::Move($backupPath, $shortcutPath)
                }
                throw
            }

            try {
                Remove-Item -LiteralPath $backupPath -Force
            }
            catch {
                Write-Warning "Shortcut was updated, but its recovery backup could not be removed: $backupPath"
            }
        }
        else {
            [System.IO.File]::Move($candidatePath, $shortcutPath)
        }
        return $shortcutPath
    }
    finally {
        try {
            Remove-AgentTipsShortcutCandidate -CandidatePath $candidatePath
        }
        catch {
            Write-Warning "Could not remove temporary shortcut candidate: $($_.Exception.Message)"
        }
    }
}

try {
    if (-not $SkipBuild) {
        Invoke-AgentTipsReleaseBuild -Root $projectRoot
    }

    if (-not (Test-Path -LiteralPath $DesktopPath -PathType Container)) {
        throw "Desktop directory was not found: $DesktopPath"
    }

    $resolvedDesktop = (Resolve-Path -LiteralPath $DesktopPath).Path
    $resolvedExecutable = Assert-AgentTipsReleaseExecutable -Path $ExecutablePath
    $installedShortcut = Install-AgentTipsDesktopShortcut `
        -ResolvedDesktop $resolvedDesktop `
        -ResolvedExecutable $resolvedExecutable `
        -Name $ShortcutName

    Write-Output "Release executable: $resolvedExecutable"
    Write-Output "Desktop shortcut: $installedShortcut"
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
