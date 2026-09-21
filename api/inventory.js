// GET /api/inventory — read-only Destiny 2 inventory refresh for kgffc.net.
//
// The Bungie API key lives in the BUNGIE_API_KEY environment variable on Vercel and is
// never sent to the browser. The player is fixed (BUNGIE_NAME, default Exu#6179), so this
// endpoint cannot be used to look up anyone else. Successful responses are cached at the
// edge for five minutes so repeated visitor clicks do not hammer Bungie.
//
// Every response (success or failure) carries `telemetry`: the step-by-step trace of this
// refresh (HTTP status + ms per Bungie call, Cloudflare edge code, server region). The
// /status/ dashboard reads it. Item and slot definitions already present in the shipped
// /inventory/snapshot.json are reused; only new ones are looked up.

const { makeClient, BUNGIE_CODES } = require("./_lib/bungie");
const { scrub } = require("./_lib/safe");

const CLASS_NAMES = { 0: "Titan", 1: "Hunter", 2: "Warlock" };
// DestinyComponentType: 100 Profiles, 200 Characters, 205 CharacterEquipment, 300 ItemInstances.
// Only equipped gear is shown, so the (much larger) unequipped inventory is never requested.
const COMPONENTS = "100,200,205,300";
const LOOKUP_BUDGET_MS = 7000;

// Look up manifest entities with limited concurrency, stopping when the time budget is spent.
async function lookup(client, entityType, hashes, deadline) {
  const out = {}, queue = [...hashes];
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (queue.length && Date.now() < deadline) {
      const hash = queue.pop();
      try { out[hash] = await client.call("definitions", `/Destiny2/Manifest/${entityType}/${hash}/`, {}, { quiet: true }); }
      catch { /* counted in the telemetry tally; reported via complete:false */ }
    }
  }));
  return out;
}

module.exports = async (req, res) => {
  const started = Date.now();
  const key = process.env.BUNGIE_API_KEY;
  const client = makeClient(key || "");
  const telemetry = () => scrub({
    steps: client.summary(), colo: client.colo, region: process.env.VERCEL_REGION || null,
    serverMs: Date.now() - started,
  });

  if (!key) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({
      error: "Refresh is not configured yet (BUNGIE_API_KEY is missing).",
      failedStep: "config", reason: "missing_key", telemetry: telemetry(),
    });
  }

  const [name, code] = (process.env.BUNGIE_NAME || "Exu#6179").split("#");
  const deadline = Date.now() + LOOKUP_BUDGET_MS;

  try {
    const found = await client.call("search", "/Destiny2/SearchDestinyPlayerByBungieName/-1/", {
      method: "POST", body: JSON.stringify({ displayName: name, displayNameCode: Number(code) }),
    });
    if (!found.length) throw Object.assign(new Error("Player not found."), { step: "search", bungieCode: 1601 });
    const m = found.find((p) => p.membershipType === p.crossSaveOverride) || found[0];

    const prof = await client.call("profile", `/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${COMPONENTS}`);
    if (!prof.characterEquipment?.data) throw Object.assign(new Error("Inventory is private on Bungie.net."), { step: "profile", bungieCode: 1665 });

    const instances = prof.itemComponents?.instances?.data || {};
    const toItem = (i) => ({
      hash: i.itemHash, id: i.itemInstanceId, qty: i.quantity,
      power: instances[i.itemInstanceId]?.primaryStat?.value, bucket: i.bucketHash,
    });
    const characters = Object.values(prof.characters.data).map((c) => ({
      id: c.characterId, className: CLASS_NAMES[c.classType] || "Guardian", light: c.light,
      equipped: (prof.characterEquipment.data[c.characterId]?.items || []).map(toItem),
    })).sort((a, b) => a.className.localeCompare(b.className));

    // Reuse definitions from the snapshot the site already ships.
    let items = {}, buckets = {};
    try {
      const proto = req.headers["x-forwarded-proto"] || "https";
      const shipped = await (await fetch(`${proto}://${req.headers.host}/inventory/snapshot.json`)).json();
      items = shipped.defs?.items || {}; buckets = shipped.defs?.buckets || {};
    } catch { /* first run: look everything up */ }

    const all = characters.flatMap((c) => c.equipped);
    const needItems = [...new Set(all.map((i) => i.hash))].filter((h) => !items[h]);
    const itemDefs = await lookup(client, "DestinyInventoryItemDefinition", needItems, deadline);
    for (const [h, d] of Object.entries(itemDefs)) {
      items[h] = {
        name: d.displayProperties?.name, icon: d.displayProperties?.icon,
        wm: d.iconWatermark || d.iconWatermarkShelved, tier: d.inventory?.tierType,
        tierName: d.inventory?.tierTypeName, type: d.itemTypeDisplayName, bucket: d.inventory?.bucketTypeHash,
      };
    }
    const needBuckets = [...new Set(all.map((i) => items[i.hash]?.bucket).filter(Boolean))].filter((h) => !buckets[h]);
    const bucketDefs = await lookup(client, "DestinyInventoryBucketDefinition", needBuckets, deadline);
    for (const [h, d] of Object.entries(bucketDefs)) buckets[h] = d.displayProperties?.name;

    const complete = [...new Set(all.map((i) => i.hash))].every((h) => items[h]);
    // Send only the definitions the equipped gear actually uses.
    const usedHashes = new Set(all.map((i) => i.hash));
    const outItems = Object.fromEntries(Object.entries(items).filter(([h]) => usedHashes.has(Number(h))));
    const usedBuckets = new Set(Object.values(outItems).map((d) => d.bucket));
    const outBuckets = Object.fromEntries(Object.entries(buckets).filter(([h]) => usedBuckets.has(Number(h))));
    const t = telemetry();
    res.setHeader("Server-Timing", `total;dur=${t.serverMs}`);
    // Do not cache partial results so the next click can finish the job.
    res.setHeader("Cache-Control", complete ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store");
    return res.status(200).json({
      fetchedAt: Date.now(), player: m.bungieGlobalDisplayName || name, complete,
      characters, defs: { items: outItems, buckets: outBuckets }, telemetry: t,
    });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    const known = BUNGIE_CODES[e.bungieCode];
    return res.status(502).json({
      error: known ? known.why : e.message,
      failedStep: e.step || "unknown", bungieHttp: e.http ?? null,
      bungieStatus: e.bungieStatus || null, bungieCode: e.bungieCode ?? null,
      telemetry: telemetry(),
    });
  }
};
