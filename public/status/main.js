// KGFFC Signal Check: front end only. All measuring happens in /api/health (server), the
// browser probes, and the optional trace agent. This file just draws what they report.
import { loadRuns, onRun } from "/shared/telemetry.js";
import { refreshInventory } from "/shared/refresh.js";
import { probeSite, probeBungie } from "./probes.js";
import { buildChecks, verdict, WHO, NODES, nodeState } from "./model.js";
import { renderMap, renderPathList } from "./map.js";
import { renderCodes } from "./codes.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TRACE_KEY = "gfi.trace";
const LABEL = { ok: "Green", warn: "Amber", fail: "Red", unknown: "n/a" };
const SYM = { ok: "✓", warn: "!", fail: "✕", unknown: "–" };

const state = { health: null, probes: null, trace: null, traceSource: null, run: loadRuns()[0] || null, selected: null, note: "", checkedAt: null, codeCls: "all", codeQ: "" };

// ---- Data gathering ------------------------------------------------------------------------
async function fetchHealth() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { http: res.status });
    return await res.json();
  } catch (e) {
    const http = e.http || 0;
    return {
      generatedAt: Date.now(),
      checks: [{
        id: "api", label: "KGFFC API function", layer: "api", order: 40, status: "fail", http: http || null, ms: null,
        detail: http === 404 ? "The health function is not deployed (HTTP 404)" : http ? `The health function answered HTTP ${http}` : "The health function could not be reached",
        who: http === 404 || http >= 500 ? "config" : "network",
        action: http === 404 ? "Redeploy the site so /api/health exists." : http >= 500 ? "Check the function logs in Vercel." : "Check the network path to kgffc.net.",
      }],
    };
  }
}

async function runLiveCheck() {
  setBusy(true, "Checking Cloudflare, Bungie, OAuth and your own path...");
  const [health, site, bungie] = await Promise.all([fetchHealth(), probeSite(), probeBungie()]);
  state.health = health; state.probes = { site, bungie }; state.checkedAt = Date.now(); state.note = "";
  setBusy(false); draw();
}

async function refreshNow() {
  setBusy(true, "Refreshing inventory and recording the trace...");
  const result = await refreshInventory();
  state.run = result.run; state.note = "Updated by an inventory refresh just now.";
  setBusy(false); draw();
}

function setBusy(on, msg = "") {
  for (const id of ["btnLive", "btnRefresh"]) $(id).disabled = on;
  $("stamp").textContent = on ? msg : "";
}

// ---- Trace agent file ----------------------------------------------------------------------
function acceptTrace(json, source) {
  const text = JSON.stringify(json);
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)) throw new Error("That file contains an IP address. Traces must be sanitized: re-run agent/trace.ps1.");
  if (json?.schema !== 1 || !Array.isArray(json.hops)) throw new Error("That does not look like a trace file from agent/trace.ps1.");
  state.trace = json; state.traceSource = source;
  if (source === "yours") { try { localStorage.setItem(TRACE_KEY, text); } catch { /* storage unavailable */ } }
}

async function loadTrace() {
  try { const saved = localStorage.getItem(TRACE_KEY); if (saved) return acceptTrace(JSON.parse(saved), "yours"); } catch { /* fall through to the sample */ }
  try { const res = await fetch("/status/data/trace.json", { cache: "no-cache" }); if (res.ok) acceptTrace(await res.json(), "sample"); } catch { /* no trace available */ }
}

// ---- Drawing -------------------------------------------------------------------------------
function draw() {
  const checks = buildChecks({ health: state.health, run: state.run, probes: state.probes, trace: state.trace });
  const v = verdict(checks);
  state.checks = checks; state.verdict = v;
  const ctx = { checks, verdict: v, trace: state.trace, selected: state.selected, region: state.health?.region, colo: state.run?.server?.colo };

  // Verdict card
  const who = WHO[v.who] || WHO.none;
  $("verdict").className = `verdict ${v.level}`;
  $("verdict").innerHTML = `<div class="lamp" aria-hidden="true">${SYM[v.level]}</div>
    <div class="vbody"><p class="eyebrow">${v.level === "ok" ? "Status" : v.level === "fail" ? "Start here" : "Keep an eye on"}</p>
      <h2>${esc(v.headline)}</h2><p class="vdetail">${esc(v.detail)}</p>
      ${v.level !== "ok" ? `<p class="vfix"><span class="who ${v.who}">${esc(who.label)}</span> ${esc(v.action)}</p>` : ""}
      ${v.more > 0 ? `<p class="vmore">+${v.more} more ${v.more === 1 ? "issue" : "issues"} below</p>` : ""}</div>`;

  // Map + list + detail
  renderMap($("map"), ctx);
  renderPathList($("pathlist"), ctx);
  drawDetail(ctx);

  // Endpoint board
  $("checks").innerHTML = checks.map((c) => `<tr class="${c.status}"><td><span class="pill ${c.status}"><span aria-hidden="true">${SYM[c.status]}</span> ${LABEL[c.status]}</span></td>
    <td><b>${esc(c.label)}</b><br><small>${esc(c.detail)}</small></td><td class="num">${c.http ?? ""}</td><td class="num">${c.ms != null ? Math.round(c.ms) + " ms" : ""}</td>
    <td>${c.who !== "none" ? `<span class="who ${c.who}">${esc(WHO[c.who].label)}</span>` : ""}</td></tr>`).join("");

  $("stamp").textContent = state.checkedAt ? `Checked ${new Date(state.checkedAt).toLocaleTimeString()}` : "";
  $("note").textContent = state.note;
  drawTraceInfo(); drawWaterfall(); drawHistory();

  const seen = new Set(checks.map((c) => c.http).filter(Boolean));
  for (const s of state.run?.server?.steps || []) {
    if (typeof s.http === "number" && s.http) seen.add(s.http);            // single call
    else if (s.http && typeof s.http === "object") Object.keys(s.http).forEach((k) => seen.add(Number(k))); // tally of many calls
  }
  if (state.run?.http) seen.add(state.run.http);
  renderCodes($("codes"), { seen, filter: state.codeQ, cls: state.codeCls });
}

function drawDetail(ctx) {
  const node = NODES.find((n) => n.id === state.selected);
  if (!node) { $("detail").innerHTML = '<p class="hint">Click any node on the map to see its checks.</p>'; return; }
  const s = nodeState(node, ctx.checks);
  $("detail").innerHTML = `<h3>${esc(node.label)} <span class="pill ${s.status}">${LABEL[s.status]}</span></h3>` + (s.checks.length
    ? `<ul>${s.checks.map((c) => `<li class="${c.status}"><b>${esc(c.label)}</b> ${c.http ? `<span class="tag">HTTP ${c.http}</span>` : ""}${c.ms != null ? `<span class="tag">${Math.round(c.ms)} ms</span>` : ""}<br>${esc(c.detail)}${c.action ? `<br><em>Fix: ${esc(c.action)}</em>` : ""}</li>`).join("")}</ul>`
    : "<p>Nothing measured here yet. Run a live check.</p>");
}

function drawTraceInfo() {
  const t = state.trace;
  $("traceInfo").innerHTML = t
    ? `Showing a ${state.traceSource === "sample" ? "<b>sample</b> trace" : "<b>your</b> trace"} captured ${new Date(t.generatedAt).toLocaleString()}: ${t.hops.length} hops to ${esc(t.target)}, VPN ${t.vpn?.detected ? "detected" : "not in use"}.`
    : "No trace loaded. Run the agent on the affected computer, then load the file it writes.";
}

// "Where did the time go" for the latest inventory refresh.
function drawWaterfall() {
  const r = state.run, box = $("waterfall");
  if (!r) { box.innerHTML = '<p class="hint">No inventory refresh recorded yet. Press <b>Refresh inventory now</b>.</p>'; return; }
  const p = r.phases || {}, steps = r.server?.steps || [];
  const step = (name) => steps.find((s) => s.step === name);
  const rows = [
    ["Browser: DNS lookup", p.dns, "browser"], ["Browser: connect", p.connect, "browser"], ["Browser: TLS handshake", p.tls, "browser"],
    ["Wait for the server", p.wait, "edge"],
    ["Server to Bungie: find player", step("search")?.ms, "bungie", step("search")?.http],
    ["Server to Bungie: read inventory", step("profile")?.ms, "bungie", step("profile")?.http],
    ["Server to Bungie: item details (avg)", step("definitions")?.ms, "bungie", step("definitions") ? Object.keys(step("definitions").http || {}).join("/") : null],
    ["Download the result", p.download, "browser"],
  ].filter((row) => row[1] != null);
  const total = Math.max(r.clientMs || 0, ...rows.map((x) => x[1]), 1);
  box.innerHTML = `<p class="wmeta">HTTP <b>${r.http || "none"}</b> · ${r.clientMs} ms total · ${r.cache ? `edge cache: ${esc(r.cache)}` : "no cache info"}${r.server?.colo ? ` · Cloudflare edge ${esc(r.server.colo)}` : ""}${r.edgeRegion ? ` · site edge ${esc(r.edgeRegion)}` : ""} · ${new Date(r.at).toLocaleTimeString()}</p>` +
    (rows.length ? rows.map(([name, v, kind, http]) => `<div class="wrow"><span class="wn">${name}${http ? ` <small>HTTP ${esc(http)}</small>` : ""}</span><span class="wbar"><i class="${kind}" style="width:${Math.max(1, (v / total) * 100)}%"></i></span><span class="wv">${Math.round(v)} ms</span></div>`).join("")
      : `<p class="hint">${r.ok ? "Timing details were not available." : esc(r.error || "The request did not complete.")}</p>`) +
    (r.ok ? "" : `<p class="hint">Failed at: <b>${esc(r.failedStep || "the browser")}</b>${r.bungieStatus ? ` · Bungie said ${esc(r.bungieStatus)}` : ""}</p>`) +
    '<p class="hint">0 ms usually means the connection was reused, which is normal.</p>';
}

function drawHistory() {
  const runs = loadRuns();
  $("history").innerHTML = runs.length
    ? `<div class="bars">${runs.slice().reverse().map((r) => `<span class="hbar ${r.ok ? "ok" : "fail"}" style="height:${Math.min(100, 12 + (r.clientMs / 40))}%" title="${new Date(r.at).toLocaleTimeString()} · HTTP ${r.http || "none"} · ${r.clientMs} ms"></span>`).join("")}</div>
       <p class="hint">Last ${runs.length} refreshes on this browser, oldest to newest. Taller bar = slower. Red = failed.</p>`
    : '<p class="hint">Every inventory refresh adds a bar here.</p>';
}

// ---- Wiring --------------------------------------------------------------------------------
function summaryText() {
  const v = state.verdict, bad = state.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return [`KGFFC Signal Check, ${new Date().toLocaleString()}`, `${v.headline}: ${v.detail}`,
    v.action ? `Owner: ${WHO[v.who].label}. Fix: ${v.action}` : "", ...bad.slice(v.level === "ok" ? 0 : 1).map((c) => `- ${c.label}: ${c.detail}`), "https://kgffc.net/status/"].filter(Boolean).join("\n");
}

$("btnLive").addEventListener("click", runLiveCheck);
$("btnRefresh").addEventListener("click", refreshNow);
$("btnCopy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(summaryText()); $("stamp").textContent = "Summary copied."; } catch { $("stamp").textContent = "Copy is blocked in this browser."; }
});
$("traceFile").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { acceptTrace(JSON.parse(await f.text()), "yours"); state.note = "Trace loaded."; draw(); }
  catch (err) { $("traceInfo").textContent = err.message; }
});
$("cmd").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("cmd").dataset.cmd); $("cmd").textContent = "Copied"; setTimeout(() => ($("cmd").textContent = "Copy command"), 1500); } catch { /* ignore */ } });
for (const id of ["map", "pathlist"]) {
  $(id).addEventListener("click", (e) => { const n = e.target.closest("[data-node]"); if (n) { state.selected = n.dataset.node; draw(); } });
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { const n = e.target.closest("[data-node]"); if (n) { e.preventDefault(); state.selected = n.dataset.node; draw(); } } });
}
$("codeQ").addEventListener("input", (e) => { state.codeQ = e.target.value; draw(); });
$("codeTabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-cls]"); if (!b) return; state.codeCls = b.dataset.cls; for (const x of $("codeTabs").children) x.setAttribute("aria-pressed", x === b); draw(); });

// Every inventory refresh, in any tab, updates this dashboard immediately.
onRun((run) => { state.run = run; state.note = "Updated by an inventory refresh just now."; draw(); });

(async () => { await loadTrace(); draw(); runLiveCheck(); })();
