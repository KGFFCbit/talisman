<#
.SYNOPSIS
  KGFFC Crash Kitchen. "Cook" records how hard and how hot the PC is working, about once a second.
  "Plate" packs that recording plus Windows' own crash clues into ONE text file for kgffc.net/crash/.

.DESCRIPTION
  Built for PCs that switch off by themselves. Every line is forced onto the disk the moment it is
  written, so a sudden power cut loses a second or two at most: the last line before the lights
  went out is the most important line in the file.

  Privacy by design: no user name, computer name, IP address, serial number or personal file is
  ever written. It needs no admin rights and installs nothing. Read it: it is plain text.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File kgffc-crash.ps1 -Mode Cook
  powershell -ExecutionPolicy Bypass -File kgffc-crash.ps1 -Mode Plate
  powershell -ExecutionPolicy Bypass -File kgffc-crash.ps1 -Mode Cook -Seconds 60
#>
param(
  [ValidateSet("Cook", "Plate")][string]$Mode = "Cook",
  [int]$Seconds = 0,   # Cook: stop after this many seconds (0 = until you press Q)
  [int]$Days = 14,     # Plate: how many days of crash clues to collect
  [string]$Out = "",   # Plate: write the file here instead of the Desktop
  [string]$Root = (Join-Path $env:LOCALAPPDATA "KGFFC")   # not Documents: that is often synced to OneDrive
)

$ErrorActionPreference = "SilentlyContinue"
$Here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RecDir = Join-Path $Root "recordings"
$Site   = "https://kgffc.net/crash/"
New-Item -ItemType Directory -Force -Path $RecDir | Out-Null

# Remove anything that could identify the kid or the PC.
function Clean([string]$s) {
  if (-not $s) { return "" }
  $s = $s -replace "[\r\n\t]+", " "
  # Folder names can be personal (C:\Users\<anyone in the family>\, D:\Jo Smith\), so a path keeps only its file name.
  $s = $s -replace '(?i)\b[a-z]:\\(?:[^\\;|"=<>]+\\)+', ''
  $s = $s -replace '\\\\[^\\\s;|"]+\\(?:[^\\;|"=<>]+\\)*', ''
  $s = $s -replace '[\w.+-]+@[\w-]+\.[\w.-]+', '~@~'
  $s = $s -replace '\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b', '~mac~'
  $s = $s -replace '\b(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}\b', '~ipv6~'
  $s = $s -replace '\b(\d{1,3}\.){3}\d{1,3}\b', 'x.x.x.x'
  # The PC's name becomes "kgffc"; user names become "~".
  foreach ($x in @($env:COMPUTERNAME, $env:USERDOMAIN)) {
    if ($x -and $x.Length -ge 3) { $s = $s -ireplace ('\b' + [regex]::Escape($x) + '\b'), 'kgffc' }
  }
  foreach ($x in @($env:USERNAME, (Split-Path $env:USERPROFILE -Leaf))) {
    if ($x -and $x.Length -ge 3) { $s = $s -ireplace ('\b' + [regex]::Escape($x) + '\b'), '~' }
  }
  if ($s.Length -gt 400) { $s = $s.Substring(0, 400) }
  return $s.Trim()
}
function Iso([datetime]$d) { $d.ToString("yyyy-MM-ddTHH:mm:ss.fffzzz") }
function Num($v) { if ($null -eq $v) { return "" }; return ([double]$v).ToString("0.###", [Globalization.CultureInfo]::InvariantCulture) }

# ---------------------------------------------------------------- COOK
function Read-Recipe {
  $list = @()
  foreach ($line in Get-Content (Join-Path $Here "kgffc-counters.txt")) {
    $l = $line.Trim()
    if (-not $l -or $l.StartsWith("#")) { continue }
    $p = @($l.Split("|") | ForEach-Object { $_.Trim() })
    if ($p.Count -lt 2 -or $p[1] -notmatch "^\\(.+?)(\((.*)\))?\\([^\\]+)$") { continue }
    $set = $Matches[1]; $inst = $Matches[3]; $ctr = $Matches[4]
    $ls = Get-Counter -ListSet $set
    if (-not $ls -or -not ($ls.Counter | Where-Object { $_ -like "*\$ctr" })) { Write-Host "  (skipping $($p[0]): this PC doesn't have it)"; continue }
    $list += [pscustomobject]@{
      Name    = $p[0]; Path = $p[1]
      Key     = ("\" + $set + "\" + $ctr).ToLower()
      Inst    = $inst
      Combine = $(if ($p.Count -ge 3 -and $p[2]) { $p[2].ToLower() } else { "one" })
      Scale   = $(if ($p.Count -ge 4 -and $p[3]) { [double]::Parse($p[3], [Globalization.CultureInfo]::InvariantCulture) } else { 1.0 })
    }
  }
  return $list
}

function Test-Nvidia {
  if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { return $null }
  foreach ($reasons in @("clocks_event_reasons.active", "clocks_throttle_reasons.active", $null)) {
    $q = "temperature.gpu,utilization.gpu,power.draw,clocks.gr,fan.speed,memory.used"
    if ($reasons) { $q += ",$reasons" }
    $o = nvidia-smi "--query-gpu=$q" --format=csv,noheader,nounits 2>$null
    if ($LASTEXITCODE -eq 0 -and $o) { return $q }
  }
  return $null
}

function Start-Cook {
  $recipe = @(Read-Recipe)
  if ($recipe.Count -eq 0) { Write-Host "Could not find kgffc-counters.txt next to this script."; return }
  $nvq = Test-Nvidia
  $nvCols = @("gpu_temp", "gpu_pct", "gpu_power", "gpu_mhz", "gpu_fan_pct", "gpu_vram_used_mb", "gpu_reasons")
  $cores = [Environment]::ProcessorCount

  $session = Join-Path $RecDir (Get-Date -Format "yyyyMMdd-HHmmss")
  New-Item -ItemType Directory -Force -Path $session | Out-Null
  $csv = Join-Path $session "counters.csv"
  $fs = New-Object IO.FileStream($csv, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read)
  $sw = New-Object IO.StreamWriter($fs, (New-Object Text.UTF8Encoding($false)))
  $cols = @("time") + @($recipe | ForEach-Object { $_.Name }) + @("top_cpu_app", "top_cpu_pct", "top_gpu_app")
  if ($nvq) { $cols += $nvCols }
  $sw.WriteLine(($cols -join ","))
  $sw.Flush(); $fs.Flush($true)

  Write-Host ""
  Write-Host "  KGFFC Crash Kitchen is COOKING." -ForegroundColor Yellow
  Write-Host "  Leave this window open (minimise it if you like) and play or work normally."
  Write-Host "  If the PC switches off: turn it back on, then double-click 2-PLATE-IT."
  Write-Host "  Finished without a crash? Press Q here, then run 2-PLATE-IT anyway."
  if ($nvq) { Write-Host "  NVIDIA card found: recording its temperature and power too." } else { Write-Host "  Tip: for CPU temperature and voltages, also run HWiNFO logging (see README)." }
  Write-Host ""

  $paths = @($recipe | ForEach-Object { $_.Path })
  $prevCpu = @{}; $prevT = Get-Date; $n = 0; $clean = $false; $start = Get-Date
  try {
    while ($true) {
      $res = Get-Counter -Counter $paths -ErrorAction SilentlyContinue
      $now = Get-Date
      $byKey = @{}
      foreach ($s in $res.CounterSamples) {
        $k = ($s.Path -replace '^\\\\[^\\]+', '') -replace '\(.*\)\\', '\'
        if (-not $byKey.ContainsKey($k)) { $byKey[$k] = New-Object Collections.ArrayList }
        [void]$byKey[$k].Add($s)
      }
      $row = @(Iso $now); $gpu3d = $null
      foreach ($c in $recipe) {
        $vals = @()
        foreach ($s in @($byKey[$c.Key])) {
          if ($null -eq $s) { continue }
          $i = "$($s.InstanceName)"
          if ($c.Inst -and $c.Inst.Contains("*")) { if ($i -like "*_total*" -or $i -notlike $c.Inst) { continue } }
          elseif ($c.Inst -and $i -ne $c.Inst.ToLower()) { continue }
          $vals += $s.CookedValue
        }
        $v = $null
        if ($vals.Count) {
          switch ($c.Combine) {
            "sum" { $v = ($vals | Measure-Object -Sum).Sum }
            "max" { $v = ($vals | Measure-Object -Maximum).Maximum }
            "min" { $v = ($vals | Measure-Object -Minimum).Minimum }
            default { $v = $vals[0] }
          }
          $v = $v * $c.Scale
        }
        if ($c.Name -eq "gpu_3d_pct") { $gpu3d = $v }
        if ($c.Name -eq "cpu_pct") { $cpuNow = $v }
        $row += (Num $v)
      }

      # Which app was the CPU / graphics card busy with? (process names only)
      $procs = @{}; foreach ($p in Get-Process) { $procs[$p.Id] = $p }
      $dt = [math]::Max(0.2, ($now - $prevT).TotalSeconds); $top = $null; $topPct = 0; $cur = @{}
      foreach ($p in $procs.Values) {
        if ($p.Id -eq 0 -or $null -eq $p.CPU) { continue }
        $cur[$p.Id] = $p.CPU
        if ($prevCpu.ContainsKey($p.Id)) {
          $pct = 100 * ($p.CPU - $prevCpu[$p.Id]) / $dt / $cores
          if ($pct -gt $topPct) { $topPct = $pct; $top = $p.ProcessName }
        }
      }
      $prevCpu = $cur; $prevT = $now
      $gpuPid = @{}
      foreach ($s in @($byKey["\gpu engine\utilization percentage"])) {
        if ($s -and $s.InstanceName -match "^pid_(\d+)_" -and $s.InstanceName -like "*engtype_3d") { $gpuPid[[int]$Matches[1]] += $s.CookedValue }
      }
      $topGpu = $null
      if ($gpuPid.Count) {
        $best = $gpuPid.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
        if ($best.Value -ge 1 -and $procs.ContainsKey($best.Key)) { $topGpu = $procs[$best.Key].ProcessName }
      }
      $row += @(('"' + (Clean $top) + '"'), (Num $topPct), ('"' + (Clean $topGpu) + '"'))

      if ($nvq) {
        $o = @(nvidia-smi "--query-gpu=$nvq" --format=csv,noheader,nounits 2>$null)
        $f = @(); if ($o.Count) { $f = @($o[0].Split(",") | ForEach-Object { $_.Trim() }) }
        for ($j = 0; $j -lt $nvCols.Count; $j++) {
          $x = $(if ($j -lt $f.Count) { $f[$j] } else { "" })
          if ($x -match "^0x[0-9a-fA-F]+$") { $x = [Convert]::ToInt64($x.Substring(2), 16) }
          elseif ($x -notmatch "^-?[\d.]+$") { $x = "" }
          $row += "$x"
        }
      }

      $sw.WriteLine(($row -join ","))
      $sw.Flush(); $fs.Flush($true)   # straight to the disk, not just the cache
      $n++

      $el = (Get-Date) - $start
      $gtxt = $(if ($null -ne $gpu3d) { "GPU {0,3:N0}%" -f [math]::Min(100, $gpu3d) } else { "" })
      Write-Host -NoNewline ("`r  Cooking {0:hh\:mm\:ss}   CPU {1,3:N0}%   {2}   lines saved: {3}   (press Q to stop)  " -f $el, [double]$cpuNow, $gtxt, $n)
      if ($Seconds -gt 0 -and $el.TotalSeconds -ge $Seconds) { $clean = $true; break }
      try { if ([Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq "Q") { $clean = $true; break } } catch { }
    }
  } finally {
    $sw.Close()
    if ($clean) { Set-Content -Path (Join-Path $session "stopped.txt") -Value (Iso (Get-Date)) }
    Write-Host ""
    Write-Host "  Stopped. Saved $n lines to $session" -ForegroundColor Yellow
    Write-Host "  Next: double-click 2-PLATE-IT to make the file for the website."
  }
}

# ---------------------------------------------------------------- PLATE
function Get-Clues([datetime]$since) {
  $q = @(
    @{ LogName = "System"; ProviderName = "Microsoft-Windows-Kernel-Power"; Id = 41, 109 },
    @{ LogName = "System"; ProviderName = "EventLog"; Id = 6005, 6006, 6008 },
    @{ LogName = "System"; ProviderName = "User32"; Id = 1074 },
    @{ LogName = "System"; ProviderName = "Microsoft-Windows-WER-SystemErrorReporting" },
    @{ LogName = "System"; ProviderName = "Microsoft-Windows-WHEA-Logger" },
    @{ LogName = "System"; ProviderName = "Microsoft-Windows-Kernel-Processor-Power"; Id = 37 },
    @{ LogName = "System"; ProviderName = "Display" },
    @{ LogName = "System"; ProviderName = "nvlddmkm"; Level = 1, 2, 3 },
    @{ LogName = "System"; ProviderName = "amdkmdag"; Level = 1, 2, 3 },
    @{ LogName = "System"; ProviderName = "disk"; Level = 1, 2, 3 },
    @{ LogName = "System"; ProviderName = "stornvme"; Level = 1, 2, 3 },
    @{ LogName = "System"; ProviderName = "storahci"; Level = 1, 2, 3 },
    @{ LogName = "System"; ProviderName = "Microsoft-Windows-Ntfs"; Level = 1, 2, 3 },
    @{ LogName = "System"; ProviderName = "volmgr"; Level = 1, 2, 3 },
    @{ LogName = "Application"; ProviderName = "Application Error"; Id = 1000 },
    @{ LogName = "Application"; ProviderName = "Windows Error Reporting"; Id = 1001 }
  )
  $all = @()
  foreach ($f in $q) {
    $f.StartTime = $since
    $ev = @(Get-WinEvent -FilterHashtable $f -MaxEvents 300 -ErrorAction SilentlyContinue)
    if ($f.ProviderName -eq "Windows Error Reporting") { $ev = @($ev | Where-Object { $_.Message -match "LiveKernelEvent|BlueScreen" }) }
    if ($f.ProviderName -eq "Application Error") { $ev = @($ev | Select-Object -First 60) }
    $all += $ev
  }
  $rows = foreach ($e in ($all | Sort-Object TimeCreated | Select-Object -Last 900)) {
    $data = @()
    try {
      $i = 0
      foreach ($d in ([xml]$e.ToXml()).Event.EventData.Data) {
        $name = $(if ($d.Name) { $d.Name } else { "P$i" }); $i++
        $val = $(if ($d -is [string]) { $d } else { $d.'#text' })
        if ($val -and $name -notmatch "RawData|Binary") { $data += "$name=$(Clean $val)" }
      }
    } catch { }
    $msg = "$($e.Message)"; $cut = $msg.IndexOf("`n", 200); if ($cut -gt 0) { $msg = $msg.Substring(0, $cut) }
    [pscustomobject]@{ time = Iso $e.TimeCreated; provider = $e.ProviderName; id = $e.Id; level = $e.Level; data = (Clean (($data -join ";"))); message = (Clean $msg) }
  }
  return $rows
}

function Start-Plate {
  $sb = New-Object Text.StringBuilder
  function Add([string]$s) { [void]$sb.AppendLine($s) }

  $sess = Get-ChildItem $RecDir -Directory | Sort-Object Name -Descending | Select-Object -First 1
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  $os = Get-CimInstance Win32_OperatingSystem
  $bb = Get-CimInstance Win32_BaseBoard
  $bios = Get-CimInstance Win32_BIOS
  $mem = @(Get-CimInstance Win32_PhysicalMemory)

  Add "#KGFFC-PLATE v1"
  Add "[SYSTEM]"
  Add "created=$(Iso (Get-Date))"
  Add "tz_offset_min=$([int][TimeZoneInfo]::Local.GetUtcOffset((Get-Date)).TotalMinutes)"
  Add "cpu=$(Clean $cpu.Name)"
  Add "cpu_cores=$($cpu.NumberOfCores)"
  Add "cpu_threads=$($cpu.NumberOfLogicalProcessors)"
  $g = 0
  foreach ($v in Get-CimInstance Win32_VideoController) {
    $g++; $dd = $(if ($v.DriverDate) { $v.DriverDate.ToString("yyyy-MM-dd") } else { "" })
    Add "gpu$g=$(Clean $v.Name) | driver $($v.DriverVersion) | $dd"
  }
  Add "board=$(Clean "$($bb.Manufacturer) $($bb.Product)")"
  Add "bios=$(Clean $bios.SMBIOSBIOSVersion) | $(if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') })"
  Add "ram_total_gb=$([math]::Round(($mem | Measure-Object Capacity -Sum).Sum / 1GB))"
  Add "ram_sticks=$($mem.Count)"
  if ($mem.Count) { Add "ram_speed=rated $($mem[0].Speed) MT/s, running $($mem[0].ConfiguredClockSpeed) MT/s | $(Clean $mem[0].Manufacturer) $(Clean $mem[0].PartNumber)" }
  Add "os=$(Clean $os.Caption) build $($os.BuildNumber)"
  Add "last_boot=$(Iso $os.LastBootUpTime)"
  $plan = (powercfg /getactivescheme) -replace '^.*\((.*)\).*$', '$1'
  Add "power_plan=$(Clean "$plan")"
  $cc = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl"
  Add "crash_dumps=$(switch ($cc.CrashDumpEnabled) { 0 {'off'} 1 {'complete'} 2 {'kernel'} 3 {'small'} 7 {'automatic'} default {'unknown'} })"
  $md = Join-Path $env:SystemRoot "Minidump"
  if (-not (Test-Path $md)) { Add "minidumps=0" }
  else {
    try {
      $dumps = @(Get-ChildItem $md -Filter *.dmp -ErrorAction Stop | Sort-Object LastWriteTime)
      Add "minidumps=$($dumps.Count)$(if ($dumps.Count) { ' | newest ' + (Iso $dumps[-1].LastWriteTime) })"
    } catch { Add "minidumps=unknown (Windows only lets an admin count them)" }
  }
  $disks = @(Get-PhysicalDisk | ForEach-Object { "$(Clean $_.FriendlyName) ($($_.HealthStatus))" })
  Add "disks=$($disks -join '; ')"

  Add "[SESSION]"
  if ($sess) {
    $stop = Join-Path $sess.FullName "stopped.txt"
    Add "name=$($sess.Name)"
    Add "stopped_cleanly=$(if (Test-Path $stop) { 'yes' } else { 'no' })"
  } else { Add "name=none" }

  Write-Host "  Collecting Windows crash clues from the last $Days days..."
  Add "[EVENTS]"
  $ev = @(Get-Clues (Get-Date).AddDays(-$Days))
  if ($ev.Count) { $ev | ConvertTo-Csv -NoTypeInformation | ForEach-Object { Add $_ } } else { Add '"time","provider","id","level","data","message"' }

  if ($sess) {
    $csv = Join-Path $sess.FullName "counters.csv"
    if (Test-Path $csv) {
      Add "[COUNTERS]"
      Get-Content $csv -Encoding UTF8 | ForEach-Object { Add $_ }
    }
    # Optional HWiNFO log (temperatures and voltages): newest CSV next to this script, in Documents\KGFFC or in $Root.
    $since = $sess.CreationTime.AddHours(-1)
    $hw = Get-ChildItem -Path $Here, $Root, (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "KGFFC") -Filter *.csv -File | Where-Object { $_.LastWriteTime -gt $since } |
      Where-Object { (Get-Content $_.FullName -TotalCount 1 -Encoding Default) -match '^"?Date"?,"?Time"?' } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($hw) {
      Write-Host "  Found HWiNFO log: $($hw.Name)"
      Add "[HWINFO]"
      $tail = @(Get-Content $hw.FullName -Tail 30000 -Encoding Default)   # the newest ~16 hours at HWiNFO's 2 s default
      Add (Get-Content $hw.FullName -TotalCount 1 -Encoding Default)       # header: sensor labels
      $tail | Where-Object { $_ -match '^"?\d' } | ForEach-Object { Add $_ }  # data rows only: HWiNFO's footer can name drive serials
    }
  }
  Add "[END]"

  $file = $Out
  if (-not $file) { $file = Join-Path ([Environment]::GetFolderPath("Desktop")) ("KGFFC-plate-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".txt") }
  [IO.File]::WriteAllText($file, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
  Write-Host ""
  Write-Host "  PLATED! Your file is on the Desktop: $(Split-Path $file -Leaf)" -ForegroundColor Yellow
  Write-Host "  Now open $Site and drop that file on the page."
  Write-Host "  (Nothing is uploaded. The page reads the file inside your browser.)"
  if (-not $Out) { Start-Process explorer.exe "/select,`"$file`"" }
}

if ($Mode -eq "Cook") { Start-Cook } else { Start-Plate }
