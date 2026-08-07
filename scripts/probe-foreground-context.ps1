# Foreground context probe (read-only).
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probe-foreground-context.ps1
#
# Shows a 3-2-1 countdown, then reads the foreground window identity once and exits.
# Only reads Windows state; never modifies registry, target apps, or the shell.
param([int]$Countdown = 3)

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ForegroundProbe
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    public static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);
}
"@

$PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

Write-Output "Switch to the target window now."
for ($i = $Countdown; $i -ge 1; $i--) {
    Write-Output $i
    Start-Sleep -Seconds 1
}

$hwnd = [ForegroundProbe]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "NO_FOREGROUND_WINDOW"
    exit 0
}

$pidValue = [uint32]0
[ForegroundProbe]::GetWindowThreadProcessId($hwnd, [ref]$pidValue) | Out-Null

$classBuilder = New-Object System.Text.StringBuilder 256
[ForegroundProbe]::GetClassName($hwnd, $classBuilder, 256) | Out-Null

$titleBuilder = New-Object System.Text.StringBuilder 512
[ForegroundProbe]::GetWindowText($hwnd, $titleBuilder, 512) | Out-Null

$exeName = ""
$exePath = ""
$hProcess = [ForegroundProbe]::OpenProcess($PROCESS_QUERY_LIMITED_INFORMATION, $false, $pidValue)
if ($hProcess -ne [IntPtr]::Zero) {
    $size = [uint32]1024
    $pathBuilder = New-Object System.Text.StringBuilder 1024
    if ([ForegroundProbe]::QueryFullProcessImageName($hProcess, 0, $pathBuilder, [ref]$size)) {
        $exePath = $pathBuilder.ToString()
        $exeName = [System.IO.Path]::GetFileName($exePath)
    }
    [ForegroundProbe]::CloseHandle($hProcess) | Out-Null
}

Write-Output ("HWND=" + $hwnd.ToInt64())
Write-Output ("PID=" + $pidValue)
Write-Output ("EXE=" + $exeName)
Write-Output ("PATH=" + $exePath)
Write-Output ("CLASS=" + $classBuilder.ToString())
Write-Output ("TITLE=" + $titleBuilder.ToString())
