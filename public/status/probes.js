// Browser-side probes: things only the visitor's own browser can measure.
import { phasesFor } from "/shared/telemetry.js";

// How long does this browser take to reach kgffc.net (DNS, connect, TLS, first byte)?
export async function probeSite() {
  const url = `/api/health?ping=1&t=${Date.now()}`;
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    await res.text();
    return { reached: true, http: res.status, ms: Math.round(performance.now() - t0), phases: phasesFor(url) };
  } catch {
    return { reached: false, ms: Math.round(performance.now() - t0) };
  }
}

// Can this browser fetch an item image straight from bungie.net? (VPNs and filters often block it.)
export function probeBungie() {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const img = new Image();
    const finish = (reached) => { clearTimeout(timer); resolve({ reached, ms: Math.round(performance.now() - t0) }); };
    const timer = setTimeout(() => finish(false), 8000);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = `https://www.bungie.net/common/destiny2_content/icons/59e8d862b6ed35e330cb48311460bd12.jpg?cb=${Date.now()}`;
  });
}
