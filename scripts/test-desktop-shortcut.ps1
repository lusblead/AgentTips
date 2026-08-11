[CmdletBinding()]
param(
    [string]$ReleaseExecutable = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $PSScriptRoot "install-desktop-shortcut.ps1"
if ([string]::IsNullOrWhiteSpace($ReleaseExecutable)) {
    $ReleaseExecutable = Join-Path $projectRoot "src-tauri\target\release\agent-tips.exe"
}

function Assert-Condition {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-TestPeSubsystem {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        Assert-Condition -Condition ($reader.ReadUInt32() -eq 0x00004550) -Message "Missing PE signature."
        $stream.Position = $peOffset + 24 + 68
        return $reader.ReadUInt16()
    }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Get-TestFileFingerprint {
    param([Parameter(Mandatory = $true)][string]$Path)

    return [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Path))
}

function Invoke-TestInstaller {
    param(
        [Parameter(Mandatory = $true)][string]$TestDesktop,
        [Parameter(Mandatory = $true)][string]$TestExecutable
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
            -File $installerPath `
            -SkipBuild `
            -DesktopPath $TestDesktop `
            -ExecutablePath $TestExecutable 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($output -join [Environment]::NewLine)
    }
}

function Test-ReleaseExecutableUsesWindowsGuiSubsystem {
    param([Parameter(Mandatory = $true)][string]$ResolvedExecutable)

    $subsystem = Get-TestPeSubsystem -Path $ResolvedExecutable
    Assert-Condition -Condition ($subsystem -eq 2) -Message "Expected Windows GUI subsystem 2, actual value: $subsystem"
}

function Test-DirectReleaseShortcutInstallation {
    param(
        [Parameter(Mandatory = $true)][string]$TestDesktop,
        [Parameter(Mandatory = $true)][string]$ResolvedExecutable
    )

    $shortcutPath = Join-Path $TestDesktop "AgentTips.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $legacy = $shell.CreateShortcut($shortcutPath)
    $legacy.TargetPath = "$env:SystemRoot\System32\cmd.exe"
    $legacy.Arguments = "/c exit"
    $legacy.WorkingDirectory = $TestDesktop
    $legacy.Save()

    $result = Invoke-TestInstaller -TestDesktop $TestDesktop -TestExecutable $ResolvedExecutable
    Assert-Condition -Condition ($result.ExitCode -eq 0) -Message "Installer failed: $($result.Output)"

    Assert-Condition -Condition (Test-Path -LiteralPath $shortcutPath -PathType Leaf) -Message "Shortcut was not created."
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $actualTarget = [System.IO.Path]::GetFullPath([string]$shortcut.TargetPath)
    $actualWorkingDirectory = [System.IO.Path]::GetFullPath([string]$shortcut.WorkingDirectory)
    $expectedWorkingDirectory = Split-Path -Parent $ResolvedExecutable

    Assert-Condition -Condition ([string]::Equals($actualTarget, $ResolvedExecutable, [System.StringComparison]::OrdinalIgnoreCase)) -Message "Shortcut target is not the Release executable."
    Assert-Condition -Condition ([string]::IsNullOrWhiteSpace([string]$shortcut.Arguments)) -Message "Shortcut arguments are not empty."
    Assert-Condition -Condition ([string]::Equals($actualWorkingDirectory, $expectedWorkingDirectory, [System.StringComparison]::OrdinalIgnoreCase)) -Message "Shortcut working directory is incorrect."
    $temporaryArtifacts = @(Get-ChildItem -LiteralPath $TestDesktop -Filter ".agenttips-shortcut-*.lnk" -Force)
    Assert-Condition -Condition ($temporaryArtifacts.Count -eq 0) -Message "Shortcut installation left temporary candidate or backup files."
}

function Test-InvalidExecutablePreservesExistingShortcut {
    param([Parameter(Mandatory = $true)][string]$TestDesktop)

    $shortcutPath = Join-Path $TestDesktop "AgentTips.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $legacy = $shell.CreateShortcut($shortcutPath)
    $legacy.TargetPath = "$env:SystemRoot\System32\cmd.exe"
    $legacy.Arguments = "/c exit"
    $legacy.WorkingDirectory = $TestDesktop
    $legacy.Save()
    $beforeFingerprint = Get-TestFileFingerprint -Path $shortcutPath

    $missingExecutable = Join-Path $TestDesktop "missing-agent-tips.exe"
    $result = Invoke-TestInstaller -TestDesktop $TestDesktop -TestExecutable $missingExecutable
    Assert-Condition -Condition ($result.ExitCode -ne 0) -Message "Installer unexpectedly accepted a missing executable."

    $afterFingerprint = Get-TestFileFingerprint -Path $shortcutPath
    Assert-Condition -Condition ($beforeFingerprint -eq $afterFingerprint) -Message "Failed installation changed the existing shortcut."
}

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$testRoot = Join-Path $tempBase "agenttips-shortcut-test-$([Guid]::NewGuid().ToString('N'))"

try {
    if (-not (Test-Path -LiteralPath $ReleaseExecutable -PathType Leaf)) {
        throw "Build the Release executable before running this test: $ReleaseExecutable"
    }
    $resolvedExecutable = (Resolve-Path -LiteralPath $ReleaseExecutable).Path
    New-Item -ItemType Directory -Path $testRoot | Out-Null

    Test-ReleaseExecutableUsesWindowsGuiSubsystem -ResolvedExecutable $resolvedExecutable
    Write-Output "PASS Test-ReleaseExecutableUsesWindowsGuiSubsystem"
    Test-DirectReleaseShortcutInstallation -TestDesktop $testRoot -ResolvedExecutable $resolvedExecutable
    Write-Output "PASS Test-DirectReleaseShortcutInstallation"
    Test-InvalidExecutablePreservesExistingShortcut -TestDesktop $testRoot
    Write-Output "PASS Test-InvalidExecutablePreservesExistingShortcut"
}
finally {
    if (Test-Path -LiteralPath $testRoot -PathType Container) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        $isUnderTemp = $resolvedTestRoot.StartsWith($tempBase, [System.StringComparison]::OrdinalIgnoreCase)
        $hasExpectedName = (Split-Path -Leaf $resolvedTestRoot) -like "agenttips-shortcut-test-*"
        if (-not $isUnderTemp -or -not $hasExpectedName) {
            throw "Refusing to remove unexpected test directory: $resolvedTestRoot"
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
