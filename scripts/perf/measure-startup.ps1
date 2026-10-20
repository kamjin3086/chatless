# Startup timing probe: launches the app exe, records timestamps for
# process start -> window created -> window visible -> first paint-ish,
# then kills the app after a settle period.
param(
  [Parameter(Mandatory=$true)][string]$Exe,
  [int]$SettleMs = 20000,
  [string]$Tag = "run"
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
}
'@

$logPath = Join-Path $env:LOCALAPPDATA "com.kamjin.chatless\logs\logs.log"
$logOffset = if (Test-Path $logPath) { (Get-Item $logPath).Length } else { 0 }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $Exe -PassThru
$t0 = Get-Date

$windowHwnd = [IntPtr]::Zero
$tHwnd = $null
$tVisible = $null
$tEnabled = $null

while ($sw.ElapsedMilliseconds -lt $SettleMs) {
  Start-Sleep -Milliseconds 25
  $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if ($null -eq $p) { break }
  $hwnd = $p.MainWindowHandle
  if ($hwnd -ne [IntPtr]::Zero) {
    if ($null -eq $tHwnd) { $script:tHwnd = $sw.ElapsedMilliseconds }
    if ($null -eq $tVisible -and [Win32]::IsWindowVisible($hwnd)) { $script:tVisible = $sw.ElapsedMilliseconds }
    if ($null -eq $tEnabled -and [Win32]::IsWindowEnabled($hwnd)) { $script:tEnabled = $sw.ElapsedMilliseconds }
  }
  if ($null -ne $tEnabled -and $sw.ElapsedMilliseconds -gt 6000) { break }
}

$tEnd = $sw.ElapsedMilliseconds
$ws = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue).WorkingSet64

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
# give the process a moment, then drain WAL etc.
Start-Sleep -Milliseconds 500
Stop-Process -Name chatless -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 300
$newLogs = ""
if (Test-Path $logPath) {
  $fs = [System.IO.File]::Open($logPath, 'Open', 'Read', 'ReadWrite')
  $fs.Seek($logOffset, 'Begin') | Out-Null
  $sr = New-Object System.IO.StreamReader($fs)
  $newLogs = $sr.ReadToEnd()
  $sr.Close(); $fs.Close()
}
$outLog = "D:\aicodeWorkspace\chatless\scripts\perf\startup-log-$Tag.txt"
$newLogs | Out-File -Encoding utf8 $outLog

Write-Output "=== [$Tag] $Exe ==="
Write-Output ("window_hwnd_ms  : {0}" -f $tHwnd)
Write-Output ("window_visible_ms: {0}" -f $tVisible)
Write-Output ("window_enabled_ms: {0}" -f $tEnabled)
Write-Output ("loop_end_ms     : {0}" -f $tEnd)
Write-Output ("working_set_mb  : {0:N1}" -f ($ws / 1MB))
Write-Output ("new_log_lines   : {0}" -f (($newLogs -split "`n" | Where-Object {$_ -ne ''}).Count))
Write-Output ("log_saved       : {0}" -f $outLog)
