// GET /api/health — server-side probes for the KGFFC network dashboard (/status/).
// Reports green / amber / red for Cloudflare, Bungie, OAuth and this app's own API.
// Every check carries its own plain-English owner ("who") and fix ("action") so the
// dashboard can name the problem in seconds. No IPs, router or host names ever leave here.
//
//   ?ping=1   fast liveness check (used by the browser to time its own path to this site)
//
// who: parts = local hardware/cabling, network = ISP/VPN, vendor = Cloudflare/Bungie, config = our settings

const { probe, stateFor, slow } = require("./_lib/probe");
const { BUNGIE_CODES, BASE } = require("./_lib/bungie");
const { scrub } = require("./_lib/safe");

const CLIENT_ID = process.env.BUNGIE_CLIENT_ID || "54982";
const check = (o) => ({ http: null, ms: null, detail: "", who: "none", action: "", ...o });

function bungieVerdict(r, json) {
  if (!r.reached) return { status: "fail", detail: `Cannot reach Bungie (${r.error})`, who: "vendor", action: "Check status.bungie.net. If Bungie is up, retry in a minute." };
  if (r.http >= 500) return { status: "fail", detail: `Bungie returned HTTP ${r.http}`, who: "vendor", action: "Bungie-side outage. Nothing to fix locally; wait or escalate to Bungie." };
  if (r.http === 429) return { status: "warn", detail: "Rate limited (HTTP 429)", who: "vendor", action: "Too many requests. Wait a minute; the refresh button is cached for 5 minutes." };
  if (json?.ErrorCode === 1) return { status: "ok", detail: "Responding normally" };
  const known = BUNGIE_CODES[json?.ErrorCode];
  if (known) return { status: "fail", detail: `${known.why} (Bungie ${json.ErrorStatus})`, who: known.who };
  return { status: "fail", detail: `Unexpected reply: HTTP ${r.http}${json?.ErrorStatus ? ` / ${json.ErrorStatus}` : ""}`, who: "vendor" };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.searchParams.get("ping")) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, region: process.env.VERCEL_REGION || null, at: Date.now() });
  }

  const t0 = Date.now();
  const key = process.env.BUNGIE_API_KEY;
  const [name, code] = (process.env.BUNGIE_NAME || "Exu#6179").split("#");
  const H = key ? { "X-API-Key": key } : {};

  const [cf, man, authz, tok, who] = await Promise.all([
    probe("https://www.cloudflarestatus.com/api/v2/status.json", { readBody: true }),
    probe(`${BASE}/Destiny2/Manifest/`, { headers: H, readBody: true }),
    probe(`https://www.bungie.net/en/OAuth/Authorize?client_id=${CLIENT_ID}&response_type=code`),
    probe(`${BASE}/App/OAuth/token/`, {
      method: "POST", readBody: true,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=authorization_code&code=invalid&client_id=${CLIENT_ID}`,
    }),
    key ? probe(`${BASE}/Destiny2/SearchDestinyPlayerByBungieName/-1/`, {
      method: "POST", readBody: true, headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name, displayNameCode: Number(code) }),
    }) : Promise.resolve(null),
  ]);

  const checks = [];

  // Cloudflare's own public status feed.
  {
    let ind = null, desc = "";
    try { const j = JSON.parse(cf.text); ind = j.status?.indicator; desc = j.status?.description; } catch { /* unreadable */ }
    const status = !cf.reached || cf.http !== 200 ? "unknown" : ind === "none" ? "ok" : ind === "minor" ? "warn" : "fail";
    checks.push(check({
      id: "cloudflare_status", label: "Cloudflare platform status", layer: "cloudflare", order: 50,
      status, http: cf.http || null, ms: cf.ms,
      detail: status === "unknown" ? "Could not read Cloudflare's status feed" : `Cloudflare reports: ${desc}`,
      who: status === "ok" || status === "unknown" ? "none" : "vendor",
      action: status === "ok" || status === "unknown" ? "" : "Cloudflare incident. Not fixable locally: note it, check cloudflarestatus.com, escalate if it persists.",
    }));
  }

  // The Cloudflare edge that serves Bungie (city code only).
  checks.push(check({
    id: "cloudflare_edge", label: "Cloudflare edge for Bungie", layer: "cloudflare", order: 55,
    status: !man.reached ? "fail" : man.server?.toLowerCase().includes("cloudflare") ? slow(man.ttfb, 800, 2500) : "warn",
    http: man.http || null, ms: man.ttfb ?? man.ms,
    detail: man.colo ? `Served from Cloudflare edge ${man.colo}` : man.reached ? "Reached Bungie (edge not identified)" : `Cannot reach the edge (${man.error})`,
    who: man.reached ? "none" : "vendor",
    action: man.reached ? "" : "The edge did not answer. Check Cloudflare status; if green, suspect the network path.",
    colo: man.colo || null,
  }));

  // Bungie Platform API + the API key.
  // The manifest endpoint does not validate the key, so it only proves Bungie is answering.
  // The key itself is judged from the player lookup, which does require it.
  let manJson = null, whoJson = null;
  try { manJson = JSON.parse(man.text); } catch { /* not JSON */ }
  try { whoJson = JSON.parse(who?.text); } catch { /* not JSON */ }
  const bv = bungieVerdict(man, manJson);
  const keyProblem = !key || [2101, 2102, 2107].includes(whoJson?.ErrorCode);
  checks.push(check({
    id: "bungie_api", label: "Bungie Platform API", layer: "bungie", order: 70,
    status: bv.status, http: man.http || null, ms: man.ms,
    detail: bv.detail, who: bv.who || "none", action: bv.action || "",
  }));
  checks.push(check({
    id: "bungie_key", label: "Bungie API key", layer: "bungie", order: 75,
    status: keyProblem ? "fail" : who && !who.reached ? "unknown" : "ok", http: who?.http || null, ms: null,
    detail: !key ? "BUNGIE_API_KEY is not set on the server"
      : keyProblem ? `Bungie rejected the key (${whoJson?.ErrorStatus})` : "Key accepted",
    who: keyProblem ? "config" : "none",
    action: !key ? "Vercel > talisman > Settings > Environment Variables: add BUNGIE_API_KEY, then Redeploy."
      : whoJson?.ErrorCode === 2107 ? "The key is locked to another site. Set Origin Header to https://kgffc.net at bungie.net/en/Application (app 59477)."
      : keyProblem ? "Replace BUNGIE_API_KEY on Vercel with the key from bungie.net/en/Application (app 59477), then Redeploy." : "",
  }));

  // OAuth: login page + token endpoint.
  checks.push(check({
    id: "oauth_authorize", label: "OAuth sign-in page", layer: "oauth", order: 80,
    status: !authz.reached ? "fail" : [200, 302].includes(authz.http) ? slow(authz.ms) : "fail",
    http: authz.http || null, ms: authz.ms,
    detail: !authz.reached ? `Cannot reach Bungie sign-in (${authz.error})`
      : [200, 302].includes(authz.http) ? `Sign-in page answers (HTTP ${authz.http})` : `Sign-in page returned HTTP ${authz.http}`,
    who: authz.reached && [200, 302].includes(authz.http) ? "none" : "vendor",
    action: authz.reached && [200, 302].includes(authz.http) ? "" : "Bungie sign-in is down or the client ID changed. Check the app at bungie.net/en/Application.",
  }));
  {
    // A bad code SHOULD be refused with 400/401. That proves the token service is alive.
    const alive = tok.reached && [400, 401].includes(tok.http);
    checks.push(check({
      id: "oauth_token", label: "OAuth token service", layer: "oauth", order: 85,
      status: alive ? slow(tok.ms) : "fail", http: tok.http || null, ms: tok.ms,
      detail: alive ? `Token service refuses a bad code, as it should (HTTP ${tok.http})`
        : tok.reached ? `Unexpected token reply: HTTP ${tok.http}` : `Cannot reach token service (${tok.error})`,
      who: alive ? "none" : "vendor",
      action: alive ? "" : "Bungie's token service is not behaving. Vendor-side; retry, then escalate.",
    }));
  }

  // The player: does Bungie know them, and is the inventory public?
  if (who && keyProblem) {
    checks.push(check({
      id: "destiny_data", label: "Destiny 2 guardian lookup", layer: "bungie", order: 90,
      status: "unknown", detail: "Not tested: the API key was rejected", who: "none",
    }));
  } else if (who) {
    const list = whoJson?.Response;
    const found = Array.isArray(list) && list.length > 0;
    const isPublic = found && list.every((p) => p.isPublic !== false);
    checks.push(check({
      id: "destiny_data", label: "Destiny 2 guardian lookup", layer: "bungie", order: 90,
      status: !who.reached || who.http >= 500 ? "fail" : !found ? "fail" : isPublic ? "ok" : "warn",
      http: who.http || null, ms: who.ms,
      detail: !who.reached ? `Lookup did not complete (${who.error})` : !found ? "Guardian not found" : isPublic ? "Guardian found, inventory public" : "Guardian found but the profile is private",
      who: found && isPublic ? "none" : !who.reached || who.http >= 500 ? "vendor" : "config",
      action: found && isPublic ? "" : !found ? "Check the Bungie Name (BUNGIE_NAME on Vercel)." : "Bungie.net > Settings > Privacy: make inventory visible.",
    }));
  }

  // This function running at all proves the site's API layer is up.
  checks.push(check({
    id: "api", label: "KGFFC API function", layer: "api", order: 40,
    status: "ok", http: 200, ms: Date.now() - t0,
    detail: `Function healthy${process.env.VERCEL_REGION ? ` (region ${process.env.VERCEL_REGION})` : ""}`,
  }));

  res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");
  return res.status(200).json(scrub({
    generatedAt: Date.now(), region: process.env.VERCEL_REGION || null,
    checks: checks.sort((a, b) => a.order - b.order),
  }));
};
