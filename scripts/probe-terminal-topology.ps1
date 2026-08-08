# Terminal Process Topology Probe (read-only).
#
# Outputs sanitized identity markers only. Never prints full command lines,
# full paths, prompts, or project names.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-terminal-topology.ps1

$ErrorActionPreference = "Continue"

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TerminalProbe
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@

# --- Foreground ---
$hwnd = [TerminalProbe]::GetForegroundWindow()
$winPid = [uint32]0
[TerminalProbe]::GetWindowThreadProcessId($hwnd, [ref]$winPid) | Out-Null
$cls = New-Object System.Text.StringBuilder 256
[TerminalProbe]::GetClassName($hwnd, $cls, 256) | Out-Null
$title = New-Object System.Text.StringBuilder 256
[TerminalProbe]::GetWindowText($hwnd, $title, 256) | Out-Null

Write-Output "=== FOREGROUND ==="
Write-Output ("hwnd=" + $hwnd.ToInt64())
Write-Output ("pid=" + $winPid)
$winProc = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $winPid) -ErrorAction SilentlyContinue
if ($winProc) {
    Write-Output ("process_basename=" + [System.IO.Path]::GetFileName($winProc.ExecutablePath))
    Write-Output ("parent_pid=" + $winProc.ParentProcessId)
} else {
    Write-Output "process_basename=<unknown>"
}
Write-Output ("window_class=" + $cls.ToString())
Write-Output ("window_title_sanitized=" + $title.ToString())

# --- Terminal / Agent related process topology ---
Write-Output "=== PROCESS TOPOLOGY (sanitized) ==="
$focus = @("WindowsTerminal.exe", "OpenConsole.exe", "conhost.exe", "pwsh.exe", "powershell.exe", "cmd.exe", "wsl.exe", "node.exe", "bun.exe", "codex.exe", "claude.exe", "opencode.exe", "codex.cmd", "claude.cmd")
$procs = Get-CimInstance Win32_Process | Where-Object {
    $name = [System.IO.Path]::GetFileName($_.ExecutablePath)
    $focus -contains $name -or ($name -like "node*") -or ($name -like "bun*")
}

foreach ($p in $procs) {
    $name = [System.IO.Path]::GetFileName($p.ExecutablePath)
    $exePath = if ($p.ExecutablePath) { $p.ExecutablePath.Replace($env:USERPROFILE, "%USERPROFILE%") } else { "" }
    $cmdLine = [string]$p.CommandLine

    # Sanitized command markers: known package/agent markers only
    $markers = @()
    foreach ($m in @("@anthropic-ai/claude-code", "@openai/codex", "codex", "claude", "opencode", "@opencode")) {
        if ($cmdLine -match [regex]::Escape($m)) { $markers += $m }
    }
    $markerStr = if ($markers.Count -gt 0) { $markers -join "," } else { "<none>" }

    Write-Output ("pid=" + $p.ProcessId + " ppid=" + $p.ParentProcessId + " exe=" + $name + " path=" + $exePath + " cmd_markers=[" + $markerStr + "]")
}
