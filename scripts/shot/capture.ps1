param(
  [string]$Out = "$env:TEMP\chatless-shot.png",
  [string]$TitleLike = "Chatless",
  [int]$X = 16,
  [int]$Y = 16,
  [int]$Width = 1470,
  [int]$Height = 820,
  [switch]$NoResize,
  [switch]$AllowTitleMatch
)

# Capture the app window, or say why it could not.
#
# Two traps this encodes, both measured on this machine (2026-10-20):
#   * PrintWindow on a WebView2 window returns the frame and a BLACK content area, because the
#     content is drawn by an accelerated layer. Capturing the screen rect is the only path.
#   * PowerShell is not DPI-aware by default: at 125% scaling GetWindowRect reports 0.8x the real
#     size, so the capture silently loses the right edge. SetProcessDPIAware() first, then every
#     number here is physical pixels.
# `FG=` in the output is the honest bit: if the window could not be brought to the front, the
# screenshot shows whatever was on top, and the run should not be trusted.

Add-Type -AssemblyName System.Drawing

$sig = @'
using System;
using System.Runtime.InteropServices;
public class ChatlessShot {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
if (-not ("ChatlessShot" -as [type])) { Add-Type -TypeDefinition $sig }
[void][ChatlessShot]::SetProcessDPIAware()

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
  Write-Output "NO_WINDOW: no process whose window title contains '$TitleLike'. Start it with 'pnpm tauri dev' or run src-tauri/target/debug/chatless.exe next to 'pnpm dev'."
  exit 2
}
$hwnd = $target.MainWindowHandle

[void][ChatlessShot]::ShowWindow($hwnd, 9)
if (-not $NoResize) {
  # Physical pixels. Keep the size inside the work area: a window taller than the desktop looks
  # like a layout bug in the screenshot and is not one.
  [void][ChatlessShot]::MoveWindow($hwnd, $X, $Y, $Width, $Height, $true)
}
[void][ChatlessShot]::BringWindowToTop($hwnd)
[void][ChatlessShot]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 900

$rect = New-Object ChatlessShot+RECT
[void][ChatlessShot]::GetWindowRect($hwnd, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top

$bitmap = New-Object System.Drawing.Bitmap $w, $h
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

$front = [ChatlessShot]::GetForegroundWindow() -eq $hwnd
Write-Output ("FG=" + $front + " rect=" + $rect.Left + "," + $rect.Top + " " + $w + "x" + $h + " SAVED: " + $Out)
if (-not $front) {
  Write-Output "WARNING: the window is not in the foreground, so the image may show another window. Close or minimise whatever is on top and run again."
}
