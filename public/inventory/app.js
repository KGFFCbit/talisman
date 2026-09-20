// GlutenFreeInventory - read-only Destiny 2 inventory viewer.
// Talks to Bungie only when the Refresh button is pressed; otherwise renders
// the last saved snapshot from localStorage.
import { getProfile, searchDestinyPlayerByBungieName, getDestinyEntityDefinition }
  from "https://cdn.jsdelivr.net/npm/bungie-api-ts@5.10.0/destiny2/api.js";
import { CONFIG } from "./config.js";

const BUNGIE = "https://www.bungie.net";
const SNAP_KEY = "gfi.snapshot", KEY_KEY = "gfi.apiKey", NAME_KEY = "gfi.bungieName";
// DestinyComponentType: 100 Profiles, 200 Characters, 201 CharacterInventories,
// 205 CharacterEquipment, 300 ItemInstances
const COMPONENTS = [100, 200, 201, 205, 300];
const CLASS_NAMES = { 0: "Titan", 1: "Hunter", 2: "Warlock" };
// Display order for equipped slots (DIM-style: weapons, armor, then the rest)
const SLOT_ORDER = [1498876634, 2465295065, 953998645, 3448274439, 3551918588,
  14239492, 20886954, 1585787867, 4023194814, 2025709351, 284967655, 3284755031, 4274335291];

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const setStatus = (msg, err = false) => { const s = $("status"); s.textContent = msg; s.className = err ? "err" : ""; };
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// bungie-api-ts HttpClient: adds the API key and returns parsed JSON.
const makeHttp = (apiKey) => async ({ method, url, params, body }) => {
  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => v !== undefined && u.searchParams.set(k, v));
  const res = await fetch(u, {
    method,
    headers: { "X-API-Key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json.ErrorCode && json.ErrorCode !== 1)) {
    throw new Error(json.Message || `Bungie API error ${res.status}`);
  }
  return json;
};

// Fetch many manifest entities with limited concurrency.
async function fetchDefs(http, entityType, hashes) {
  const out = {}, queue = [...hashes];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const hashIdentifier = queue.pop();
      try { out[hashIdentifier] = (await getDestinyEntityDefinition(http, { entityType, hashIdentifier })).Response; }
      catch (e) { console.warn("definition failed", entityType, hashIdentifier, e.message); }
    }
  }));
  return out;
}

async function refresh() {
  const apiKey = $("apiKey").value.trim() || CONFIG.apiKey;
  const name = $("bungieName").value.trim();
  if (!apiKey) return setStatus("Enter your Bungie API key.", true);
  const hash = name.lastIndexOf("#");
  if (hash < 1) return setStatus("Bungie Name must look like Name#1234.", true);
  store.set(KEY_KEY, apiKey); store.set(NAME_KEY, name);

  $("refresh").disabled = true;
  try {
    const http = makeHttp(apiKey);
    setStatus("Finding player...");
    const found = (await searchDestinyPlayerByBungieName(http, { membershipType: -1 },
      { displayName: name.slice(0, hash), displayNameCode: Number(name.slice(hash + 1)) })).Response;
    if (!found.length) throw new Error("No Destiny 2 player found for that Bungie Name.");
    const m = found.find((p) => p.membershipType === p.crossSaveOverride) || found[0];

    setStatus("Reading inventory...");
    const prof = (await getProfile(http, {
      destinyMembershipId: m.membershipId, membershipType: m.membershipType, components: COMPONENTS,
    })).Response;
    if (!prof.characterEquipment?.data) {
      throw new Error("Inventory is private. Enable the inventory/equipment visibility options in Bungie.net privacy settings.");
    }

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

    // Reuse definitions from the previous snapshot; only fetch what is new.
    const prev = loadSnapshot();
    const items = { ...(prev?.defs?.items || {}) }, buckets = { ...(prev?.defs?.buckets || {}) };
    const allItems = characters.flatMap((c) => [...c.equipped, ...c.inventory]);
    const needItems = [...new Set(allItems.map((i) => i.hash))].filter((h) => !items[h]);
    setStatus(`Loading ${needItems.length} item definitions...`);
    const itemDefs = await fetchDefs(http, "DestinyInventoryItemDefinition", needItems);
    for (const [h, d] of Object.entries(itemDefs)) {
      items[h] = {
        name: d.displayProperties?.name, icon: d.displayProperties?.icon,
        wm: d.iconWatermark || d.iconWatermarkShelved, tier: d.inventory?.tierType,
        tierName: d.inventory?.tierTypeName, type: d.itemTypeDisplayName, bucket: d.inventory?.bucketTypeHash,
      };
    }
    const needBuckets = [...new Set(allItems.map((i) => items[i.hash]?.bucket).filter(Boolean))].filter((h) => !buckets[h]);
    const bucketDefs = await fetchDefs(http, "DestinyInventoryBucketDefinition", needBuckets);
    for (const [h, d] of Object.entries(bucketDefs)) buckets[h] = d.displayProperties?.name;

    saveSnapshot({ fetchedAt: Date.now(), player: m.bungieGlobalDisplayName || name, characters, defs: { items, buckets } });
    setStatus(`Updated ${new Date().toLocaleString()}`);
    render();
  } catch (e) { console.error(e); setStatus(e.message, true); }
  finally { $("refresh").disabled = false; }
}

function loadSnapshot() { try { return JSON.parse(store.get(SNAP_KEY)); } catch { return null; } }
function saveSnapshot(s) { store.set(SNAP_KEY, JSON.stringify(s)); }

function itemHtml(it, defs) {
  const d = defs.items[it.hash]; if (!d) return "";
  // Power only means something on weapons and armor (first 8 slots in SLOT_ORDER).
  const isGear = SLOT_ORDER.indexOf(it.bucket) >= 0 && SLOT_ORDER.indexOf(it.bucket) < 8;
  const badge = isGear && it.power ? `<span class="pl">${it.power}</span>` : it.qty > 1 ? `<span class="qty">${it.qty}</span>` : "";
  return `<div class="item t${d.tier ?? 0}" tabindex="0">
    ${d.icon ? `<img src="${BUNGIE}${esc(d.icon)}" alt="${esc(d.name)}" loading="lazy">` : ""}
    ${d.wm ? `<img class="wm" src="${BUNGIE}${esc(d.wm)}" alt="" loading="lazy">` : ""}${badge}
    <div class="tip"><b>${esc(d.name)}</b><br>${esc(d.tierName)} ${esc(d.type)}${it.power ? `<br>Power ${it.power}` : ""}</div></div>`;
}

let activeChar = null;
function render() {
  const snap = loadSnapshot(); if (!snap) return;
  const chars = snap.characters;
  if (!chars.some((c) => c.id === activeChar)) activeChar = chars[0]?.id;
  $("tabs").innerHTML = chars.map((c) =>
    `<button role="tab" data-id="${c.id}" aria-selected="${c.id === activeChar}">${esc(c.className)} &middot; ${c.light}</button>`).join("");
  const c = chars.find((x) => x.id === activeChar);
  const { defs } = snap;
  const rank = (b) => { const i = SLOT_ORDER.indexOf(b); return i < 0 ? SLOT_ORDER.length : i; };
  const equipped = [...c.equipped].sort((a, b) => rank(a.bucket) - rank(b.bucket));
  const groups = {};
  for (const it of c.inventory) (groups[defs.buckets[defs.items[it.hash]?.bucket] || "Other"] ||= []).push(it);
  $("inventory").innerHTML =
    `<p class="empty">${esc(snap.player)} &middot; snapshot from ${new Date(snap.fetchedAt).toLocaleString()}</p>
     <h2>Equipped</h2><div class="grid equipped">${equipped.map((i) => itemHtml(i, defs)).join("")}</div>` +
    Object.entries(groups).sort().map(([g, list]) =>
      `<h2>${esc(g)}</h2><div class="grid">${list.map((i) => itemHtml(i, defs)).join("")}</div>`).join("");
}

$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) { activeChar = b.dataset.id; render(); } });
$("refresh").addEventListener("click", refresh);
$("bungieName").value = store.get(NAME_KEY) || CONFIG.bungieName;
$("apiKey").value = store.get(KEY_KEY) || "";

// The site ships a snapshot (snapshot.json) so every visitor sees the guardian with no
// key and no Bungie call. A newer owner refresh, kept in localStorage, takes precedence.
async function loadShipped() {
  try {
    const res = await fetch("snapshot.json", { cache: "no-cache" });
    if (!res.ok) return;
    const shipped = await res.json();
    const local = loadSnapshot();
    if (!local || shipped.fetchedAt > local.fetchedAt) saveSnapshot(shipped);
  } catch { /* offline or missing: fall back to whatever is stored */ }
}
render();
loadShipped().then(() => {
  render();
  if (!loadSnapshot()) $("inventory").innerHTML = '<p class="empty">No snapshot available yet.</p>';
});
