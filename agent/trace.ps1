<#
.SYNOPSIS
  KGFFC network trace agent. Runs a real traceroute from THIS machine and writes a sanitized
  JSON report for the /status/ dashboard.

.DESCRIPTION
  Privacy by design: the report contains hop numbers, milliseconds and a role label
  (local gateway, ISP, internet, destination). It never contains IP addresses, router names,
  VPN adapter names or your machine name.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File agent\trace.ps1
  powershell -ExecutionPolicy Bypass -File agent\trace.ps1 -Target www.bungie.net -Out public\status\data\trace.json
#>
param(
  [string]$Target = "www.bungie.net",
  [int]$MaxHops = 20,
  [string]$Out = "trace.json"
)

$ErrorActionPreference = "SilentlyContinue"

function Get-HopKind([string]$ip, [int]$n, [bool]$isLast, [bool]$vpn) {
  if (-not $ip) { return @{ kind = "timeout"; label = "No reply (many routers ignore probes)" } }
  $o = $ip.Split(".") | ForEach-Object { [int]$_ }
  $private = ($o[0] -eq 10) -or ($o[0] -eq 172 -and $o[1] -ge 16 -and $o[1] -le 31) -or ($o[0] -eq 192 -and $o[1] -eq 168) -or ($o[0] -eq 169 -and $o[1] -eq 254)
  $cgnat = ($o[0] -eq 100 -and $o[1] -ge 64 -and $o[1] -le 127)
  if ($n -eq 1 -and $private) { return @{ kind = "gateway"; label = "Local gateway (your router)" } }
  if ($private) {
    if ($vpn) { return @{ kind = "vpn"; label = "Private / VPN network" } }
    return @{ kind = "private"; label = "Private network hop" }
  }
  if ($cgnat) { return @{ kind = "isp"; label = "ISP carrier network" } }
  if ($isLast) { return @{ kind = "destination"; label = "Destination" } }
  return @{ kind = "internet"; label = "Internet hop" }
}

# --- VPN: is a VPN-style adapter up? (names are never reported)
$vpnPattern = "VPN|TAP-|TUN|WireGuard|Wintun|OpenVPN|Tailscale|ZeroTier|AnyConnect|GlobalProtect|PANGP|Fortinet|Pulse|Nord|Proton|Mullvad|L2TP|PPTP|IKEv2"
$vpnAdapters = @(Get-NetAdapter | Where-Object { $_.Status -eq "Up" -and ($_.InterfaceDescription -match $vpnPattern -or $_.Name -match $vpnPattern) })
$vpnConn = @(Get-VpnConnection | Where-Object { $_.ConnectionStatus -eq "Connected" })
$vpnUp = ($vpnAdapters.Count + $vpnConn.Count) -gt 0

# --- DNS timing
$dnsMs = $null
$sw = [Diagnostics.Stopwatch]::StartNew()
$resolved = Resolve-DnsName $Target -Type A -DnsOnly
$sw.Stop()
if ($resolved) { $dnsMs = [int]$sw.ElapsedMilliseconds }

# --- Gateway health: 4 quick pings to the default gateway (address never reported)
$gw = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" | Sort-Object RouteMetric | Select-Object -First 1).NextHop
$gateway = $null
if ($gw -and $gw -ne "0.0.0.0") {
  $p = @(Test-Connection -ComputerName $gw -Count 4 -ErrorAction SilentlyContinue)
  $lossPct = [int](100 * (4 - $p.Count) / 4)
  $avg = $null
  if ($p.Count -gt 0) { $avg = [math]::Round(($p | Measure-Object -Property ResponseTime -Average).Average, 1) }
  $gateway = @{ ms = $avg; lossPct = $lossPct }
}

# --- Real traceroute (numeric only, so no router names are ever resolved)
$lines = tracert -d -h $MaxHops -w 1500 $Target
$reached = [bool]($lines | Select-String "Trace complete")
$rows = @()
foreach ($l in $lines) {
  if ($l -notmatch "^\s*(\d+)\s+(.*)$") { continue }
  $n = [int]$Matches[1]; $rest = $Matches[2]
  $times = @()
  foreach ($m in [regex]::Matches($rest, "(<?\d+)\s*ms|\*")) {
    if ($m.Value -eq "*") { continue }
    $v = $m.Groups[1].Value
    if ($v.StartsWith("<")) { $times += 0.5 } else { $times += [double]$v }
  }
  $ip = $null
  $ipm = [regex]::Match($rest, "(\d{1,3}\.){3}\d{1,3}\s*$")
  if ($ipm.Success) { $ip = $ipm.Value.Trim() }
  $sent = 3
  $rows += [pscustomobject]@{ n = $n; times = $times; ip = $ip; lossPct = [int](100 * ($sent - $times.Count) / $sent) }
}

$hops = @()
for ($i = 0; $i -lt $rows.Count; $i++) {
  $r = $rows[$i]
  $isLast = ($i -eq $rows.Count - 1) -and $reached
  $k = Get-HopKind $r.ip $r.n $isLast $vpnUp
  $ms = $null
  if ($r.times.Count -gt 0) { $ms = [math]::Round(($r.times | Measure-Object -Average).Average, 1) }
  $hops += [ordered]@{ n = $r.n; ms = $ms; lossPct = $r.lossPct; kind = $k.kind; label = $k.label }
}

$msValues = @($hops | Where-Object { $_.ms -ne $null } | ForEach-Object { $_.ms })
$report = [ordered]@{
  schema      = 1
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  target      = $Target
  hops        = $hops
  vpn         = [ordered]@{ detected = $vpnUp; adapters = $vpnAdapters.Count + $vpnConn.Count }
  gateway     = $gateway
  dns         = @{ ms = $dnsMs }
  summary     = [ordered]@{
    hops     = $hops.Count
    reached  = $reached
    timeouts = @($hops | Where-Object { $_.kind -eq "timeout" }).Count
    worstMs  = if ($msValues.Count) { ($msValues | Measure-Object -Maximum).Maximum } else { $null }
  }
}

$json = $report | ConvertTo-Json -Depth 6
# Belt and braces: refuse to write anything that looks like an IP address.
if ($json -match "\b(\d{1,3}\.){3}\d{1,3}\b") { Write-Error "Sanitizer found an IP-like value; report not written."; exit 1 }
$json | Set-Content -Path $Out -Encoding UTF8
Write-Host "Wrote $Out : $($hops.Count) hops, VPN detected: $vpnUp, reached: $reached"
