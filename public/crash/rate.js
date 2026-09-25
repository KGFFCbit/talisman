import { appName } from "./parse.js";

// KGFFC Crash Kitchen — the Crisp-o-Meter and the suspect board.
// We never claim a diagnosis. The meter rates how hard and hot the recording ran; if the PC died,
// every suspect earns points from named evidence (and loses them from evidence against), and the
// board shows the share of points plus the reasons, so a human can check our working.

export const LEVELS = [
  { name: "Brined", tag: "Barely warm", line: "Your hardware is awesome. It sat in the brine the whole time. (Did you actually play anything?)" },
  { name: "Floured", tag: "Lightly dusted", line: "Easy work and cool temperatures. Nothing to see here." },
  { name: "Breaded", tag: "Coated and ready", line: "Real work at comfortable temperatures. This is a healthy PC." },
  { name: "Cooked", tag: "Cooked through, perfectly", line: "It worked hard and stayed inside every safe limit. This is what a good gaming session looks like." },
  { name: "Fried", tag: "Hot in the fryer", line: "Working close to its limits. Nothing broke, but read the amber items below." },
  { name: "Double Extra Crispy", tag: "Over the edge", line: "Something went past a safe limit. Fix the red items before they turn into a crash." },
  { name: "Gluttened", tag: "It died", line: "The PC crashed. The suspects are lined up below: work down the list from the top." },
];

const SUSPECTS = {
  psu: { name: "Power supply or its cables", who: "Grown-up", santa: "a new power supply",
    tips: ["Read the label on the power supply: an X3D CPU with a big graphics card wants a quality 750–850 W unit.",
      "Push every power plug in until it clicks, especially the graphics card's. Use a separate cable from the power supply for each graphics card socket (no daisy-chained splitter).",
      "Plug the PC straight into a wall socket (no extension or cheap power strip) and see if it still happens.",
      "The fastest real test: borrow a known-good power supply for a week."] },
  cpuHeat: { name: "CPU overheating (cooler, pump or paste)", who: "Grown-up", santa: "a new CPU cooler",
    tips: ["Check the CPU fan or water pump is spinning when the PC is on.", "Blow the dust out of the cooler and case filters (PC off, unplugged).", "Re-seat the cooler with fresh thermal paste."] },
  gpuHw: { name: "Graphics card hardware or its power spikes", who: "Grown-up", santa: "a new graphics card",
    tips: ["Lower the graphics card power limit to 80% in MSI Afterburner for a week. If the crashes stop, power spikes are the story (card or power supply).",
      "Clean the card's fans and check its temperature in the charts below.", "Re-seat the card in its slot and check the power plug is fully in."] },
  gpuDrv: { name: "Graphics driver", who: "You", santa: null,
    tips: ["Install the newest graphics driver as a clean install, or roll back to the previous one if the crashes started after an update.", "For a full wipe, a grown-up can use DDU (Display Driver Uninstaller) in Safe Mode first."] },
  ram: { name: "RAM or its EXPO/XMP speed setting", who: "You + grown-up", santa: "a new RAM kit",
    tips: ["Turn EXPO/XMP off in the BIOS for a week. The RAM runs a bit slower, but if the crashes stop you found it.", "Run MemTest86 from a USB stick overnight: any red error means RAM trouble.", "Try one RAM stick at a time to find a bad one."] },
  cpuTune: { name: "CPU settings or voltage (BIOS, PBO, Curve Optimizer)", who: "Grown-up", santa: null,
    tips: ["In the BIOS, load 'Optimized Defaults' to undo any overclock, undervolt or Curve Optimizer.", "Update the BIOS to the newest version from the motherboard maker's website. Don't switch off during the update.", "If it dies while idle, set 'Power Supply Idle Control' to 'Typical Current Idle' in the BIOS."] },
  board: { name: "Motherboard, its power stages (VRM) or BIOS", who: "Grown-up / shop", santa: "a new motherboard",
    tips: ["Update the BIOS to the newest version.", "Check the 8-pin CPU power cable at the top-left of the motherboard is fully clicked in.", "With the PC unplugged, look and sniff for burnt marks near the CPU socket. Any sign of burning: stop and take it to a shop."] },
  disk: { name: "SSD or storage driver", who: "You", santa: "a new SSD",
    tips: ["Open the SSD maker's app (Samsung Magician, WD Dashboard…) and update the firmware.", "Run 'chkdsk C: /scan' in a terminal.", "Back up anything important now, just in case."] },
  soft: { name: "Software or another driver", who: "You", santa: null,
    tips: ["Run Windows Update and install the newest AMD chipset driver.", "Uninstall RGB, fan and overclocking apps you don't need.", "Note which app crashed in the clues table and search its name + 'crash'."] },
};

const BUG = new Map([
  [0x124, ["WHEA_UNCORRECTABLE_ERROR", { cpuTune: 3, ram: 1.5, psu: 1, board: 1 }]],
  [0x101, ["CLOCK_WATCHDOG_TIMEOUT", { cpuTune: 3, board: 1 }]],
  [0x1a, ["MEMORY_MANAGEMENT", { ram: 3, soft: 1 }]],
  [0x50, ["PAGE_FAULT_IN_NONPAGED_AREA", { ram: 2.5, soft: 1.5 }]],
  [0x3b, ["SYSTEM_SERVICE_EXCEPTION", { ram: 2, soft: 2 }]],
  [0x0a, ["IRQL_NOT_LESS_OR_EQUAL", { ram: 2, soft: 2 }]],
  [0x139, ["KERNEL_SECURITY_CHECK_FAILURE", { ram: 2, soft: 2 }]],
  [0x1e, ["KMODE_EXCEPTION_NOT_HANDLED", { ram: 1.5, soft: 2 }]],
  [0x4e, ["PFN_LIST_CORRUPT", { ram: 3 }]],
  [0x116, ["VIDEO_TDR_FAILURE", { gpuDrv: 3, gpuHw: 2, psu: 1 }]],
  [0x117, ["VIDEO_TDR_TIMEOUT_DETECTED", { gpuDrv: 3, gpuHw: 2 }]],
  [0x119, ["VIDEO_SCHEDULER_INTERNAL_ERROR", { gpuDrv: 3, gpuHw: 1 }]],
  [0x10e, ["VIDEO_MEMORY_MANAGEMENT_INTERNAL", { gpuDrv: 3, gpuHw: 1 }]],
  [0x133, ["DPC_WATCHDOG_VIOLATION", { soft: 3, disk: 1.5, gpuDrv: 1 }]],
  [0xd1, ["DRIVER_IRQL_NOT_LESS_OR_EQUAL", { soft: 3, gpuDrv: 1 }]],
  [0x9f, ["DRIVER_POWER_STATE_FAILURE", { soft: 3 }]],
  [0x7a, ["KERNEL_DATA_INPAGE_ERROR", { disk: 3, ram: 1 }]],
  [0xf4, ["CRITICAL_OBJECT_TERMINATION", { disk: 3 }]],
  [0xef, ["CRITICAL_PROCESS_DIED", { disk: 2, soft: 2 }]],
  [0x154, ["UNEXPECTED_STORE_EXCEPTION", { disk: 3 }]],
]);

const KIND = {
  cut: { label: "Instant power-off", say: "no blue screen, no freeze: the power just went", prior: { psu: 3, gpuHw: 1.5, board: 1.5, cpuHeat: 1, cpuTune: 0.6, ram: 0.3 } },
  forced: { label: "Froze, then the power button was held", say: "it locked up first and someone held the power button", prior: { gpuDrv: 2, ram: 1.5, cpuTune: 1.5, gpuHw: 1, soft: 1, disk: 0.7 } },
  bluescreen: { label: "Blue screen", say: "Windows stopped itself with a blue screen", prior: { soft: 1, ram: 1, cpuTune: 1 } },
};

const clamp = (x) => Math.max(0, Math.min(1, x));
const r0 = (x) => Math.round(x);
const r2 = (x) => (Math.round(x * 100) / 100).toFixed(2);

// Graphics driver timeouts: Display 4101, NVIDIA/AMD driver errors, and Windows' own hardware reports
// (LiveKernelEvent 141 VIDEO_ENGINE_TIMEOUT, 117 VIDEO_TDR_TIMEOUT, 116 VIDEO_TDR_FAILURE).
const GPU_LKE = new Set(["141", "117", "116"]);
export const isGpuReset = (e) => (e.provider === "Display" && e.id === 4101) || /nvlddmkm|amdkmdag/.test(e.provider)
  || (e.provider === "Windows Error Reporting" && e.data.get("EventName") === "LiveKernelEvent" && GPU_LKE.has((e.data.get("P1") || "").toLowerCase()));

export function cpuLimit(name = "") {
  const n = name.toUpperCase();
  if (/9\d{3}X3D/.test(n)) return 95;
  if (/7\d{3}X3D/.test(n)) return 89;
  if (/5\d{3}X3D/.test(n)) return 90;
  if (/INTEL|CORE\(TM\)|CORE ULTRA/.test(n)) return 100;
  return 95;
}

export function stat(s, t0 = -Infinity, t1 = Infinity) {
  if (!s) return null;
  const vals = [];
  for (let i = 0; i < s.t.length; i++) if (s.t[i] >= t0 && s.t[i] <= t1 && Number.isFinite(s.v[i])) vals.push(s.v[i]);
  if (!vals.length) return null;
  const q = vals.slice().sort((a, b) => a - b);
  const p = (f) => q[Math.min(q.length - 1, Math.floor(f * (q.length - 1)))];
  return { n: vals.length, min: q[0], max: q[q.length - 1], p5: p(0.05), p50: p(0.5), p95: p(0.95), first: vals[0], last: vals[vals.length - 1] };
}

export function range(ds) {
  let t0 = Infinity, t1 = -Infinity;
  for (const s of ds.series.values()) if (s.t.length) { t0 = Math.min(t0, s.t[0]); t1 = Math.max(t1, s.t[s.t.length - 1]); }
  return t1 >= t0 ? { t0, t1 } : null;
}

function labelAt(ds, key, t) {
  const s = ds.labels.get(key);
  if (!s) return "";
  for (let i = s.t.length - 1; i >= 0; i--) if (s.t[i] <= t && t - s.t[i] < 15000 && s.v[i]) return s.v[i];
  return "";
}

export function crashList(ds) {
  const wers = ds.events.filter((x) => /WER-SystemErrorReporting$/.test(x.provider) && x.id === 1001);
  return ds.events.filter((e) => /Kernel-Power$/.test(e.provider) && e.id === 41).map((e) => {
    let code = Number.parseInt(e.data.get("BugcheckCode") || "0", 10) || 0;
    const btn = (Number.parseInt(e.data.get("PowerButtonTimestamp") || "0", 10) || 0) !== 0 || /true/i.test(e.data.get("LongPowerButtonPressDetected") || "");
    if (!code) {
      const wer = wers.find((x) => Math.abs(x.t - e.t) < 20 * 60000);
      const m = wer && /0x([0-9a-f]{8})/i.exec(wer.msg);
      if (m) code = Number.parseInt(m[1], 16);
    }
    const kind = code ? "bluescreen" : btn ? "forced" : "cut";
    return { t: e.t, code, kind, bug: code ? BUG.get(code)?.[0] || `0x${code.toString(16).toUpperCase()}` : "" };
  });
}

export function rate(ds) {
  const S = ds.series;
  const rec = range(ds);
  const tj = cpuLimit(ds.system.get("cpu") || "");
  const flags = [];
  const flag = (sev, text, cat) => flags.push({ sev, text, cat });
  const all = (k) => (rec ? stat(S.get(k), rec.t0, rec.t1) : null);
  const inRec = (e) => rec && e.t >= rec.t0 - 5000 && e.t <= rec.t1 + 5000;

  // ---- what happened?
  const crashes = crashList(ds);
  let died = null;
  if (rec && ds.session.get("stopped_cleanly") !== "yes") {
    const next = crashes.find((c) => c.t > rec.t1 && c.t - rec.t1 < 36 * 3600e3);
    const cleanOff = next && ds.events.some((e) => e.t > rec.t1 && e.t < next.t && ((e.provider === "EventLog" && e.id === 6006) || (e.provider === "User32" && e.id === 1074)));
    if (next && !cleanOff) died = next;
  }
  const fatalInRec = ds.events.filter((e) => inRec(e) && /WHEA-Logger$/.test(e.provider) && (e.id === 18 || e.id === 1));

  // ---- flags from the recording
  const cpuT = all("cpu_temp");
  if (cpuT) {
    if (cpuT.max >= tj - 1) flag("fail", `CPU reached ${r0(cpuT.max)}°C: its limit is ${tj}°C`, "cpuHeat");
    else if (cpuT.max >= tj - 6) flag("warn", `CPU ran hot: ${r0(cpuT.max)}°C (limit ${tj}°C)`, "cpuHeat");
    else flag("ok", `CPU temperature fine: peak ${r0(cpuT.max)}°C of ${tj}°C`, "cpuHeat");
  }
  if (all("cpu_throttle")?.max >= 1) flag("fail", "CPU thermal throttling switched on", "cpuHeat");
  const lim = all("cpu_limit_pct");
  if (lim && lim.p5 < 80) flag("warn", `Something held the CPU back (performance limit fell to ${r0(lim.p5)}%)`, "cpuHeat");
  const hot = all("gpu_hotspot"), gT = all("gpu_temp"), mT = all("gpu_mem_temp");
  if (hot) { if (hot.max >= 105) flag("fail", `Graphics card hot spot reached ${r0(hot.max)}°C`, "gpuHw"); else if (hot.max >= 95) flag("warn", `Graphics card hot spot ran warm: ${r0(hot.max)}°C`, "gpuHw"); }
  if (gT) {
    if (gT.max >= 87) flag("fail", `Graphics card reached ${r0(gT.max)}°C`, "gpuHw");
    else if (gT.max >= 83) flag("warn", `Graphics card ran warm: ${r0(gT.max)}°C`, "gpuHw");
    else flag("ok", `Graphics card temperature fine: peak ${r0(gT.max)}°C`, "gpuHw");
  }
  if (mT) { if (mT.max >= 104) flag("fail", `Graphics memory reached ${r0(mT.max)}°C`, "gpuHw"); else if (mT.max >= 96) flag("warn", `Graphics memory ran warm: ${r0(mT.max)}°C`, "gpuHw"); }
  const v12 = all("v12"), g12 = all("gpu_12v_in");
  for (const [s, what] of [[v12, "Motherboard 12 V rail"], [g12, "Graphics card 12 V input"]]) {
    if (!s) continue;
    if (s.min < 11.4) flag("fail", `${what} dropped to ${r2(s.min)} V (spec minimum 11.40 V)`, "psu");
    else if (s.min < 11.64) flag("warn", `${what} sagged to ${r2(s.min)} V`, "psu");
    else flag("ok", `${what} steady: lowest ${r2(s.min)} V`, "psu");
  }
  const soc = all("cpu_soc_v");
  if (soc && soc.max > 1.3 && !/INTEL/i.test(ds.system.get("cpu") || "")) flag("fail", `CPU SoC voltage hit ${r2(soc.max)} V. Above 1.30 V has damaged AM5 CPUs: update the BIOS`, "board");
  if (all("dram_v")?.max > 1.45) flag("warn", `RAM voltage is high: ${r2(all("dram_v").max)} V`, "ram");
  const vrm = all("vrm_temp");
  if (vrm) { if (vrm.max >= 105) flag("fail", `Motherboard power stages (VRM) reached ${r0(vrm.max)}°C`, "board"); else if (vrm.max >= 95) flag("warn", `Motherboard power stages (VRM) ran hot: ${r0(vrm.max)}°C`, "board"); }
  const wh = all("whea_total");
  if (wh && wh.last > wh.first) flag("fail", `Hardware errors (WHEA) went up by ${r0(wh.last - wh.first)} during the recording`, "cpuTune");
  const reasons = S.get("gpu_reasons");
  if (reasons && rec) {
    let brake = false, therm = false;
    for (const v of reasons.v) { if (v & 0x108) brake = true; if (v & 0xc0) therm = true; }
    if (brake) flag("fail", "Graphics card hit its hardware slowdown / power brake", "psu");
    if (therm) flag("warn", "Graphics card slowed itself down because of heat", "gpuHw");
  }
  if (all("gpu_limit_thermal")?.max >= 1) flag("warn", "Graphics card reported a thermal limit", "gpuHw");
  const ram = all("ram_used_pct"), commit = all("mem_commit_pct");
  if ((ram && ram.p95 > 92) || (commit && commit.max > 95)) flag("warn", "RAM was nearly full (big Photoshop files do this). That crashes apps, not the whole PC", "soft");
  const fan = all("fan_cpu_rpm"), pump = all("pump_rpm");
  if (fan && fan.min === 0 && cpuT && cpuT.max > 60) flag("fail", "CPU fan read 0 RPM while the CPU was warm", "cpuHeat");
  if (pump && pump.min < 300) flag("fail", `Water pump dropped to ${r0(pump.min)} RPM`, "cpuHeat");
  if (all("cpu_dpc_pct")?.p95 > 5) flag("warn", "Drivers kept the CPU unusually busy (high DPC time)", "soft");
  if (all("disk_latency_ms")?.max > 1000) flag("warn", `A disk took ${r0(all("disk_latency_ms").max)} ms to answer`, "disk");
  for (const e of ds.events.filter(inRec)) {
    if (/WHEA-Logger$/.test(e.provider) && e.id === 19) flag("warn", "Windows corrected a hardware error (WHEA 19)", "cpuTune");
    if ((e.provider === "Display" && e.id === 4101) || /nvlddmkm|amdkmdag/.test(e.provider)) flag("fail", "The graphics driver crashed and restarted", "gpuDrv");
  }
  if (fatalInRec.length) flag("fail", "Windows logged a FATAL hardware error (WHEA 18)", "cpuTune");
  const resets = ds.events.filter(isGpuReset).length;
  if (resets) flag("warn", `Windows logged ${resets} graphics driver timeout${resets > 1 ? "s" : ""} in the last 14 days (it recovered each time). Worth a clean driver install`, "gpuDrv");

  // ---- the Crisp-o-Meter
  const load = Math.max(all("cpu_pct")?.p95 ?? 0, all("gpu_pct")?.p95 ?? 0);
  let heat = 0;
  if (cpuT) heat = Math.max(heat, 30 * clamp((cpuT.max - (tj - 25)) / 25));
  if (hot) heat = Math.max(heat, 30 * clamp((hot.max - 80) / 25));
  else if (gT) heat = Math.max(heat, 30 * clamp((gT.max - 62) / 25));
  let score = 35 * clamp(load / 100) + heat;
  for (const f of flags) score += f.sev === "fail" ? 12 : f.sev === "warn" ? 5 : 0;
  score = Math.min(84, score);
  if (died || fatalInRec.length) score = 100;
  const level = score >= 85 ? 6 : score >= 70 ? 5 : score >= 55 ? 4 : score >= 40 ? 3 : score >= 25 ? 2 : score >= 12 ? 1 : 0;

  // ---- suspects: the recorded death, else the most recent crash in the history
  const focus = died || crashes[crashes.length - 1] || null;
  const suspects = focus ? board(ds, focus, !!died, rec, tj) : [];

  const missing = [];
  if (!rec) missing.push("No recording in this file, only the crash history. Run 1-START-COOKING before playing so we can see the last seconds.");
  if (rec && !S.has("cpu_temp")) missing.push("No CPU temperature. Add HWiNFO logging (Extra Crispy mode in the README) so overheating can be ruled in or out.");
  if (rec && !S.has("v12") && !S.has("gpu_12v_in")) missing.push("No voltages. HWiNFO shows the 12 V rail, the best clue for a power supply problem.");
  if (!ds.sources.has("Windows event log")) missing.push("No Windows crash clues. 2-PLATE-IT collects them. Use the plate file instead of a raw CSV.");
  if (rec && !died && ds.session.get("stopped_cleanly") !== "yes" && !ds.sources.has("Windows event log")) missing.push("The recording stopped suddenly, but there are no Windows clues to say why.");

  return { score: r0(score), level, tj, rec, died, crashes, focus, flags, suspects, missing, kind: focus ? KIND[focus.kind] : null };
}

function board(ds, crash, recorded, rec, tj) {
  const S = ds.series;
  const pts = new Map(Object.keys(SUSPECTS).map((k) => [k, 0]));
  const why = new Map(Object.keys(SUSPECTS).map((k) => [k, []]));
  const against = new Map(Object.keys(SUSPECTS).map((k) => [k, []]));
  const add = (k, p, text) => { pts.set(k, pts.get(k) + p); if (text) why.get(k).push(text); };
  const down = (k, f, text) => { pts.set(k, pts.get(k) * f); against.get(k).push(text); };

  const kind = KIND[crash.kind];
  for (const [k, p] of Object.entries(kind.prior)) add(k, p, null);
  const bug = BUG.get(crash.code);
  if (bug) for (const [k, p] of Object.entries(bug[1])) add(k, p, `Blue screen code ${bug[0]} usually points here`);
  if (crash.kind === "cut") { add("psu", 0, "The PC lost power instantly with no blue screen, the classic sign of a power supply switching itself off"); why.get("board").push("An instant power-off can also be the motherboard's own protection tripping"); }
  if (crash.kind === "forced") why.get("gpuDrv").push("It froze before it switched off: freezes are usually drivers, RAM or CPU settings, not power");

  // Windows' own clues from the whole history
  const count = (f) => ds.events.filter(f).length;
  const whea = (re, ids) => count((e) => /WHEA-Logger$/.test(e.provider) && ids.includes(e.id) && re.test(e.msg));
  const cache = whea(/cache|internal|parity|TLB|Translation/i, [1, 18, 19]);
  const bus = whea(/bus|interconnect/i, [1, 18, 19]);
  const pcie = whea(/PCI/i, [17, 1, 18, 19]);
  const mem47 = count((e) => /WHEA-Logger$/.test(e.provider) && e.id === 47);
  if (cache) add("cpuTune", Math.min(4, 1 + cache), `${cache} CPU core/cache hardware error(s) in the Windows log (WHEA): usually CPU settings or voltage`);
  if (bus) { add("ram", Math.min(3, 1 + bus), `${bus} memory-bus hardware error(s) (WHEA Bus/Interconnect): often an unstable EXPO/XMP RAM speed`); add("cpuTune", 1, null); }
  if (pcie) { add("gpuHw", 1, `${pcie} PCI Express link error(s): graphics card seating, slot or riser cable`); add("board", 1, null); }
  if (mem47) add("ram", 2, `${mem47} corrected memory error(s) (WHEA 47)`);
  const tdr = count(isGpuReset);
  if (tdr) { add("gpuDrv", Math.min(4, 1 + tdr / 2), `${tdr} graphics driver crash/reset clue(s) in the Windows log`); add("gpuHw", 1, null); }
  const disk = count((e) => /^(disk|stornvme|storahci|Microsoft-Windows-Ntfs)$/.test(e.provider) && e.level <= 3);
  if (disk) add("disk", Math.min(4, 1 + disk / 2), `${disk} disk warning/error clue(s) in the Windows log`);
  const fw = count((e) => /Kernel-Processor-Power$/.test(e.provider) && e.id === 37);
  if (fw) { add("cpuHeat", 1, `The BIOS told Windows to slow the CPU down ${fw} time(s): heat or power limits`); add("psu", 0.3, null); }
  const apps = ds.events.filter((e) => e.provider === "Application Error" && Math.abs(e.t - crash.t) < 6 * 3600e3);
  if (apps.length) add("soft", 0.5, `An app crashed in the hours around it: ${appName(apps[apps.length - 1].data.get("P0") || apps[apps.length - 1].data.get("AppName")) || "see the clues table"}`);
  const n = ds.events.filter((e) => /Kernel-Power$/.test(e.provider) && e.id === 41).length;
  if (n >= 3 && crash.kind === "cut") add("psu", 1, `${n} sudden power-offs in the log: a repeating pattern, not a one-off`);

  // The recording: the last minute before it died (or the whole session for an unrecorded crash)
  if (rec) {
    const w0 = recorded ? rec.t1 - 60000 : rec.t0, w1 = rec.t1;
    const where = recorded ? "in its last minute" : "during this recording";
    const g = stat(S.get("gpu_pct"), w0, w1), c = stat(S.get("cpu_pct"), w0, w1);
    if (recorded) {
      const gpuApp = labelAt(ds, "top_gpu_app", rec.t1), cpuApp = labelAt(ds, "top_cpu_app", rec.t1);
      if (gpuApp || cpuApp) why.get("soft").push(`At the moment it died the busiest apps were ${[cpuApp && `${cpuApp} (CPU)`, gpuApp && `${gpuApp} (graphics)`].filter(Boolean).join(" and ")}`);
      if (g && g.max > 85) { add("psu", 2, `The graphics card was flat out (${r0(g.max)}%) when the power died: big power spikes trip weak or ageing power supplies`); add("gpuHw", 1, null); }
      if (c && c.max > 85) add("psu", 0.7, `The CPU was flat out (${r0(c.max)}%) at the end`);
      const before = stat(S.get("gpu_pct"), rec.t1 - 90000, rec.t1 - 25000), after = stat(S.get("gpu_pct"), rec.t1 - 25000, rec.t1);
      if (before && after && before.p50 < 45 && after.max > 85) add("psu", 1.5, `Load jumped from ${r0(before.p50)}% to ${r0(after.max)}% just before it died, like a game loading in: the moment power spikes are biggest`);
      const pw = S.get("gpu_power");
      if (pw) { let jump = 0; for (let i = 1; i < pw.t.length; i++) if (pw.t[i] >= w0 && pw.t[i] <= w1) jump = Math.max(jump, pw.v[i] - pw.v[i - 1]); if (jump > 120) add("psu", 1, `Graphics power jumped by ${r0(jump)} W in one second right before the end`); }
      if (g && c && g.max < 30 && c.max < 30) { down("psu", 0.6, "It died while the PC was barely working, when power spikes are small"); add("cpuTune", 1, "Idle crashes on Ryzen are often fixed by the BIOS setting 'Power Supply Idle Control: Typical Current Idle'"); }
    }
    const ct = stat(S.get("cpu_temp"), w0, w1);
    if (ct) { if (ct.max >= tj - 2) add("cpuHeat", 4, `CPU was at ${r0(ct.max)}°C ${where}: at its ${tj}°C limit`); else if (ct.max >= tj - 8) add("cpuHeat", 1.5, `CPU was warm (${r0(ct.max)}°C) ${where}`); else if (ct.max < tj - 15) down("cpuHeat", 0.35, `The CPU was only ${r0(ct.max)}°C ${where}: not overheating`); }
    const gt = stat(S.get("gpu_hotspot"), w0, w1) || stat(S.get("gpu_temp"), w0, w1), lim = S.has("gpu_hotspot") ? 105 : 87;
    if (gt) { if (gt.max >= lim) add("gpuHw", 2, `Graphics card was at ${r0(gt.max)}°C ${where}`); else if (gt.max < lim - 15) down("gpuHw", 0.85, `The graphics card was cool (${r0(gt.max)}°C) ${where}`); }
    const v12 = stat(S.get("v12"), w0, w1), g12 = stat(S.get("gpu_12v_in"), w0, w1), base = stat(S.get("v12"));
    const lo = Math.min(v12?.min ?? 99, g12?.min ?? 99);
    if (lo < 11.4) add("psu", 4, `The 12 V supply fell to ${r2(lo)} V ${where}: below the 11.40 V the ATX standard allows`);
    else if (lo < 11.64) add("psu", 2, `The 12 V supply sagged to ${r2(lo)} V ${where}`);
    else if (lo < 99 && lo >= 11.8) down("psu", 0.75, `The 12 V supply looked steady (${r2(lo)} V), though sensors can miss very fast dips`);
    if (v12 && base && base.p50 - v12.min > 0.35) add("psu", 1.5, `12 V dropped ${r2(base.p50 - v12.min)} V below normal under load`);
    const reasons = S.get("gpu_reasons");
    if (reasons) for (let i = 0; i < reasons.t.length; i++) if (reasons.t[i] >= w0 && reasons.v[i] & 0x108) { add("psu", 2, "The graphics card hit its hardware power brake: it saw its power input go bad"); add("gpuHw", 1, null); break; }
    const soc = stat(S.get("cpu_soc_v"));
    if (soc && soc.max > 1.3) { add("board", 2, `SoC voltage ${r2(soc.max)} V is above the 1.30 V safety line`); add("cpuTune", 2, "High SoC voltage usually comes from an EXPO profile on an old BIOS"); }
    const vrm = stat(S.get("vrm_temp"), w0, w1);
    if (vrm && vrm.max >= 105) add("board", 3, `Motherboard power stages were at ${r0(vrm.max)}°C ${where}`);
    const fan = stat(S.get("pump_rpm"), w0, w1) || stat(S.get("fan_cpu_rpm"), w0, w1);
    if (fan && fan.min < 300) add("cpuHeat", 3, `CPU fan/pump fell to ${r0(fan.min)} RPM ${where}`);
    const wh = stat(S.get("whea_total"));
    if (wh && wh.last > wh.first) add("cpuTune", 2, `HWiNFO counted ${r0(wh.last - wh.first)} new hardware errors`);
    if (stat(S.get("dram_v"))?.max > 1.45) add("ram", 1, "RAM voltage is set high (aggressive EXPO/XMP)");
    const ram = stat(S.get("ram_used_pct"), w0, w1);
    if (ram && ram.max > 95) add("soft", 0.5, `RAM was ${r0(ram.max)}% full ${where}`);
  }

  const rows = [...pts].filter(([, p]) => p > 0.05);
  const total = rows.reduce((a, [, p]) => a + p, 0) || 1;
  return rows.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, p]) => ({
    id: k, ...SUSPECTS[k], pct: Math.round((100 * p) / total), why: why.get(k), against: against.get(k),
  }));
}
