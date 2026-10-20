param(
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [int]$Wheel = 0,
  [string]$TitleLike = "Chatless",
  [switch]$AllowTitleMatch
)

# Click (or wheel) inside the app window, in physical pixels.
#
# Coordinates are screen coordinates, i.e. what `capture.ps1` reported plus the point you measured
# in the image. Callers get this wrong in one way: PowerShell is not DPI-aware by default, so at
# 125% scaling a click lands at 0.8x the intended point. SetProcessDPIAware() first.
# Pass -Wheel -360 to scroll down three notches (no click), which is how a long page is scrolled
# without a visible scrollbar.

$sig = @'
using System;
using System.Runtime.InteropServices;
public class ChatlessClick {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, int e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
'@
if (-not ("ChatlessClick" -as [type])) { Add-Type -TypeDefinition $sig }
[void][ChatlessClick]::SetProcessDPIAware()

# The app's own process, by name. A title match is not a target: one run "captured" a Chrome
# window titled "chatless - Pi Web" and reported success. Pass -AllowTitleMatch when the target
# really is something else.
$target = Get-Process -Name chatless -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $target -and $AllowTitleMatch) {
  $target = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "*$TitleLike*" -and $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
    if ($target) { Write-Output ("WARNING: matching by title - got '" + $target.MainWindowTitle + "' (" + $target.ProcessName + ").") }
}
if (-not $target) {
  Write-Output "NO_WINDOW: no process whose window title contains '$TitleLike'."
  exit 2
}
[void][ChatlessClick]::BringWindowToTop($target.MainWindowHandle)
[void][ChatlessClick]::SetForegroundWindow($target.MainWindowHandle)
Start-Sleep -Milliseconds 350

[void][ChatlessClick]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 150
if ($Wheel -ne 0) {
  [ChatlessClick]::mouse_event(0x0800, 0, 0, [uint32]$Wheel, 0)
  Write-Output "wheel $Wheel at $X,$Y"
} else {
  [ChatlessClick]::mouse_event(0x0002, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 70
  [ChatlessClick]::mouse_event(0x0004, 0, 0, 0, 0)
  Write-Output "click $X,$Y"
}
