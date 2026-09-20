// One place that performs an inventory refresh and records what happened, so the inventory
// page and the network dashboard behave identically.
import { saveRun, phasesFor } from "./telemetry.js";

const SNAP_KEY = "gfi.snapshot";
const URL_PATH = "/api/inventory";

export function loadSnapshot() { try { return JSON.parse(localStorage.getItem(SNAP_KEY)); } catch { return null; } }
export function saveSnapshot(s) { try { localStorage.setItem(SNAP_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }

// x-vercel-id looks like "iad1::abc-123"; only the leading region code is kept.
const regionOf = (h) => (h?.match(/^([a-z]{3,4}\d)/i) || [])[1] || null;

export async function refreshInventory() {
  const at = Date.now();
  const started = performance.now();
  let res;
  try {
    res = await fetch(URL_PATH, { cache: "no-store" });
  } catch (e) {
    // fetch() only throws when the browser could not complete the request at all.
    const run = {
      at, ok: false, http: 0, clientMs: Math.round(performance.now() - started), errorClass: "network",
      error: "This browser could not reach kgffc.net (offline, DNS failure, or a VPN/firewall blocking it).",
    };
    saveRun(run);
    return { ok: false, run, error: run.error };
  }

  const body = await res.json().catch(() => null);
  const run = {
    at, ok: res.ok, http: res.status, clientMs: Math.round(performance.now() - started),
    phases: phasesFor(URL_PATH), cache: res.headers.get("x-vercel-cache"),
    edgeRegion: regionOf(res.headers.get("x-vercel-id")),
    server: body?.telemetry || null, failedStep: body?.failedStep || null,
    bungieStatus: body?.bungieStatus || null, bungieCode: body?.bungieCode ?? null,
    errorClass: res.ok ? null : "http",
    error: res.ok ? null : body?.error || `The server answered HTTP ${res.status}`,
  };
  saveRun(run);
  if (!res.ok) return { ok: false, run, error: run.error };

  // Keep definitions we already know so a partial lookup never loses icons.
  const prev = loadSnapshot();
  body.defs.items = { ...(prev?.defs?.items || {}), ...body.defs.items };
  body.defs.buckets = { ...(prev?.defs?.buckets || {}), ...body.defs.buckets };
  delete body.telemetry;
  saveSnapshot(body);
  return { ok: true, run, snapshot: body };
}
