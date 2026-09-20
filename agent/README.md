# Trace agent

`trace.ps1` runs a real traceroute from the computer that has the problem and writes a sanitized
`trace.json` for the dashboard at https://kgffc.net/status/.

```powershell
powershell -ExecutionPolicy Bypass -File agent\trace.ps1 -Out trace.json
```

Then open the dashboard and press **Load trace file**.

## What it reports

Hop number, milliseconds, packet loss, and a role label (local gateway, private/VPN, ISP, internet,
destination). It also reports whether a VPN adapter is up, DNS lookup time, and router latency/loss.

## What it never reports

IP addresses, router or host names, VPN adapter names, or the machine name. The script traces with
numeric addresses, converts each hop to a role, and refuses to write the file if anything that
looks like an IP address survives. The dashboard applies the same check when a file is loaded.

## Layout

| Folder | Role |
| --- | --- |
| `api/` | Backend: `health.js` (probes), `inventory.js` (Bungie refresh + telemetry), `_lib/` (shared helpers) |
| `agent/` | Backend: local trace agent (this folder) |
| `public/status/` | Front end: the dashboard. Renders only; measures nothing itself |
| `public/shared/` | Front end: refresh + telemetry plumbing shared by the inventory and dashboard pages |
