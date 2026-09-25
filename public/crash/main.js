// KGFFC Crash Kitchen — page wiring. The file is read in this tab and nowhere else: the page's CSP
// sets connect-src 'none', so even a bug could not send it anywhere. Nothing from the file is ever
// put into innerHTML; every string goes through textContent.
import { readFile, parseText, merge, FileError, at, clean, appName } from "./parse.js";
import { rate, stat, LEVELS, isGpuReset } from "./rate.js";
import { View, TimeChart, Gauge, meter, el, fmt, clockText } from "./charts.js";
import { demoPlate } from "./demo.js";

const $ = (id) => document.getElementById(id);
const root = document.querySelector(".ck");
let charts = [], view = null, playing = false;

// ---------- input
async function loadFiles(files) {
  busy(true);
  try {
    const list = [...files].slice(0, 6); // copy now: the picker is cleared while we read
    const sets = [];
    for (const file of list) sets.push(parseText(await readFile(file), file.name));
    show(merge(sets), clean(list.map((f) => f.name).join(", "), 80));
  } catch (e) { fail(e); } finally { busy(false); }
}
function loadText(text, name) {
  busy(true);
  try { show(merge([parseText(text, name)]), name); } catch (e) { fail(e); } finally { busy(false); }
}
function fail(e) {
  if (!(e instanceof FileError)) console.error(e);
  $("err").textContent = e instanceof FileError ? e.message : "Something in that file confused us, so we stopped reading it. Try the plate file straight from 2-PLATE-IT.";
  $("err").hidden = false;
}
function busy(on) { $("drop").classList.toggle("busy", on); if (on) $("err").hidden = true; }

$("file").addEventListener("change", (e) => { if (e.target.files.length) loadFiles(e.target.files); e.target.value = ""; });
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files); });
$("pasteGo").addEventListener("click", () => { const t = $("pasteBox").value; if (t.trim()) loadText(t, "pasted text"); });
$("demoOk").addEventListener("click", () => loadText(demoPlate("ok"), "demo: healthy session"));
$("demoCrash").addEventListener("click", () => loadText(demoPlate("crash"), "demo: sudden power-off"));

// ---------- render
const css = (v) => getComputedStyle(root).getPropertyValue(v).trim();
const when = (t) => new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const SYM = { ok: "✓", warn: "!", fail: "✕", info: "·" };

function show(ds, name) {
  stop();
  const r = rate(ds);
  $("results").hidden = false;

  // verdict
  const lv = LEVELS[r.level];
  $("verdict").className = `verdict lv${r.level}`;
  meter($("dial"), r.score, r.level, LEVELS.map((l) => l.name));
  $("vEyebrow").textContent = `Crisp-o-Meter · ${r.score} / 100 · ${lv.tag}`;
  $("vLevel").textContent = lv.name;
  $("vLine").textContent = lv.line;
  let more = "";
  if (r.died) more = `${r.kind.label}: ${r.kind.say}. The recording stopped at ${clockText(r.rec.t1, true)} and Windows restarted ${Math.max(1, Math.round((r.died.t - r.rec.t1) / 60000))} min later.`;
  else if (r.crashes.length) more = `No crash during this recording, but Windows logged ${r.crashes.length} unexpected shutdown${r.crashes.length > 1 ? "s" : ""} in the history (latest ${when(r.crashes[r.crashes.length - 1].t)}).`;
  else if (r.rec) more = ds.session.get("stopped_cleanly") === "yes" ? "The recording finished normally and Windows logged no crashes." : "No crash found in this file.";
  $("vMore").textContent = `${more} Source: ${name}.`;
  $("ladder").replaceChildren(...LEVELS.map((l, i) => { const li = el("li", i === r.level ? "on" : "", l.name); if (i === r.level) li.setAttribute("aria-current", "true"); return li; }));

  // stats
  const S = ds.series, all = (k) => (r.rec ? stat(S.get(k), r.rec.t0, r.rec.t1) : null);
  const low12 = Math.min(all("v12")?.min ?? Infinity, all("gpu_12v_in")?.min ?? Infinity);
  const stats = [
    ["Recording", r.rec ? dur(r.rec.t1 - r.rec.t0) : "none"],
    ["Peak CPU", all("cpu_temp") ? `${fmt(all("cpu_temp").max, 0)}°C` : "not recorded"],
    ["Peak graphics", all("gpu_temp") ? `${fmt(all("gpu_temp").max, 0)}°C` : "not recorded"],
    ["Lowest 12 V", Number.isFinite(low12) ? `${low12.toFixed(2)} V` : "not recorded"],
    ["Crashes in log", String(r.crashes.length)],
  ];
  $("stats").replaceChildren(...stats.flatMap(([k, v]) => { const d = el("div"); d.append(el("dt", null, k), el("dd", null, v)); return [d]; }));

  // flags
  const order = { fail: 0, warn: 1, ok: 2 };
  const flags = r.flags.slice().sort((a, b) => order[a.sev] - order[b.sev]);
  $("flags").replaceChildren(...(flags.length ? flags : [{ sev: "info", text: "Nothing to check yet: this file has no temperatures or voltages." }]).map((f) => {
    const li = el("li", `pill-row ${f.sev}`); li.append(el("span", `pill ${f.sev}`, `${SYM[f.sev]} ${{ ok: "Fine", warn: "Watch", fail: "Problem", info: "Note" }[f.sev]}`), el("span", null, f.text)); return li;
  }));
  const missing = [...ds.notes, ...r.missing];
  $("missingWrap").hidden = !missing.length;
  $("missing").replaceChildren(...missing.map((m) => el("li", null, m)));

  // suspects + Santa
  $("suspectWrap").hidden = !r.suspects.length;
  if (r.suspects.length) {
    $("suspectTitle").textContent = r.died ? "The suspects" : "Suspects from the crash history";
    $("suspectHint").textContent = r.died
      ? "Ranked by the evidence below. This is the most probable order to test in, not a verdict: change ONE thing, record again, and see if the crashes stop."
      : "The crash wasn't in this recording, so this ranking only uses Windows' own clues. Record while it happens for a much better answer.";
    const top = r.suspects[0].pct, lead = top >= 45 ? "Strong lead" : top >= 30 ? "Good lead" : "Hunch";
    $("suspects").replaceChildren(...r.suspects.map((s, i) => {
      const li = el("li", "suspect");
      const head = el("div", "s-head");
      head.append(el("span", "s-rank", `#${i + 1}`), el("h3", null, s.name), el("span", "who", s.who));
      const bar = el("div", "s-bar"); const fill = el("span"); fill.style.width = `${s.pct}%`; bar.append(fill);
      li.append(head, el("p", "s-pct", `${s.pct}% of the evidence${i === 0 ? ` · ${lead}` : ""}`), bar);
      if (s.why.length) { const u = el("ul", "s-why"); u.append(...s.why.map((w) => el("li", null, w))); li.append(el("p", "s-lab", "Why we think so"), u); }
      if (s.against.length) { const u = el("ul", "s-against"); u.append(...s.against.map((w) => el("li", null, w))); li.append(el("p", "s-lab", "Evidence against"), u); }
      const d = el("details", "s-try"); d.open = i === 0; d.append(el("summary", null, "What to try"));
      const o = el("ol"); o.append(...s.tips.map((t) => el("li", null, t))); d.append(o); li.append(d);
      return li;
    }));
  }
  const top = r.suspects[0];
  $("santa").textContent = top
    ? top.santa ? `Dear Santa, I have been very good this year. Please bring me ${top.santa}. (Only once the tests above prove it. Santa hates returns.)` : "No need to write to Santa: the top suspect is free to fix."
    : r.level <= 3 ? "Your hardware is awesome. Santa can put his feet up this year." : "Nothing is broken yet. Fix the amber and red items and Santa stays home.";

  // replay + charts
  for (const c of charts) c.destroy();
  charts = []; $("charts").replaceChildren(); $("gauges").replaceChildren();
  $("replayWrap").hidden = !r.rec;
  if (r.rec) buildReplay(ds, r);

  // clues + system
  clues(ds, r);
  system(ds);
  $("results").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function buildReplay(ds, r) {
  const S = ds.series, c = [css("--s1"), css("--s2"), css("--s3"), css("--s4")];
  view = new View();
  const marks = [];
  if (r.died) marks.push({ t: r.rec.t1, sev: "fail", label: "✕ died" });
  for (const e of ds.events) if (e.t >= r.rec.t0 && e.t <= r.rec.t1 && e.level <= 3) marks.push({ t: e.t, sev: e.level <= 2 ? "fail" : "warn" });
  const refLine = (k, v, label) => (S.has(k) ? [{ v, label }] : []);
  const groups = [
    { title: "How hard it worked", unit: "%", min: 0, max: 100, lines: [["CPU", "cpu_pct"], ["Graphics card", "gpu_pct"], ["Busiest CPU core", "cpu_core_max"]] },
    { title: "Temperatures", unit: "°C", lines: [["CPU", "cpu_temp"], ["Graphics card", "gpu_temp"], ["Graphics hot spot", "gpu_hotspot"], [S.has("vrm_temp") ? "Motherboard VRM" : "Motherboard sensor", S.has("vrm_temp") ? "vrm_temp" : "acpi_temp"]], refs: refLine("cpu_temp", r.tj, `CPU limit ${r.tj}°C`) },
    { title: "12-volt supply", unit: "V", digits: 2, lines: [["Motherboard +12 V", "v12"], ["Graphics card 12 V input", "gpu_12v_in"]], refs: [{ v: 11.4, label: "ATX minimum 11.40 V" }] },
    { title: "Chip voltages", unit: "V", digits: 3, lines: [["CPU core", "cpu_vcore"], ["CPU SoC", "cpu_soc_v"], ["RAM", "dram_v"]], refs: refLine("cpu_soc_v", 1.3, "SoC safety line 1.30 V") },
    { title: "Power draw", unit: "W", min: 0, lines: [["CPU", "cpu_power"], ["Graphics card", "gpu_power"]] },
    { title: "Clock speed", unit: "MHz", min: 0, lines: [["CPU", "cpu_mhz"], ["Graphics card", "gpu_mhz"]] },
    { title: "Memory", unit: "%", min: 0, max: 100, lines: [["RAM in use", "ram_used_pct"], ["Committed", "mem_commit_pct"]] },
    { title: "Disk", unit: "MB/s", min: 0, lines: [["Read", "disk_read_mbs"], ["Write", "disk_write_mbs"]] },
    { title: "Network", unit: "MB/s", min: 0, lines: [["Download", "net_rx_mbs"], ["Upload", "net_tx_mbs"]] },
    { title: "Fans", unit: "RPM", min: 0, lines: [["CPU fan", "fan_cpu_rpm"], ["Pump", "pump_rpm"]] },
  ];
  for (const g of groups) {
    const lines = g.lines.map(([label, k], i) => ({ label, s: S.get(k), color: c[i] })).filter((l) => l.s && l.s.t.length > 1);
    if (!lines.length) continue;
    const host = el("div", "chart"); $("charts").append(host);
    charts.push(new TimeChart(host, { ...g, lines, marks, refs: g.refs || [] }, view));
  }

  const gz = [
    ["cpu_pct", { label: "CPU load", unit: "%", min: 0, max: 100, warn: 101, fail: 102 }], // flat-out load is normal, never a warning
    ["gpu_pct", { label: "Graphics load", unit: "%", min: 0, max: 100, warn: 101, fail: 102 }],
    ["cpu_temp", { label: "CPU temp", unit: "°C", min: 20, max: r.tj + 6, warn: r.tj - 6, fail: r.tj - 1 }],
    [S.has("gpu_hotspot") ? "gpu_hotspot" : "gpu_temp", { label: S.has("gpu_hotspot") ? "Graphics hot spot" : "Graphics temp", unit: "°C", min: 20, max: 110, warn: S.has("gpu_hotspot") ? 95 : 83, fail: S.has("gpu_hotspot") ? 105 : 87 }],
    [S.has("gpu_12v_in") ? "gpu_12v_in" : "v12", { label: "12 V supply", unit: "V", min: 11, max: 12.6, warn: 11.64, fail: 11.4, low: true }],
    ["gpu_power", { label: "Graphics power", unit: "W", min: 0, max: 450, warn: 1e9, fail: 1e9 }],
  ].filter(([k]) => S.has(k)).map(([k, o]) => [S.get(k), new Gauge($("gauges"), o)]);

  const scrub = $("scrub");
  view.on(() => {
    const t = view.cursor ?? view.full[1];
    for (const [s, g] of gz) { const i = at(s, t); g.set(i >= 0 && t - s.t[i] < 10000 ? s.v[i] : NaN); }
    $("clock").textContent = `${clockText(t, true)} · ${dur(view.full[1] - t)} before the end`;
    scrub.value = String(Math.round((1000 * (t - view.full[0])) / Math.max(1, view.full[1] - view.full[0])));
    const lab = (k) => { const s = ds.labels.get(k); if (!s) return ""; const i = at(s, t); return i >= 0 && t - s.t[i] < 15000 ? s.v[i] : ""; };
    const a = lab("top_cpu_app"), b = lab("top_gpu_app");
    $("apps").textContent = a || b ? `Busiest apps right now: ${[a && `${a} (CPU)`, b && `${b} (graphics)`].filter(Boolean).join(" · ")}` : "";
  });
  view.reset(r.rec.t0, r.rec.t1);
  if (r.died) view.zoom(r.rec.t1 - 5 * 60000, r.rec.t1);
}

// ---------- replay controls
let last = 0;
function tick(now) {
  if (!playing || !view) return;
  const sp = Number($("speed").value) || 10;
  let t = (view.cursor ?? view.x0) + ((now - last) / 1000) * 1000 * sp;
  last = now;
  if (t >= view.x1) { t = view.x1; stop(); }
  view.point(t);
  if (playing) requestAnimationFrame(tick);
}
function stop() { playing = false; $("play").textContent = "▶ Play"; }
$("play").addEventListener("click", () => {
  if (!view) return;
  if (playing) return stop();
  if ((view.cursor ?? view.x1) >= view.x1 - 1000) view.point(view.x0);
  playing = true; $("play").textContent = "❚❚ Pause"; last = performance.now(); requestAnimationFrame(tick);
});
$("toEnd").addEventListener("click", () => { if (view) { stop(); view.zoom(view.full[1] - 5 * 60000, view.full[1]); view.point(view.full[1]); } });
$("zoomOut").addEventListener("click", () => { if (view) view.unzoom(); });
$("scrub").addEventListener("input", (e) => { if (view) { stop(); view.point(view.full[0] + (Number(e.target.value) / 1000) * (view.full[1] - view.full[0])); } });

// ---------- Windows clues table
function describe(e) {
  const p = e.provider, id = e.id;
  if (/Kernel-Power$/.test(p) && id === 41) {
    const code = Number.parseInt(e.data.get("BugcheckCode") || "0", 10) || 0;
    const btn = (Number.parseInt(e.data.get("PowerButtonTimestamp") || "0", 10) || 0) !== 0;
    return ["fail", code ? `Restarted after a blue screen (code 0x${code.toString(16).toUpperCase()})` : btn ? "Restarted after the power button was held" : "Restarted after a sudden power loss"];
  }
  if (p === "EventLog" && id === 6008) return ["warn", "Windows noticed the last shutdown was unexpected"];
  if (/WER-SystemErrorReporting$/.test(p)) return ["fail", "Blue screen report"];
  if (/WHEA-Logger$/.test(p)) return [id === 18 || id === 1 ? "fail" : "warn", id === 18 || id === 1 ? "FATAL hardware error" : id === 47 ? "Corrected memory error" : id === 17 ? "Corrected PCI Express error" : "Corrected hardware error"];
  if (/Kernel-Processor-Power$/.test(p)) return ["warn", "BIOS limited the CPU speed"];
  if ((p === "Display" && id === 4101) || /nvlddmkm|amdkmdag/.test(p)) return ["fail", "Graphics driver crashed or reset"];
  if (/^(disk|stornvme|storahci|Microsoft-Windows-Ntfs|volmgr)$/.test(p)) return [e.level <= 2 ? "fail" : "warn", p === "volmgr" ? "Crash dump could not be saved" : "Disk or storage problem"];
  if (p === "Application Error") return ["warn", `App crashed: ${appName(e.data.get("P0") || e.data.get("AppName")) || "an app"}`];
  if (p === "Windows Error Reporting") {
    if (/BlueScreen/.test(e.msg)) return ["fail", "Blue screen report"];
    const c = (e.data.get("P1") || "").toLowerCase();
    const code = /^[0-9a-f]{1,8}$/.test(c) ? c : "?";
    return ["warn", isGpuReset(e) ? `Graphics driver stopped responding, then recovered (LiveKernelEvent ${code})` : `Hardware hiccup reported (LiveKernelEvent ${code})`];
  }
  return null;
}
function clues(ds) {
  // Repeats fold into one row with a count; each crash (Kernel-Power 41 / 6008) keeps its own row.
  const rows = [], groups = new Map();
  for (const e of ds.events) {
    const d = describe(e); if (!d) continue;
    const k = /Kernel-Power$/.test(e.provider) || e.id === 6008 ? null : d[1];
    const g = k && groups.get(k);
    if (g) { g[0] = e; g[4]++; continue; }
    const row = [e, d[0], d[1], e.t, 1]; rows.push(row); if (k) groups.set(k, row);
  }
  rows.sort((a, b) => a[0].t - b[0].t);
  const body = $("clues");
  body.replaceChildren(...rows.slice(-150).reverse().map(([e, sev, what, first, n]) => {
    const tr = el("tr", sev);
    const s = el("td"); s.append(el("span", `pill ${sev}`, SYM[sev]));
    const w = el("td"); w.append(el("b", null, n > 1 ? `${what} ×${n}` : what), el("small", null, ` ${e.provider} ${e.id}`));
    tr.append(s, el("td", "num", n > 1 ? `${when(first)} → ${when(e.t)}` : when(e.t)), w, el("td", "msg", e.msg || [...e.data].map(([k, v]) => `${k}=${v}`).join("; ")));
    return tr;
  }));
  if (!rows.length) { const tr = el("tr"); const td = el("td", null, ds.sources.has("Windows event log") ? "No crash clues in Windows' logs. Good news." : "This file has no Windows clues (use the plate file from 2-PLATE-IT)."); td.colSpan = 4; tr.append(td); body.append(tr); }
}

// ---------- the PC
function system(ds) {
  const Y = ds.system, rows = [["CPU", "cpu"], ["Graphics", "gpu1"], ["Graphics 2", "gpu2"], ["Motherboard", "board"], ["BIOS", "bios"], ["RAM", "ram_total_gb"], ["RAM speed", "ram_speed"], ["Windows", "os"], ["Power plan", "power_plan"], ["Crash dumps", "crash_dumps"], ["Minidumps", "minidumps"], ["Disks", "disks"]];
  const out = [];
  for (const [label, k] of rows) {
    if (!Y.has(k)) continue;
    const d = el("div"); d.append(el("dt", null, label), el("dd", null, k === "ram_total_gb" ? `${Y.get(k)} GB` : Y.get(k))); out.push(d);
  }
  const notes = [];
  const bios = /\|\s*(\d{4}-\d\d-\d\d)/.exec(Y.get("bios") || "");
  if (bios && Date.now() - Date.parse(bios[1]) > 365 * 86400e3) notes.push(`The BIOS is from ${bios[1]}, over a year old. BIOS updates fix a lot of crash and voltage bugs on AM5 boards.`);
  const rs = /rated (\d+).*running (\d+)/.exec(Y.get("ram_speed") || "");
  if (rs && Number(rs[2]) < Number(rs[1])) notes.push(`RAM is rated ${rs[1]} but running ${rs[2]} MT/s: EXPO/XMP is off, so the RAM overclock is NOT a suspect right now.`);
  else if (rs && Number(rs[2]) >= 6000) notes.push(`RAM runs at ${rs[2]} MT/s with EXPO/XMP on. Turning it off for a week is a cheap, safe test.`);
  if (Y.get("crash_dumps") === "off") notes.push("Crash dumps are switched off, so blue screens leave no evidence. Turn on 'Small memory dump' in System > Advanced > Startup and Recovery.");
  $("sys").replaceChildren(...out);
  $("sysNotes").replaceChildren(...notes.map((n) => el("li", null, n)));
  $("sysWrap").hidden = !out.length;
}

// Shareable demo links: /crash/#demo=crash or /crash/#demo=ok (exact matches only).
const DEMOS = { "#demo=crash": ["crash", "demo: sudden power-off"], "#demo=ok": ["ok", "demo: healthy session"] };
if (DEMOS[location.hash]) loadText(demoPlate(DEMOS[location.hash][0]), DEMOS[location.hash][1]);
