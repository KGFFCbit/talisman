// Shared front-end plumbing between /inventory/ and /status/.
// Every inventory refresh saves a "run" (HTTP status, timings, server trace). The dashboard
// listens and redraws immediately, even when it is open in another tab.
const RUNS_KEY = "gfi.runs";
const CHANNEL = "gfi-telemetry";
const MAX_RUNS = 20;

export function loadRuns() {
  try { return JSON.parse(localStorage.getItem(RUNS_KEY)) || []; } catch { return []; }
}

export function saveRun(run) {
  const runs = [run, ...loadRuns()].slice(0, MAX_RUNS);
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs)); } catch { /* storage unavailable */ }
  try { const bc = new BroadcastChannel(CHANNEL); bc.postMessage({ type: "run", run }); bc.close(); } catch { /* unsupported */ }
  return runs;
}

// cb(run) fires when ANY tab on this site records a new run.
export function onRun(cb) {
  try { const bc = new BroadcastChannel(CHANNEL); bc.onmessage = (e) => e.data?.type === "run" && cb(e.data.run); } catch { /* unsupported */ }
  addEventListener("storage", (e) => { if (e.key === RUNS_KEY) cb(loadRuns()[0]); });
}

// Browser-measured phases for a same-origin request (from the Resource Timing API).
// A phase of 0 usually means the connection was reused, which is normal.
export function phasesFor(url) {
  const entry = performance.getEntriesByName(new URL(url, location.href).href).pop();
  if (!entry) return null;
  const tls = entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0;
  const r = (n) => Math.max(0, Math.round(n));
  return {
    dns: r(entry.domainLookupEnd - entry.domainLookupStart),
    connect: r(entry.connectEnd - entry.connectStart - tls),
    tls: r(tls),
    wait: r(entry.responseStart - entry.requestStart),
    download: r(entry.responseEnd - entry.responseStart),
    total: r(entry.duration),
  };
}
