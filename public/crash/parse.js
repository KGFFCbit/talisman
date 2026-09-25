// KGFFC Crash Kitchen — file readers.
// Every file is treated as hostile: hard caps on size, lines, columns and cell length; numbers only
// through a strict regex; text stripped of control and bidi characters and only ever shown with
// textContent; keys held in Maps so a crafted "__proto__" line is just a string.

export const LIMITS = { bytes: 64 * 1024 * 1024, lines: 400000, lineLen: 200000, cols: 800, cell: 300, rawCell: 4000, head: 300, events: 2000, values: 6000000 };

const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d{1,3})?$/; // one way to match a digit run: no backtracking blow-up
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,7})?([+-]\d\d:\d\d|Z)$/;
const KEY = /^[a-z0-9_]{1,40}$/;

export function num(s) {
  s = String(s ?? "").trim();
  if (/^yes$/i.test(s)) return 1;
  if (/^no$/i.test(s)) return 0;
  return NUM.test(s) ? Number(s) : NaN;
}

// Strip control/bidi characters and stacked accents, and mask links, domains and emails, so text from a
// file can never read like advice from this site ("download the fix at …").
export function clean(s, max = LIMITS.cell) {
  s = String(s ?? "").slice(0, LIMITS.rawCell)
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\p{M}{3,}/gu, "")
    .replace(/\b(?:https?|ftp|file):\/\/\S*/gi, "[link removed]")
    .replace(/\bwww\.\S*/gi, "[link removed]")
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,63}/g, "[email removed]")
    .replace(/\b[\w-]{1,63}\.(?:com|net|org|io|xyz|ru|cn|info|biz|co|me|app|dev|gg|link|site|online|top|zip|click|ly|to|sh)\b\S*/gi, "[link removed]")
    .trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}
// App names from a file are only shown if they look like a process name.
export function appName(s) { s = String(s ?? "").trim(); return /^[\w .+()-]{1,40}$/.test(s) && !/\.(?:com|net|org|io)\b/i.test(s) ? s : ""; }

export class FileError extends Error {}

// ---------- bytes → text
export async function readFile(file) {
  if (file.size > LIMITS.bytes) throw new FileError(`That file is ${Math.round(file.size / 1048576)} MB. The limit is 64 MB: record a shorter session.`);
  return decode(new Uint8Array(await file.arrayBuffer()));
}

export function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf).replace(/^\ufeff/, "");
  const head = buf.subarray(0, 65536);
  let nul = 0;
  for (let i = 0; i < head.length; i++) if (head[i] === 0) nul++;
  if (nul > 8) throw new FileError("That's a binary file (maybe an .etl, .blg or .zip). Run 2-PLATE-IT and drop the .txt file it makes.");
  let t = new TextDecoder("utf-8").decode(buf);
  const probe = t.slice(0, 200000);
  if ((probe.match(/\ufffd/g) || []).length > 10) t = new TextDecoder("windows-1252").decode(buf); // HWiNFO writes ANSI
  return t.replace(/^\ufeff/, "");
}

// ---------- CSV (one record per line; none of our sources put newlines inside a cell)
export function csvLine(line, max = LIMITS.rawCell) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { if (cur.length < max) cur += '"'; i++; } else q = false; }
      else if (cur.length < max) cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; if (out.length >= LIMITS.cols) return out; }
    else if (cur.length < max) cur += c;
  }
  out.push(cur);
  return out;
}

function lines(text) {
  const all = text.split(/\r?\n/);
  if (all.length > LIMITS.lines) throw new FileError(`That file has ${all.length.toLocaleString()} lines. The limit is ${LIMITS.lines.toLocaleString()}: record a shorter session.`);
  return all.filter((l) => l.length > 0 && l.length <= LIMITS.lineLen);
}

// ---------- dataset
export function emptySet() {
  return { system: new Map(), session: new Map(), events: [], series: new Map(), labels: new Map(), sources: new Set(), notes: [], values: 0 };
}

// Only the metrics the page actually uses are kept, and the total is capped, so a huge crafted file
// can't eat the tab's memory.
const USED = new Set(["cpu_pct", "cpu_core_max", "cpu_perf_pct", "cpu_base_mhz", "cpu_limit_pct", "cpu_dpc_pct", "mem_avail_mb", "mem_commit_pct",
  "gpu_3d_pct", "disk_read_mbs", "disk_write_mbs", "disk_idle_min", "disk_latency_ms", "net_rx_mbs", "net_tx_mbs", "acpi_temp_k",
  "gpu_temp", "gpu_pct", "gpu_power", "gpu_mhz", "gpu_reasons", "cpu_temp", "cpu_power", "cpu_vcore", "cpu_soc_v", "cpu_eff_mhz", "cpu_throttle",
  "v12", "v5", "v33", "dram_v", "dimm_temp", "vrm_temp", "gpu_hotspot", "gpu_mem_temp", "gpu_12v_in", "gpu_limit_power", "gpu_limit_thermal",
  "whea_total", "fan_cpu_rpm", "pump_rpm"]);
function push(ds, key, t, v) {
  if (!USED.has(key) || !Number.isFinite(t) || !Number.isFinite(v)) return;
  if (++ds.values > LIMITS.values) { if (ds.values === LIMITS.values + 1) ds.notes.push("That file is huge, so only the first part was read."); return; }
  let s = ds.series.get(key);
  if (!s) ds.series.set(key, (s = { t: [], v: [] }));
  s.t.push(t); s.v.push(v);
}
function pushLabel(ds, key, t, v) {
  v = appName(v);
  if (!Number.isFinite(t) || !v || ds.values++ > LIMITS.values) return;
  let s = ds.labels.get(key);
  if (!s) ds.labels.set(key, (s = { t: [], v: [] }));
  s.t.push(t); s.v.push(v);
}

// Anything outside 2000–2100 is rejected: a crafted year-0000-to-9999 span would stall the time axis.
const sane = (t) => (t > 946684800000 && t < 4102444800000 ? t : NaN);
function isoTime(s) { s = String(s).trim(); return ISO.test(s) ? sane(Date.parse(s)) : NaN; }

// Local wall-clock parts → epoch ms. offMin = minutes EAST of UTC (from the plate); null = viewer's zone.
function wall(y, mo, d, h, mi, sec, offMin) {
  const ms = Math.round((sec % 1) * 1000), s = Math.floor(sec);
  if (![y, mo, d, h, mi, s].every(Number.isFinite) || mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
  if (offMin == null) return sane(new Date(y, mo - 1, d, h, mi, s, ms).getTime());
  return sane(Date.UTC(y, mo - 1, d, h, mi, s, ms) - offMin * 60000);
}
function clock(s) {
  const m = /^(\d{1,2}):(\d\d):(\d\d(?:\.\d{1,6})?)$/.exec(String(s).trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

// ---------- detect + parse
export function parseText(text, name = "file") {
  const ds = emptySet();
  const ls = lines(text);
  if (!ls.length) throw new FileError("That file is empty.");
  const first = ls[0];
  if (first.startsWith("#KGFFC-PLATE")) parsePlate(ls, ds);
  else if (/^"?time"?,/i.test(first)) parseCounters(ls, ds, null);
  else if (/^"?Date"?,"?Time"?,/.test(first)) parseHwinfo(ls, ds, null);
  else if (/^"?\(PDH-CSV/.test(first)) parseTypeperf(ls, ds);
  else if (/^timestamp\s*,/i.test(first)) parseNvidia(ls, ds, null);
  else throw new FileError(`We don't recognise "${clean(name, 60)}". Drop the KGFFC-plate .txt file from your Desktop (or a HWiNFO / typeperf CSV).`);
  return ds;
}

function parsePlate(ls, ds) {
  ds.sources.add("KGFFC plate");
  const sec = new Map();
  let cur = null;
  for (const l of ls) {
    const m = /^\[(SYSTEM|SESSION|EVENTS|COUNTERS|HWINFO|END)\]$/.exec(l);
    if (m) { cur = m[1]; if (!sec.has(cur)) sec.set(cur, []); continue; }
    if (cur) sec.get(cur).push(l);
  }
  for (const [k, target] of [["SYSTEM", ds.system], ["SESSION", ds.session]]) {
    for (const l of sec.get(k) || []) {
      const i = l.indexOf("=");
      if (i < 1 || target.size >= 60) continue;
      const key = l.slice(0, i).trim().toLowerCase();
      if (KEY.test(key)) target.set(key, clean(l.slice(i + 1), 240));
    }
  }
  const off = Number.parseInt(ds.system.get("tz_offset_min"), 10);
  const tz = Number.isFinite(off) && Math.abs(off) <= 900 ? off : null;
  if (sec.get("EVENTS")?.length) parseEvents(sec.get("EVENTS"), ds);
  if (sec.get("COUNTERS")?.length) parseCounters(sec.get("COUNTERS"), ds, tz);
  if (sec.get("HWINFO")?.length) parseHwinfo(sec.get("HWINFO"), ds, tz);
}

function parseEvents(ls, ds) {
  const head = csvLine(ls[0], LIMITS.head).map((h) => h.trim().toLowerCase());
  const ix = (n) => head.indexOf(n);
  const [it, ip, ii, il, idt, im] = ["time", "provider", "id", "level", "data", "message"].map(ix);
  if (it < 0 || ip < 0 || ii < 0) return;
  for (let r = 1; r < ls.length && ds.events.length < LIMITS.events; r++) {
    const c = csvLine(ls[r]);
    const t = isoTime(c[it]);
    const id = num(c[ii]);
    if (!Number.isFinite(t) || !Number.isInteger(id)) continue;
    const data = new Map();
    for (const kv of clean(c[idt] ?? "", 2000).split(";")) {
      const j = kv.indexOf("=");
      if (j > 0 && data.size < 40) data.set(clean(kv.slice(0, j), 40), clean(kv.slice(j + 1), 200));
    }
    ds.events.push({ t, provider: clean(c[ip], 80), id, level: num(c[il]) || 4, data, msg: clean(c[im] ?? "", 300) });
  }
  ds.events.sort((a, b) => a.t - b.t);
  ds.sources.add("Windows event log");
}

// Our own recorder: time,<name>,<name>… with names from kgffc-counters.txt
const TEXT_COLS = new Set(["top_cpu_app", "top_gpu_app"]);
function parseCounters(ls, ds, tz) {
  const head = csvLine(ls[0], LIMITS.head).map((h) => h.trim().toLowerCase());
  if (head[0] !== "time") return;
  for (let r = 1; r < ls.length; r++) {
    const c = csvLine(ls[r]);
    const t = isoTime(c[0]);
    if (!Number.isFinite(t)) continue;
    for (let j = 1; j < head.length && j < c.length; j++) {
      const k = head[j];
      if (!KEY.test(k)) continue;
      if (TEXT_COLS.has(k)) { if (c[j]) pushLabel(ds, k, t, c[j]); }
      else if (c[j] !== "") push(ds, k, t, num(c[j]));
    }
  }
  ds.sources.add("KGFFC recorder");
}

// HWiNFO sensor log. Labels vary by board and version, so each metric lists label patterns in priority
// order; "max" picks the busiest matching column (e.g. the real graphics card over the CPU's iGPU).
const HW = [
  ["cpu_temp", [/^CPU \(Tctl\/Tdie\)/i, /^CPU Package \[/i, /^CPU Die \(average\)/i, /^Core Max \[/i], "first"],
  ["cpu_power", [/^CPU Package Power \[W\]/i, /^CPU PPT \[W\]/i], "first"],
  ["cpu_vcore", [/^CPU Core Voltage \(SVI3 TFN\) \[V\]/i, /^CPU Core Voltage \(SVI2 TFN\) \[V\]/i, /^Vcore \[V\]/i, /^CPU Core Voltage.*\[V\]/i], "first"],
  ["cpu_soc_v", [/^CPU SoC Voltage.*\[V\]/i, /^VSOC.*\[V\]/i, /^SoC Voltage.*\[V\]/i, /^VDD_?SOC.*\[V\]/i], "first"],
  ["cpu_eff_mhz", [/^Average Effective Clock \[MHz\]/i, /^Core Effective Clocks \(avg\) \[MHz\]/i], "first"],
  ["cpu_throttle", [/Thermal Throttling \((HTC|PROCHOT CPU|PROCHOT EXT)\)/i, /^Package\/Ring Thermal Throttling/i], "any"],
  ["v12", [/^\+12V \[V\]/i, /^12V \[V\]/i], "first"],
  ["v5", [/^\+5V \[V\]/i], "first"],
  ["v33", [/^\+3\.3V \[V\]/i], "first"],
  ["dram_v", [/^DRAM( Voltage)? \[V\]/i, /^VDD Voltage \[V\]/i], "first"],
  ["dimm_temp", [/^SPD Hub Temperature \[°C\]/i, /^DIMM.*\[°C\]/i], "max"],
  ["vrm_temp", [/VRM.*\[°C\]/i, /MOS.*\[°C\]/i, /^VR V?CC.*\[°C\]/i], "max"],
  ["gpu_temp", [/^GPU Temperature \[°C\]/i], "max"],
  ["gpu_hotspot", [/^GPU Hot ?Spot Temperature \[°C\]/i], "max"],
  ["gpu_mem_temp", [/^GPU Memory Junction Temperature \[°C\]/i], "max"],
  ["gpu_power", [/^GPU Power \[W\]/i, /^Total Board Power \[W\]/i, /^Total Graphics Power \[W\]/i, /^GPU ASIC Power \[W\]/i], "max"],
  ["gpu_pct", [/^GPU Core Load \[%\]/i, /^GPU Utilization \[%\]/i], "max"],
  ["gpu_mhz", [/^GPU Clock \[MHz\]/i], "max"],
  ["gpu_12v_in", [/^GPU 16-pin HVPWR Voltage \[V\]/i, /^GPU PCIe \+12V Input Voltage \[V\]/i, /^GPU 8-pin #1 Input Voltage \[V\]/i], "first"],
  ["gpu_limit_power", [/^Performance Limit - Power/i], "any"],
  ["gpu_limit_thermal", [/^Performance Limit - Thermal/i], "any"],
  ["whea_total", [/^Total Errors \[#\]/i], "first"],
  ["fan_cpu_rpm", [/^CPU( Fan)? \[RPM\]/i, /^CPU_FAN.*\[RPM\]/i, /^CPU OPT.*\[RPM\]/i], "first"],
  ["pump_rpm", [/PUMP.*\[RPM\]/i], "first"],
];

function parseHwinfo(ls, ds, tz) {
  const head = csvLine(ls[0], LIMITS.head).map((h) => clean(h, 120));
  const rows = [];
  for (let r = 1; r < ls.length; r++) {
    const c = csvLine(ls[r]);
    const d = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/.exec((c[0] || "").trim());
    const k = clock(c[1] || "");
    if (!d || !k) continue; // skips the repeated header/footer rows
    let y, mo, day;
    if (d[1].length === 4) [y, mo, day] = [+d[1], +d[2], +d[3]];
    else if ((c[0] || "").includes("/")) [mo, day, y] = [+d[1], +d[2], +d[3]];
    else [day, mo, y] = [+d[1], +d[2], +d[3]];
    const t = wall(y, mo, day, k[0], k[1], k[2], tz);
    if (Number.isFinite(t)) rows.push([t, c]);
  }
  if (!rows.length) return;
  for (const [key, pats, how] of HW) {
    let cols = [];
    for (const p of pats) {
      cols = head.map((h, i) => (p.test(h) ? i : -1)).filter((i) => i >= 0);
      if (cols.length) break;
    }
    if (!cols.length) continue;
    if (how === "first") cols = [cols[0]];
    if (how === "max" && cols.length > 1) {
      const peaks = cols.map((i) => rows.reduce((m, [, c]) => Math.max(m, num(c[i]) || 0), 0));
      cols = [cols[peaks.indexOf(Math.max(...peaks))]];
    }
    for (const [t, c] of rows) {
      let v = NaN;
      for (const i of cols) { const x = num(c[i]); if (Number.isFinite(x)) v = Number.isFinite(v) ? Math.max(v, x) : x; }
      push(ds, key, t, v);
    }
  }
  ds.sources.add("HWiNFO");
}

// typeperf / PerfMon CSV: "(PDH-CSV 4.0) (Eastern Daylight Time)(240)" — bias is minutes WEST of UTC.
const PDH = [
  ["cpu_pct", /\\processor( information)?\(_total\)\\% processor time$/i, "sum", 1],
  ["cpu_perf_pct", /\\processor information\(_total\)\\% processor performance$/i, "sum", 1],
  ["cpu_base_mhz", /\\processor information\(_total\)\\processor frequency$/i, "sum", 1],
  ["cpu_limit_pct", /\\processor information\(_total\)\\% performance limit$/i, "sum", 1],
  ["mem_avail_mb", /\\memory\\available mbytes$/i, "sum", 1],
  ["mem_commit_pct", /\\memory\\% committed bytes in use$/i, "sum", 1],
  ["disk_read_mbs", /\\physicaldisk\(_total\)\\disk read bytes\/sec$/i, "sum", 1 / 1048576],
  ["disk_write_mbs", /\\physicaldisk\(_total\)\\disk write bytes\/sec$/i, "sum", 1 / 1048576],
  ["net_rx_mbs", /\\network interface\(.*\)\\bytes received\/sec$/i, "sum", 1 / 1048576],
  ["net_tx_mbs", /\\network interface\(.*\)\\bytes sent\/sec$/i, "sum", 1 / 1048576],
  ["gpu_3d_pct", /\\gpu engine\(.*engtype_3d\)\\utilization percentage$/i, "sum", 1],
  ["acpi_temp_k", /\\thermal zone information\(.*\)\\temperature$/i, "max", 1],
];
function parseTypeperf(ls, ds) {
  const head = csvLine(ls[0], LIMITS.head);
  const bias = /\((-?\d{1,4})\)\s*$/.exec(head[0] || "");
  const tz = bias ? -Number(bias[1]) : null;
  const map = head.map((h) => PDH.find(([, re]) => re.test(h.trim())) || null);
  for (let r = 1; r < ls.length; r++) {
    const c = csvLine(ls[r]);
    const d = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d(?:\.\d+)?)$/.exec((c[0] || "").trim());
    if (!d) continue;
    const t = wall(+d[3], +d[1], +d[2], +d[4], +d[5], +d[6], tz);
    const acc = new Map();
    for (let j = 1; j < c.length; j++) {
      const m = map[j]; const x = num(c[j]);
      if (!m || !Number.isFinite(x)) continue;
      const [key, , how, scale] = m;
      const prev = acc.get(key);
      acc.set(key, prev == null ? x * scale : how === "max" ? Math.max(prev, x * scale) : prev + x * scale);
    }
    for (const [k, v] of acc) push(ds, k, t, v);
  }
  ds.sources.add("typeperf");
}

// nvidia-smi --format=csv log
function parseNvidia(ls, ds, tz) {
  const head = csvLine(ls[0], LIMITS.head).map((h) => { h = h.trim().toLowerCase(); const b = h.indexOf("["); return (b > 0 ? h.slice(0, b) : h).trim(); });
  const F = { "temperature.gpu": "gpu_temp", "utilization.gpu": "gpu_pct", "power.draw": "gpu_power", "clocks.gr": "gpu_mhz", "clocks.current.graphics": "gpu_mhz", "fan.speed": "gpu_fan_pct", "memory.used": "gpu_vram_used_mb" };
  for (let r = 1; r < ls.length; r++) {
    const c = csvLine(ls[r], 64).map((x) => x.trim().replace(/ ?(?:%|W|MHz|MiB)$/, ""));
    const d = /^(\d{4})\/(\d\d)\/(\d\d) (\d\d):(\d\d):(\d\d(?:\.\d+)?)$/.exec(c[0] || "");
    if (!d) continue;
    const t = wall(+d[1], +d[2], +d[3], +d[4], +d[5], +d[6], tz);
    head.forEach((h, j) => { if (F[h]) push(ds, F[h], t, num(c[j])); });
  }
  ds.sources.add("nvidia-smi");
}

// ---------- merge several dropped files, then derive the friendly metrics
export function merge(sets) {
  const ds = emptySet();
  for (const s of sets) {
    for (const [k, v] of s.system) if (!ds.system.has(k)) ds.system.set(k, v);
    for (const [k, v] of s.session) if (!ds.session.has(k)) ds.session.set(k, v);
    for (const e of s.events) if (ds.events.length < LIMITS.events) ds.events.push(e);
    ds.notes.push(...s.notes);
    for (const src of s.sources) ds.sources.add(src);
    for (const [bag, into] of [[s.series, ds.series], [s.labels, ds.labels]]) {
      for (const [k, v] of bag) if (!into.has(k) || into.get(k).t.length < v.t.length) into.set(k, v);
    }
  }
  const seen = new Set();
  ds.events = ds.events.filter((e) => { const k = `${e.t}|${e.provider}|${e.id}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.t - b.t);
  derive(ds);
  return ds;
}

function sorted(s) {
  const idx = s.t.map((_, i) => i).sort((a, b) => s.t[a] - s.t[b]);
  return { t: Float64Array.from(idx, (i) => s.t[i]), v: Float64Array.from(idx, (i) => s.v[i]) };
}
function map1(s, f) { return { t: s.t.slice(), v: s.v.map(f) }; }
function combine(a, b, f) {
  const t = [], v = [];
  let j = 0;
  for (let i = 0; i < a.t.length; i++) {
    while (j < b.t.length - 1 && Math.abs(b.t[j + 1] - a.t[i]) <= Math.abs(b.t[j] - a.t[i])) j++;
    if (Math.abs(b.t[j] - a.t[i]) < 5000) { t.push(a.t[i]); v.push(f(a.v[i], b.v[j])); }
  }
  return { t: Float64Array.from(t), v: Float64Array.from(v) };
}

function derive(ds) {
  for (const [k, s] of ds.series) ds.series.set(k, sorted(s));
  const S = ds.series;
  if (!S.has("cpu_mhz") && S.has("cpu_base_mhz") && S.has("cpu_perf_pct")) S.set("cpu_mhz", combine(S.get("cpu_base_mhz"), S.get("cpu_perf_pct"), (b, p) => (b * p) / 100));
  if (S.has("cpu_eff_mhz")) S.set("cpu_mhz", S.get("cpu_eff_mhz"));
  if (!S.has("gpu_pct") && S.has("gpu_3d_pct")) S.set("gpu_pct", map1(S.get("gpu_3d_pct"), (v) => Math.min(100, v)));
  if (S.has("disk_idle_min")) S.set("disk_busy_pct", map1(S.get("disk_idle_min"), (v) => Math.max(0, Math.min(100, 100 - v))));
  if (S.has("acpi_temp_k")) {
    const a = map1(S.get("acpi_temp_k"), (v) => v - 273.15);
    if (a.v.some((v) => v > 5 && v < 130)) S.set("acpi_temp", a);
  }
  const ramGb = Number.parseFloat(ds.system.get("ram_total_gb"));
  if (S.has("mem_avail_mb") && ramGb > 0) S.set("ram_used_pct", map1(S.get("mem_avail_mb"), (v) => Math.max(0, Math.min(100, 100 - (100 * v) / (ramGb * 1024)))));
  for (const [k, s] of ds.labels) ds.labels.set(k, (() => { const idx = s.t.map((_, i) => i).sort((a, b) => s.t[a] - s.t[b]); return { t: Float64Array.from(idx, (i) => s.t[i]), v: idx.map((i) => s.v[i]) }; })());
}

// Index of the sample at or just before time t (binary search).
export function at(s, t) {
  let lo = 0, hi = s.t.length - 1;
  if (hi < 0 || t < s.t[0]) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s.t[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}
