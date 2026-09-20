// Draws the network as a map: nodes for each stage of the path, links labelled with milliseconds,
// a traceroute ribbon of hops, and a pulsing ring on the node to look at first.
// Only coarse locations are shown (city-level edge codes). No IP addresses or router names.
import { NODES, nodeState } from "./model.js";

const CITY = {
  MIA: "Miami", IAD: "Washington DC", ATL: "Atlanta", DFW: "Dallas", ORD: "Chicago", LAX: "Los Angeles",
  SEA: "Seattle", EWR: "Newark", JFK: "New York", DEN: "Denver", SJC: "San Jose", PHX: "Phoenix",
  BOS: "Boston", MSP: "Minneapolis", YYZ: "Toronto", LHR: "London", FRA: "Frankfurt", CDG: "Paris",
  AMS: "Amsterdam", SIN: "Singapore", NRT: "Tokyo", SYD: "Sydney", GRU: "Sao Paulo", HKG: "Hong Kong",
  iad1: "Washington DC", sfo1: "San Francisco", cle1: "Cleveland", pdx1: "Portland", hnd1: "Tokyo",
  fra1: "Frankfurt", lhr1: "London", sin1: "Singapore", syd1: "Sydney", gru1: "Sao Paulo", cdg1: "Paris",
};
const place = (code) => (code ? `${code.toUpperCase()}${CITY[code] || CITY[code.toLowerCase()] ? " · " + (CITY[code] || CITY[code.toLowerCase()]) : ""}` : "");

const SYMBOL = { ok: "✓", warn: "!", fail: "✕", unknown: "–" };
const POS = {
  you: [70, 150], local: [215, 150], path: [360, 150], site: [505, 150], cf: [650, 150], bungie: [850, 80], oauth: [850, 220],
};
const LINKS = [["you", "local"], ["local", "path"], ["path", "site"], ["site", "cf"], ["cf", "bungie"], ["cf", "oauth"]];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ms = (v) => (v == null ? "" : `${Math.round(v)} ms`);

// The one number shown under / on the link into each node.
function headline(id, s, ctx) {
  const by = (cid) => ctx.checks.find((c) => c.id === cid);
  switch (id) {
    case "local": return ms(by("local_gateway")?.ms);
    case "path": return ms(by("dns")?.ms);
    case "site": return ms(by("edge_link")?.ms);
    case "cf": return ms(by("cloudflare_edge")?.ms);
    case "bungie": return ms(by("bungie_api")?.ms);
    case "oauth": return ms(by("oauth_authorize")?.ms);
    default: return "";
  }
}
function subLabel(id, ctx) {
  const by = (cid) => ctx.checks.find((c) => c.id === cid);
  if (id === "site") return place(ctx.region);
  if (id === "cf") return place(by("cloudflare_edge")?.colo || ctx.colo);
  if (id === "path" && ctx.trace) return `${ctx.trace.hops.length} hops`;
  return "";
}

function hopBand(h) { return h.ms == null ? "unknown" : h.ms >= 100 ? "fail" : h.ms >= 30 ? "warn" : "ok"; }

export function renderMap(el, ctx) {
  const states = Object.fromEntries(NODES.map((n) => [n.id, nodeState(n, ctx.checks)]));

  const links = LINKS.map(([a, b]) => {
    const [x1, y1] = POS[a], [x2, y2] = POS[b];
    const st = [states[a].status, states[b].status];
    const cls = st.includes("fail") ? "fail" : st.includes("warn") ? "warn" : st.every((s) => s === "unknown") ? "unknown" : "ok";
    const label = headline(b, states[b].status, ctx);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `<g class="link ${cls}"><line x1="${x1 + 30}" y1="${y1}" x2="${x2 - 30}" y2="${y2}"/>${label ? `<text class="ms" x="${mx}" y="${my - 12}" text-anchor="middle">${esc(label)}</text>` : ""}</g>`;
  }).join("");

  const nodes = NODES.map((n) => {
    const [x, y] = POS[n.id]; const st = states[n.id].status;
    const sel = ctx.selected === n.id ? " selected" : "";
    const pulse = ctx.verdict?.culprit && states[n.id].checks.some((c) => c.id === ctx.verdict.culprit);
    const sub = subLabel(n.id, ctx);
    return `<g class="node ${st}${sel}" data-node="${n.id}" tabindex="0" role="button" aria-label="${esc(n.label)}: ${st}. Press for details.">
      ${pulse ? `<circle class="pulse" cx="${x}" cy="${y}" r="34"/>` : ""}
      <circle class="ring" cx="${x}" cy="${y}" r="28"/>
      <text class="sym" x="${x}" y="${y + 8}" text-anchor="middle">${SYMBOL[st]}</text>
      <text class="name" x="${x}" y="${y + 52}" text-anchor="middle">${esc(n.label)}</text>
      ${sub ? `<text class="sub" x="${x}" y="${y + 68}" text-anchor="middle">${esc(sub)}</text>` : ""}
    </g>`;
  }).join("");

  // Traceroute ribbon: one dot per hop, coloured by latency.
  let ribbon = "";
  const hops = ctx.trace?.hops || [];
  if (hops.length) {
    const x0 = 150, x1 = 570, y = 315, step = hops.length > 1 ? (x1 - x0) / (hops.length - 1) : 0;
    ribbon = `<g class="ribbon"><text class="cap" x="${x0}" y="${y - 30}">Traceroute from this machine, hop by hop (city-level only, no addresses)</text>
      <line class="rail" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>` +
      hops.map((h, i) => {
        const cx = x0 + step * i;
        return `<g class="hop ${hopBand(h)}"><title>Hop ${h.n} · ${esc(h.label)} · ${h.ms == null ? "no reply" : ms(h.ms)}${h.lossPct ? " · " + h.lossPct + "% loss" : ""}</title>
          <circle cx="${cx}" cy="${y}" r="9"/><text x="${cx}" y="${y + 4}" text-anchor="middle" class="hn">${h.n}</text>
          <text x="${cx}" y="${y + 26}" text-anchor="middle" class="hms">${h.ms == null ? "×" : Math.round(h.ms)}</text></g>`;
      }).join("") + `<text class="cap" x="${x1 + 24}" y="${y + 4}">ms</text></g>`;
  }

  el.innerHTML = `<svg viewBox="0 0 1000 ${hops.length ? 370 : 300}" role="img" aria-label="Network map from your device to Bungie" class="netmap">
    ${links}${ribbon}${nodes}</svg>`;
}

// Mobile / screen-reader friendly version of the same path, as a list.
export function renderPathList(el, ctx) {
  el.innerHTML = NODES.map((n) => {
    const s = nodeState(n, ctx.checks);
    const worstCheck = s.checks.find((c) => c.status === s.status) || s.checks[0];
    return `<li class="${s.status}" data-node="${n.id}" tabindex="0"><span class="dot" aria-hidden="true">${SYMBOL[s.status]}</span>
      <span class="ln"><b>${esc(n.label)}</b><small>${esc(worstCheck?.detail || "Not measured yet")}</small></span>
      <span class="lm">${esc(headline(n.id, s.status, ctx))}</span></li>`;
  }).join("");
}
