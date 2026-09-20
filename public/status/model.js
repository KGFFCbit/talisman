// Turns raw signals into checks, hops and one plain-English verdict.
// Server checks arrive from /api/health with their own owner + fix. This file adds the checks
// that can only be judged in the browser (path to the site, bungie.net reachability) or from the
// local trace agent (VPN, router, hops, DNS), then picks the ONE thing to look at first.

export const RANK = { fail: 3, warn: 2, unknown: 1, ok: 0 };
export const worst = (...s) => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

// "who" = whose problem it is. This is what lets a support engineer route it in seconds.
export const WHO = {
  parts:   { label: "Parts / cabling",            hint: "Local hardware: cable, Wi-Fi, router, adapter" },
  network: { label: "ISP / VPN / network",        hint: "Internet provider, VPN, DNS or firewall" },
  vendor:  { label: "Vendor (Cloudflare/Bungie)", hint: "Not fixable locally; monitor or escalate" },
  config:  { label: "KGFFC settings",             hint: "A setting or key we control" },
  none:    { label: "No action",                  hint: "" },
};

const check = (o) => ({ http: null, ms: null, detail: "", who: "none", action: "", ...o });
const bandMs = (ms, warn, fail) => (ms == null ? "unknown" : ms >= fail ? "fail" : ms >= warn ? "warn" : "ok");

// ---- Browser-side checks -------------------------------------------------------------------
export function browserChecks(probes) {
  const out = [];
  if (!probes) return out;

  const s = probes.site;
  if (s) {
    if (!s.reached) {
      out.push(check({
        id: "device_net", label: "Your device and network", layer: "device", order: 10, status: "fail", http: 0,
        detail: "This browser could not reach kgffc.net (offline, DNS failure, or a VPN/firewall blocking it)",
        who: "network", action: "Check Wi-Fi/cable, then the VPN. Try another site. Run the trace agent for the exact hop.",
      }));
    } else {
      const p = s.phases;
      const dnsSlow = p && p.dns >= 250;
      out.push(check({ id: "device_net", label: "Your device and network", layer: "device", order: 10, status: "ok", http: s.http, detail: "Online: this browser reached kgffc.net" }));
      out.push(check({
        id: "edge_link", label: "Path to kgffc.net", layer: "network", order: 20,
        status: bandMs(s.ms, 400, 1000), http: s.http, ms: s.ms,
        detail: p
          ? `DNS ${p.dns} ms, connect ${p.connect} ms, TLS ${p.tls} ms, first byte ${p.wait} ms${dnsSlow ? ". DNS is the slow part" : ""}`
          : `Round trip ${s.ms} ms`,
        who: bandMs(s.ms, 400, 1000) === "ok" ? "none" : "network",
        action: bandMs(s.ms, 400, 1000) === "ok" ? "" : dnsSlow ? "Slow DNS lookup. Try another DNS resolver on the router or device." : "Slow path to the site. Check Wi-Fi signal, VPN and ISP; compare on another network.",
      }));
    }
  }

  const b = probes.bungie;
  if (b) {
    out.push(check({
      id: "bungie_direct", label: "Your browser to bungie.net", layer: "bungie", order: 60,
      status: b.reached ? bandMs(b.ms, 1200, 3500) : "fail", ms: b.ms,
      detail: b.reached ? `Item images load from bungie.net in ${b.ms} ms` : "This browser cannot load images from bungie.net",
      who: b.reached && bandMs(b.ms, 1200, 3500) === "ok" ? "none" : "network",
      action: b.reached && bandMs(b.ms, 1200, 3500) === "ok" ? "" : "Icons will be missing. A VPN, firewall, content filter or DNS is blocking or slowing bungie.net.",
    }));
  }
  return out;
}

// ---- Trace-agent checks (VPN, router, hops, DNS) --------------------------------------------
export function traceChecks(trace) {
  if (!trace) return [];
  const out = [];
  const gw = trace.gateway;
  const hops = trace.hops || [];

  out.push(check({
    id: "vpn", label: "VPN tunnel", layer: "device", order: 15,
    status: trace.vpn?.detected ? "ok" : "unknown",
    detail: trace.vpn?.detected ? "A VPN adapter is up on the traced machine" : "No VPN in use on the traced machine (not applicable)",
  }));

  if (gw) {
    const st = gw.lossPct >= 25 ? "fail" : gw.lossPct > 0 ? "warn" : bandMs(gw.ms, 20, 60);
    out.push(check({
      id: "local_gateway", label: "Local gateway (router)", layer: "device", order: 18, status: st, ms: gw.ms,
      detail: `Router answers in ${gw.ms ?? "?"} ms with ${gw.lossPct}% loss`,
      who: st === "ok" ? "none" : "parts",
      action: st === "ok" ? "" : "Reseat/replace the Ethernet cable, try another port, move closer to Wi-Fi, power-cycle the router. Replace router or NIC if it persists.",
    }));
  }

  const jump = hops.reduce((best, h, i) => {
    const prev = hops.slice(0, i).reverse().find((x) => x.ms != null);
    return h.ms != null && prev && h.ms - prev.ms > (best?.by || 0) ? { n: h.n, by: Math.round(h.ms - prev.ms) } : best;
  }, null);
  const traceState = !trace.summary?.reached ? "fail" : jump && jump.by >= 100 ? "warn" : bandMs(trace.summary?.worstMs, 150, 400);
  out.push(check({
    id: "path_trace", label: "Internet path (traceroute)", layer: "network", order: 22, status: traceState, ms: trace.summary?.worstMs,
    detail: !trace.summary?.reached ? `Trace stopped before reaching Bungie after ${hops.length} hops`
      : `${hops.length} hops to Bungie, slowest hop ${trace.summary?.worstMs} ms${jump && jump.by >= 100 ? `, big latency jump at hop ${jump.n}` : ""}`,
    who: traceState === "ok" ? "none" : "network",
    action: traceState === "ok" ? "" : "The slowdown is beyond your router: note the hop number and escalate to the ISP or VPN provider.",
  }));

  if (trace.dns?.ms != null) {
    const st = bandMs(trace.dns.ms, 250, 800);
    out.push(check({
      id: "dns", label: "DNS lookup", layer: "network", order: 21, status: st, ms: trace.dns.ms,
      detail: `Looking up Bungie took ${trace.dns.ms} ms`,
      who: st === "ok" ? "none" : "network",
      action: st === "ok" ? "" : "Slow name lookups make every page feel slow. Try a different DNS resolver on the router.",
    }));
  }
  return out;
}

// ---- Last inventory refresh ---------------------------------------------------------------
export function runChecks(run) {
  if (!run) return [];
  const step = run.failedStep;
  let status = "ok", who = "none", action = "", detail;
  if (run.ok) {
    status = bandMs(run.clientMs, 6000, 12000);
    detail = `Refreshed in ${run.clientMs} ms${run.cache === "HIT" ? " (served from the edge cache; Bungie was not contacted)" : ""}`;
    if (status !== "ok") { who = "vendor"; action = "Bungie is slow right now. Check the Bungie and Cloudflare rows."; }
  } else if (run.errorClass === "network" || run.http === 0) {
    status = "fail"; who = "network"; detail = run.error;
    action = "This browser could not complete the request. Check Wi-Fi/cable, then VPN and DNS.";
  } else if (run.http === 503 || run.failedStep === "config") {
    status = "fail"; who = "config"; detail = run.error;
    action = "Add BUNGIE_API_KEY in Vercel (Settings > Environment Variables) and redeploy.";
  } else if (run.http === 404) {
    status = "fail"; who = "config"; detail = "The refresh function is not deployed (HTTP 404)";
    action = "Redeploy the site so /api/inventory exists.";
  } else if (run.http === 504 || run.http === 500) {
    status = "fail"; who = "config"; detail = `The refresh function crashed or timed out (HTTP ${run.http})`;
    action = "Check the function logs in Vercel.";
  } else {
    status = "fail";
    who = [2101, 2102, 2107, 1601, 1665].includes(run.bungieCode) ? "config" : "vendor";
    detail = `${run.error}${step ? ` (failed at: ${step})` : ""}`;
    action = who === "config" ? "Fix the setting named above, then refresh again." : "Bungie-side problem. Check Bungie and Cloudflare status; retry in a minute.";
  }
  return [check({ id: "inventory_refresh", label: "Last inventory refresh", layer: "api", order: 95, status, http: run.http || null, ms: run.clientMs, detail, who, action })];
}

// ---- Merge + verdict -----------------------------------------------------------------------
export function buildChecks({ health, run, probes, trace }) {
  const all = [...(health?.checks || []), ...browserChecks(probes), ...traceChecks(trace), ...runChecks(run)];
  // A fresh live probe supersedes an older failed refresh for the same fact, so keep both but sorted.
  return all.sort((a, b) => a.order - b.order);
}

export function verdict(checks) {
  const bad = checks.filter((c) => c.status === "fail");
  const warn = checks.filter((c) => c.status === "warn");
  const pool = bad.length ? bad : warn;
  if (!pool.length) {
    const seen = checks.filter((c) => c.status !== "unknown").length;
    return { level: "ok", headline: "All systems green", detail: `${seen} checks passed. The whole path to Bungie is healthy.`, who: "none", action: "", culprit: null, more: 0 };
  }
  // The check nearest the user comes first: it is the most likely root cause.
  const c = pool[0];
  return {
    level: bad.length ? "fail" : "warn",
    headline: `${bad.length ? "Problem" : "Watch"}: ${c.label}`, detail: c.detail,
    who: c.who, action: c.action, culprit: c.id, more: pool.length - 1,
  };
}

// The seven nodes drawn on the map, each summarising one or more checks.
export const NODES = [
  { id: "you",     label: "Your device",        checks: ["device_net"] },
  { id: "local",   label: "VPN / local network", checks: ["vpn", "local_gateway"] },
  { id: "path",    label: "Internet path",      checks: ["dns", "edge_link", "path_trace"] },
  { id: "site",    label: "kgffc.net + API",    checks: ["api", "inventory_refresh"] },
  { id: "cf",      label: "Cloudflare",         checks: ["cloudflare_status", "cloudflare_edge"] },
  { id: "bungie",  label: "Bungie API",         checks: ["bungie_api", "bungie_key", "destiny_data", "bungie_direct"] },
  { id: "oauth",   label: "OAuth",              checks: ["oauth_authorize", "oauth_token"] },
];

export function nodeState(node, checks) {
  const mine = checks.filter((c) => node.checks.includes(c.id));
  if (!mine.length) return { status: "unknown", checks: [] };
  // "Not applicable" checks (e.g. no VPN in use) must not grey out a node whose other checks passed.
  const known = mine.filter((c) => c.status !== "unknown");
  return { status: known.length ? worst(...known.map((c) => c.status)) : "unknown", checks: mine };
}
