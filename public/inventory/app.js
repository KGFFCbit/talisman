// GlutenFreeInventory - read-only Destiny 2 inventory viewer.
// The site ships a snapshot (snapshot.json) so every visitor sees the guardian immediately.
// The Refresh button asks /api/inventory (which holds the Bungie key privately) for fresh data.
const BUNGIE = "https://www.bungie.net";
const SNAP_KEY = "gfi.snapshot";
// Display order for equipped slots (DIM-style: weapons, armor, then the rest)
const SLOT_ORDER = [1498876634, 2465295065, 953998645, 3448274439, 3551918588,
  14239492, 20886954, 1585787867, 4023194814, 2025709351, 284967655, 3284755031, 4274335291];

// Slots we don't show: Vehicle (sparrows), Ghost, Ships, Emotes, Finishers, Emblems.
const HIDDEN_BUCKETS = new Set([2025709351, 4023194814, 284967655, 1107761855, 3683254069, 4274335291]);

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const setStatus = (msg, err = false) => { const s = $("status"); s.textContent = msg; s.className = err ? "err" : ""; };
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

function loadSnapshot() { try { return JSON.parse(store.get(SNAP_KEY)); } catch { return null; } }
function saveSnapshot(s) { store.set(SNAP_KEY, JSON.stringify(s)); }

async function refresh() {
  $("refresh").disabled = true;
  try {
    setStatus("Asking Bungie for the latest inventory...");
    const res = await fetch("/api/inventory");
    const fresh = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(fresh.error || `Refresh failed (${res.status}).`);
    // Keep definitions we already know about so a partial lookup never loses icons.
    const prev = loadSnapshot();
    fresh.defs.items = { ...(prev?.defs?.items || {}), ...fresh.defs.items };
    fresh.defs.buckets = { ...(prev?.defs?.buckets || {}), ...fresh.defs.buckets };
    saveSnapshot(fresh);
    setStatus(fresh.complete ? "Updated just now." : "Updated (a few item icons are still loading; refresh again).");
    render();
  } catch (e) { console.error(e); setStatus(e.message, true); }
  finally { $("refresh").disabled = false; }
}

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
  const shown = (it) => !HIDDEN_BUCKETS.has(it.bucket);
  const equipped = c.equipped.filter(shown).sort((a, b) => rank(a.bucket) - rank(b.bucket));
  const groups = {};
  for (const it of c.inventory.filter(shown)) (groups[defs.buckets[defs.items[it.hash]?.bucket] || "Other"] ||= []).push(it);
  $("inventory").innerHTML =
    `<p class="empty">${esc(snap.player)} &middot; snapshot from ${new Date(snap.fetchedAt).toLocaleString()}</p>
     <h2>Equipped</h2><div class="grid equipped">${equipped.map((i) => itemHtml(i, defs)).join("")}</div>` +
    Object.entries(groups).sort().map(([g, list]) =>
      `<h2>${esc(g)}</h2><div class="grid">${list.map((i) => itemHtml(i, defs)).join("")}</div>`).join("");
}

$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-id]"); if (b) { activeChar = b.dataset.id; render(); } });
$("refresh").addEventListener("click", refresh);

// Use the shipped snapshot unless this browser already holds a newer refresh.
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
