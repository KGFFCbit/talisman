// KGFFC Crash Kitchen — two made-up sessions so visitors can try the page without a recording.
// They are written as a real plate file and go through the same parser as an upload.

function rng(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const p2 = (n) => String(n).padStart(2, "0");
function iso(t) {
  const d = new Date(t), off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}${off >= 0 ? "+" : "-"}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}
const f = (x, d = 1) => x.toFixed(d);

export function demoPlate(kind) {
  const crash = kind === "crash";
  const R = rng(crash ? 41 : 7), n = (s) => (R() - 0.5) * 2 * s;
  const secs = crash ? 26 * 60 : 22 * 60;
  const end = Math.floor(Date.now() / 1000) * 1000 - 3 * 3600e3, start = end - secs * 1000;

  // phase → [cpu%, gpu%, cpuTemp, gpuTemp, gpuW, cpuW, app, gpuApp]
  const phase = (s) => {
    if (!crash) return s < 90 ? [8, 4, 46, 40, 28, 38, "explorer", "dwm"] : [46, 96, 77, 70, 262, 78, "FortniteClient", "FortniteClient"];
    if (s < 300) return [7, 3, 45, 39, 25, 36, "explorer", "dwm"];
    if (s < 840) return [55 + 35 * Math.max(0, Math.sin(s / 9)), 18, 74, 46, 70, 84, "Photoshop", "Photoshop"];
    if (s < 1200) return [44, 97, 76, 71, 284, 76, "Cyberpunk2077", "Cyberpunk2077"];
    if (s < secs - 40) return [12, 28, 58, 55, 95, 45, "Steam", "Steam"];
    if (s < secs - 18) return [88, 35, 75, 58, 140, 92, "eldenring", "eldenring"];
    return [62, 99, 79, 66, 318 + 60 * R(), 88, "eldenring", "eldenring"];
  };

  const L = ["#KGFFC-PLATE v1", "[SYSTEM]", `created=${iso(end + 300000)}`, `tz_offset_min=${-new Date(end).getTimezoneOffset()}`,
    "cpu=AMD Ryzen 7 7800X3D 8-Core Processor", "cpu_cores=8", "cpu_threads=16",
    "gpu1=NVIDIA GeForce RTX 4070 Ti SUPER | driver 32.0.15.9186 | 2026-01-19", "board=Demo Board B650 (made-up data)", "bios=1813 | 2023-11-02",
    "ram_total_gb=32", "ram_sticks=2", "ram_speed=rated 6000 MT/s, running 6000 MT/s | Demo RAM", "os=Microsoft Windows 11 Home build 26200",
    `last_boot=${iso(end + (crash ? 95000 : 7200e3))}`, "power_plan=Balanced", "crash_dumps=automatic", "minidumps=0", "disks=Demo NVMe 2TB (Healthy)",
    "[SESSION]", "name=demo", `stopped_cleanly=${crash ? "no" : "yes"}`, "[EVENTS]", '"time","provider","id","level","data","message"'];
  const ev = (t, p, id, lv, data, msg) => L.push(`"${iso(t)}","${p}","${id}","${lv}","${data}","${msg}"`);
  const kp = "BugcheckCode=0;BugcheckParameter1=0x0;SleepInProgress=0;PowerButtonTimestamp=0;LongPowerButtonPressDetected=false";
  const kpMsg = "The system has rebooted without cleanly shutting down first. This error could be caused if the system stopped responding, crashed, or lost power unexpectedly.";
  if (crash) {
    for (const d of [9, 4]) { ev(end - d * 86400e3 + 60000, "Microsoft-Windows-Kernel-Power", 41, 1, kp, kpMsg); ev(end - d * 86400e3 + 65000, "EventLog", 6008, 2, "", "The previous system shutdown was unexpected."); }
    ev(end + 95000, "Microsoft-Windows-Kernel-Power", 41, 1, kp, kpMsg);
    ev(end + 99000, "EventLog", 6008, 2, "", "The previous system shutdown was unexpected.");
    ev(end - 2 * 86400e3, "Application Error", 1000, 2, "P0=Photoshop.exe;P1=26.1.0", "Faulting application name: Photoshop.exe");
  }

  L.push("[COUNTERS]", "time,cpu_pct,cpu_core_max,cpu_perf_pct,cpu_base_mhz,mem_avail_mb,mem_commit_pct,gpu_3d_pct,gpu_vram_mb,disk_read_mbs,disk_write_mbs,disk_idle_min,net_rx_mbs,net_tx_mbs,top_cpu_app,top_cpu_pct,top_gpu_app,gpu_temp,gpu_pct,gpu_power,gpu_mhz,gpu_fan_pct");
  const H = ["[HWINFO]", '"Date","Time","CPU (Tctl/Tdie) [°C]","CPU Core Voltage (SVI3 TFN) [V]","CPU SoC Voltage (SVI3 TFN) [V]","CPU Package Power [W]","Average Effective Clock [MHz]","+12V [V]","GPU Temperature [°C]","GPU Hot Spot Temperature [°C]","GPU Power [W]","GPU 16-pin HVPWR Voltage [V]","Total Errors [#]","Thermal Throttling (HTC) [Yes/No]",'];
  let cT = 45, gT = 40;
  for (let s = 0; s <= secs; s++) {
    const t = start + s * 1000, [cpu, gpu, cpuT, gpuT, gW, cW, app, gApp] = phase(s);
    cT += (cpuT - cT) * 0.08; gT += (gpuT - gT) * 0.03;
    const c = Math.max(1, Math.min(100, cpu + n(6))), g = Math.max(0, Math.min(100, gpu + n(3)));
    const ram = app === "Photoshop" ? 5200 + n(400) : 14800 + n(300);
    L.push([iso(t), f(c), f(Math.min(100, c * 1.6 + 8)), f(88 + n(4)), "4200", f(ram, 0), f(100 - ram / 330), f(g), f(gApp === "dwm" ? 900 : 7400 + n(200), 0),
      f(Math.abs(n(20)) + (s > secs - 40 && crash ? 900 : 0)), f(Math.abs(n(4))), f(Math.max(0, 97 - Math.abs(n(10)))), f(Math.abs(n(1.5)), 2), f(Math.abs(n(0.3)), 2),
      `"${app}"`, f(c * 0.8), `"${gApp}"`, f(gT, 0), f(g, 0), f(gW * (g / Math.max(1, gpu)) + n(8)), f(g > 50 ? 2715 + n(40) : 1200 + n(300), 0), f(g > 50 ? 55 : 30, 0)].join(","));
    if (s % 2 === 0) {
      const d = new Date(t), load = gW / 320;
      const v12 = 12.06 - load * (crash ? 0.3 : 0.1) + n(0.02) - (crash && s > secs - 18 ? 0.14 + R() * 0.1 : 0);
      const pin = 12.1 - load * (crash ? 0.38 : 0.12) + n(0.02) - (crash && s > secs - 18 ? 0.2 : 0);
      H.push(`"${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}","${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.000","${f(cT + n(0.8))}","${f(1.1 + c / 900 + n(0.01), 3)}","${f(1.245, 3)}","${f(cW + n(4))}","${f(3500 + c * 12 + n(40), 0)}","${f(v12, 3)}","${f(gT + n(0.5))}","${f(gT + 11 + n(0.8))}","${f(gW + n(8))}","${f(pin, 3)}","0","No",`);
    }
  }
  L.push(...H, "[END]");
  return L.join("\n");
}
