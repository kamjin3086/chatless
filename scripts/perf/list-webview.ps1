Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | ForEach-Object {
  $uud = ''
  if ($_.CommandLine -match '--user-data-dir="?([^" ]+)"?') { $uud = $Matches[1] }
  [PSCustomObject]@{ Pid = $_.ProcessId; UUD = $uud }
} | Group-Object UUD | ForEach-Object { "{0,3}  {1}" -f $_.Count, $_.Name }
Write-Output "--- chatless procs:"
Get-Process chatless -ErrorAction SilentlyContinue | Select-Object Id, StartTime
