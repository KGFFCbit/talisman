// GET /api/inventory — read-only Destiny 2 inventory refresh for kgffc.net.
//
// The Bungie API key lives in the BUNGIE_API_KEY environment variable on Vercel and is
// never sent to the browser. The player is fixed (BUNGIE_NAME, default Exu#6179), so this
// endpoint cannot be used to look up anyone else. Responses are cached at the edge for
// five minutes so repeated visitor clicks do not hammer Bungie.
//
// Item and slot definitions already present in the shipped /inventory/snapshot.json are
// reused; only new ones are looked up from Bungie's manifest.

const BUNGIE = "https://www.bungie.net/Platform";
const CLASS_NAMES = { 0: "Titan", 1: "Hunter", 2: "Warlock" };
// DestinyComponentType: 100 Profiles, 200 Characters, 201 CharacterInventories,
// 205 CharacterEquipment, 300 ItemInstances
const COMPONENTS = "100,200,201,205,300";
const LOOKUP_BUDGET_MS = 7000;

async function bungie(path, key, init = {}) {
  const res = await fetch(BUNGIE + path, {
    ...init,
    headers: { "X-API-Key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const json = await res.json();
  if (json.ErrorCode !== 1) throw new Error(json.Message || `Bungie error ${json.ErrorCode}`);
  return json.Response;
}

// Look up manifest entities with limited concurrency, stopping when the time budget is spent.
async function lookup(entityType, hashes, key, deadline) {
  const out = {}, queue = [...hashes];
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (queue.length && Date.now() < deadline) {
      const hash = queue.pop();
      try { out[hash] = await bungie(`/Destiny2/Manifest/${entityType}/${hash}/`, key); }
      catch { /* leave undefined; reported via complete:false */ }
    }
  }));
  return out;
}

module.exports = async (req, res) => {
  const key = process.env.BUNGIE_API_KEY;
  if (!key) return res.status(503).json({ error: "Refresh is not configured yet (BUNGIE_API_KEY is missing)." });

  const [name, code] = (process.env.BUNGIE_NAME || "Exu#6179").split("#");
  const deadline = Date.now() + LOOKUP_BUDGET_MS;

  try {
    const found = await bungie("/Destiny2/SearchDestinyPlayerByBungieName/-1/", key, {
      method: "POST", body: JSON.stringify({ displayName: name, displayNameCode: Number(code) }),
    });
    if (!found.length) throw new Error("Player not found.");
    const m = found.find((p) => p.membershipType === p.crossSaveOverride) || found[0];

    const prof = await bungie(
      `/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${COMPONENTS}`, key);
    if (!prof.characterEquipment?.data) throw new Error("Inventory is private on Bungie.net.");

    const instances = prof.itemComponents?.instances?.data || {};
    const toItem = (i) => ({
      hash: i.itemHash, id: i.itemInstanceId, qty: i.quantity,
      power: instances[i.itemInstanceId]?.primaryStat?.value, bucket: i.bucketHash,
    });
    const characters = Object.values(prof.characters.data).map((c) => ({
      id: c.characterId, className: CLASS_NAMES[c.classType] || "Guardian", light: c.light,
      equipped: (prof.characterEquipment.data[c.characterId]?.items || []).map(toItem),
      inventory: (prof.characterInventories?.data?.[c.characterId]?.items || []).map(toItem),
    })).sort((a, b) => a.className.localeCompare(b.className));

    // Reuse definitions from the snapshot the site already ships.
    let items = {}, buckets = {};
    try {
      const proto = req.headers["x-forwarded-proto"] || "https";
      const shipped = await (await fetch(`${proto}://${req.headers.host}/inventory/snapshot.json`)).json();
      items = shipped.defs?.items || {}; buckets = shipped.defs?.buckets || {};
    } catch { /* first run: look everything up */ }

    const all = characters.flatMap((c) => [...c.equipped, ...c.inventory]);
    const needItems = [...new Set(all.map((i) => i.hash))].filter((h) => !items[h]);
    const itemDefs = await lookup("DestinyInventoryItemDefinition", needItems, key, deadline);
    for (const [h, d] of Object.entries(itemDefs)) {
      items[h] = {
        name: d.displayProperties?.name, icon: d.displayProperties?.icon,
        wm: d.iconWatermark || d.iconWatermarkShelved, tier: d.inventory?.tierType,
        tierName: d.inventory?.tierTypeName, type: d.itemTypeDisplayName, bucket: d.inventory?.bucketTypeHash,
      };
    }
    const needBuckets = [...new Set(all.map((i) => items[i.hash]?.bucket).filter(Boolean))].filter((h) => !buckets[h]);
    const bucketDefs = await lookup("DestinyInventoryBucketDefinition", needBuckets, key, deadline);
    for (const [h, d] of Object.entries(bucketDefs)) buckets[h] = d.displayProperties?.name;

    const complete = [...new Set(all.map((i) => i.hash))].every((h) => items[h]);
    // Do not cache partial results so the next click can finish the job.
    res.setHeader("Cache-Control", complete ? "public, s-maxage=300, stale-while-revalidate=600" : "no-store");
    return res.status(200).json({
      fetchedAt: Date.now(), player: m.bungieGlobalDisplayName || name, complete,
      characters, defs: { items, buckets },
    });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: e.message });
  }
};
