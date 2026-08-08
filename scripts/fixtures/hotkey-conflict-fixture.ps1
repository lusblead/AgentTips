# Test-only hotkey conflict fixture.
# Registers Ctrl + F10 (0x0002 | VK_F10=0x79) to simulate another app
# already owning that hotkey. Test-only; never shipped in product runtime.
# Does not modify system config or registry.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class HotkeyConflictFixture
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
}
"@

$modControl = 0x0002
$vkF10 = 0x79
$registered = [HotkeyConflictFixture]::RegisterHotKey([IntPtr]::Zero, 1, $modControl, $vkF10)
Write-Output "hotkey-conflict-fixture registered=$registered"
[Console]::Out.Flush()

# Keep process alive (hotkey registration lives with the process)
Start-Sleep -Seconds 600
