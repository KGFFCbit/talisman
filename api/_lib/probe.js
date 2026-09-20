// Timed HTTP probe used by the health checks. Never returns bodies wholesale, IPs or hosts.
const { coloFrom } = require("./safe");

async function probe(url, { method = "GET", headers = {}, body, timeout = 6000, readBody = false } = {}) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal, redirect: "manual" });
    const ttfb = Date.now() - t0;
    let text = null;
    if (readBody) text = await res.text();
    else { try { await res.body?.cancel(); } catch { /* ignore */ } }
    return {
      reached: true, http: res.status, ttfb, ms: Date.now() - t0, text,
      colo: coloFrom(res.headers), server: res.headers.get("server") || null,
    };
  } catch (e) {
    const code = e.name === "AbortError" ? "timeout" : (e.cause?.code || e.name || "error");
    return { reached: false, http: 0, ms: Date.now() - t0, error: code };
  } finally { clearTimeout(timer); }
}

// Map an HTTP status to a traffic-light state. 3xx counts as healthy for redirect-style checks.
const stateFor = (http, { okCodes = [200], warnCodes = [] } = {}) =>
  okCodes.includes(http) ? "ok" : warnCodes.includes(http) ? "warn" : "fail";

const slow = (ms, warnAt = 1500, failAt = 4000) => (ms >= failAt ? "fail" : ms >= warnAt ? "warn" : "ok");
const worst = (...s) => (s.includes("fail") ? "fail" : s.includes("warn") ? "warn" : s.includes("unknown") ? "unknown" : "ok");

module.exports = { probe, stateFor, slow, worst };
