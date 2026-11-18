# PROTOTYPE (PoC 0 spike) - throwaway.
#
# Purpose: the PoC 0 page cannot read the memory of Chrome's GPU process, so this small
# local helper reports it. The page's "auto record memory" button asks it over HTTP
# and stores the numbers in the checkpoint table.
#
# Run (Windows PowerShell 5.1, no administrator rights, installs nothing):
#   powershell -NoProfile -ExecutionPolicy Bypass -File poc0-memprobe.ps1
#
# It listens on 127.0.0.1:47011 only (this machine, nothing on the network) and answers
#   GET /mem   JSON with system memory, chrome.exe / msedge.exe memory by process type,
#              and per-process GPU memory of those browsers
#   OPTIONS    CORS / Private Network Access preflight (204)
# Stop it with Ctrl+C. It writes nothing to disk.
#
# totalBrowserMB = private memory of all browser processes + GPU dedicated memory.
# totalWithSharedMB = the same + GPU shared memory. On integrated GPUs the model weights live
# in shared GPU memory; whether that is already counted in the processes' private bytes is
# unverified, so both totals are reported.
#
# Requests whose Host header is not exactly 127.0.0.1:47011 or localhost:47011 are answered
# 403 (guards against DNS rebinding), in addition to the Origin allowlist.

$ErrorActionPreference = 'Stop'
$Port = 47011
$MB = 1048576

function Round-MB($bytes) { [math]::Round(([double]$bytes) / $MB, 1) }

function Get-MemSnapshot {
  $os = Get-CimInstance Win32_OperatingSystem
  $system = [ordered]@{
    totalMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 1)   # KB -> MB
    freeMB  = [math]::Round($os.FreePhysicalMemory / 1024, 1)
  }

  # Browser processes: classify by the --type=xxx switch (none = the browser main process).
  $procInfo = @{}   # pid -> @{ name; type }
  $cim = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'")
  foreach ($p in $cim) {
    $type = 'browser'
    if ($p.CommandLine -match '--type=([\w-]+)') { $type = $Matches[1] }
    $procInfo[[int]$p.ProcessId] = @{ name = ($p.Name -replace '\.exe$', ''); type = $type }
  }
  $mem = @{}        # pid -> process object
  if ($procInfo.Count -gt 0) {
    foreach ($proc in @(Get-Process -Id ([int[]]@($procInfo.Keys)) -ErrorAction SilentlyContinue)) { $mem[[int]$proc.Id] = $proc }
  }

  $browsers = [ordered]@{}
  $all = @{ count = 0; privateMB = 0.0; workingSetMB = 0.0 }
  foreach ($name in 'chrome', 'msedge') {
    $byType = [ordered]@{}
    $sum = @{ count = 0; privateMB = 0.0; workingSetMB = 0.0 }
    foreach ($procId in $procInfo.Keys) {
      $info = $procInfo[$procId]
      if ($info.name -ne $name -or -not $mem.ContainsKey($procId)) { continue }
      $priv = Round-MB $mem[$procId].PrivateMemorySize64
      $ws = Round-MB $mem[$procId].WorkingSet64
      if (-not $byType.Contains($info.type)) { $byType[$info.type] = @{ count = 0; privateMB = 0.0; workingSetMB = 0.0 } }
      $t = $byType[$info.type]
      $t.count += 1; $t.privateMB = [math]::Round($t.privateMB + $priv, 1); $t.workingSetMB = [math]::Round($t.workingSetMB + $ws, 1)
      $sum.count += 1; $sum.privateMB = [math]::Round($sum.privateMB + $priv, 1); $sum.workingSetMB = [math]::Round($sum.workingSetMB + $ws, 1)
    }
    $browsers[$name] = [ordered]@{ byType = $byType; total = $sum }
    $all.count += $sum.count
    $all.privateMB = [math]::Round($all.privateMB + $sum.privateMB, 1)
    $all.workingSetMB = [math]::Round($all.workingSetMB + $sum.workingSetMB, 1)
  }
  $browsers['total'] = $all

  # GPU memory per process (class name is independent of the Windows display language).
  # Name looks like: pid_37256_luid_0x..._phys_0 ; DedicatedUsage / SharedUsage are bytes.
  $gpu = [ordered]@{ available = $true; dedicatedMB = 0.0; sharedMB = 0.0; gpuProcessDedicatedMB = 0.0; gpuProcessSharedMB = 0.0 }
  try {
    $rows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory)
    foreach ($row in $rows) {
      if ($row.Name -notmatch '^pid_(\d+)_') { continue }
      $rowPid = [int]$Matches[1]
      if (-not $procInfo.ContainsKey($rowPid)) { continue }
      $ded = Round-MB $row.DedicatedUsage
      $sh = Round-MB $row.SharedUsage
      $gpu.dedicatedMB = [math]::Round($gpu.dedicatedMB + $ded, 1)
      $gpu.sharedMB = [math]::Round($gpu.sharedMB + $sh, 1)
      if ($procInfo[$rowPid].type -eq 'gpu-process') {
        $gpu.gpuProcessDedicatedMB = [math]::Round($gpu.gpuProcessDedicatedMB + $ded, 1)
        $gpu.gpuProcessSharedMB = [math]::Round($gpu.gpuProcessSharedMB + $sh, 1)
      }
    }
  } catch {
    $gpu = [ordered]@{ available = $false; error = $_.Exception.Message; dedicatedMB = 0.0; sharedMB = 0.0; gpuProcessDedicatedMB = 0.0; gpuProcessSharedMB = 0.0 }
  }

  [ordered]@{
    at = (Get-Date).ToString('o')
    system = $system
    browsers = $browsers
    gpu = $gpu
    totalBrowserMB = [math]::Round($all.privateMB + $gpu.dedicatedMB, 1)
    totalWithSharedMB = [math]::Round($all.privateMB + $gpu.dedicatedMB + $gpu.sharedMB, 1)
    note = 'totalBrowserMB = private memory of all chrome.exe/msedge.exe processes + GPU dedicated memory of those processes. totalWithSharedMB = totalBrowserMB + GPU shared memory of those processes. On integrated GPUs model weights are placed in shared GPU memory; whether that is already included in the private bytes is unverified, so both totals are reported.'
  }
}

# Only the spike page (GitHub Pages) and local dev servers may read the numbers; any other
# site the browser visits while this runs gets no CORS header and cannot read the response.
$AllowedOrigin = '^(https://cxphoenix\.github\.io|http://(localhost|127\.0\.0\.1)(:\d+)?)$'

function Send-Response($stream, [int]$code, [string]$reason, [string]$contentType, [string]$body, [string]$origin) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $head = "HTTP/1.1 $code $reason`r`n" + "Vary: Origin`r`n"
  if ($origin -match $AllowedOrigin) { $head += "Access-Control-Allow-Origin: $origin`r`n" }
  $head = $head +
    "Access-Control-Allow-Methods: GET`r`n" +
    "Access-Control-Allow-Headers: *`r`n" +
    "Access-Control-Allow-Private-Network: true`r`n" +
    "Cache-Control: no-store`r`n"
  if ($contentType) { $head += "Content-Type: $contentType`r`n" }
  $head += "Content-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

function Handle-Client($client) {
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 2000
    $buf = New-Object byte[] 8192
    $text = ''
    while ($text -notmatch "`r`n`r`n" -and $text.Length -lt 65536) {
      $n = $stream.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      $text += [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    }
    $first = ($text -split "`r`n")[0]
    $parts = $first -split ' '
    $method = $parts[0]
    $path = if ($parts.Length -gt 1) { ($parts[1] -split '\?')[0] } else { '' }
    $origin = ''
    if ($text -match "(?im)^Origin:\s*(\S+)") { $origin = $Matches[1] }
    $reqHost = ''
    if ($text -match "(?im)^Host:[ \t]*(\S+)") { $reqHost = $Matches[1] }
    if ($reqHost -ne '127.0.0.1:47011' -and $reqHost -ne 'localhost:47011') {
      # Wrong or missing Host (e.g. DNS rebinding): refuse before routing.
      Send-Response $stream 403 'Forbidden' 'text/plain' 'forbidden host' $origin
    } elseif ($method -eq 'OPTIONS') {
      Send-Response $stream 204 'No Content' '' '' $origin
    } elseif ($method -eq 'GET' -and $path -eq '/mem') {
      try {
        $json = Get-MemSnapshot | ConvertTo-Json -Depth 8 -Compress
        Send-Response $stream 200 'OK' 'application/json' $json $origin
      } catch {
        $err = @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
        Send-Response $stream 500 'Internal Server Error' 'application/json' $err $origin
      }
    } else {
      Send-Response $stream 404 'Not Found' 'text/plain' 'not found' $origin
    }
  } catch {
    # Malformed or timed-out request: drop the connection.
  } finally {
    $client.Close()
  }
}

# Bind to the loopback address only. TcpListener needs no URL ACL / administrator rights.
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "PoC 0 memprobe: listening on 127.0.0.1:$Port (this machine only). GET /mem returns browser and GPU memory. Press Ctrl+C to stop."
try {
  while ($true) {
    # Poll instead of blocking in AcceptTcpClient so that Ctrl+C is handled promptly.
    if ($listener.Pending()) { Handle-Client ($listener.AcceptTcpClient()) } else { Start-Sleep -Milliseconds 100 }
  }
} finally {
  $listener.Stop()
}
