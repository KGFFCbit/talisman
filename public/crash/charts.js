// KGFFC Crash Kitchen — small, dependency-free charts.
// In-house on purpose: no third-party code means no requests outside kgffc.net and nothing extra to
// trust with a hostile file. Long recordings stay smooth by drawing one min/max per pixel column.

const SVGNS = "http://www.w3.org/2000/svg";
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
export const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d ?? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)) : "–");

function lowerBound(a, x) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
function nearest(s, t) { const i = lowerBound(s.t, t); if (i <= 0) return 0; if (i >= s.t.length) return s.t.length - 1; return t - s.t[i - 1] < s.t[i] - t ? i - 1 : i; }
function niceStep(span, n) { const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
const T_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600].map((s) => s * 1000);
export function clockText(t, sec) { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: sec ? "2-digit" : undefined }); }

// Shared time window + cursor for every chart and the replay.
export class View {
  constructor() { this.subs = new Set(); this.full = [0, 1]; this.x0 = 0; this.x1 = 1; this.cursor = null; }
  on(f) { this.subs.add(f); }
  emit(why) { for (const f of this.subs) f(why); }
  reset(a, b) { this.full = [a, b]; this.x0 = a; this.x1 = b; this.cursor = b; this.emit("range"); }
  zoom(a, b) { if (b - a < 5000) return; this.x0 = Math.max(this.full[0], a); this.x1 = Math.min(this.full[1], b); this.emit("range"); }
  unzoom() { this.x0 = this.full[0]; this.x1 = this.full[1]; this.emit("range"); }
  point(t) { this.cursor = Math.max(this.full[0], Math.min(this.full[1], t)); this.emit("cursor"); }
}

// spec: { title, unit, lines: [{ label, s: {t,v}, color }], refs: [{ v, label }], marks: [{ t, label, sev }], min, max, digits }
export class TimeChart {
  constructor(host, spec, view) {
    this.host = host; this.spec = spec; this.view = view; this.sel = null;
    host.classList.add("tc");
    const head = el("div", "tc-head");
    head.append(el("h3", null, spec.title));
    this.legend = el("ul", "tc-legend");
    this.vals = spec.lines.map((ln) => {
      const li = el("li"); const sw = el("span", "sw"); sw.style.background = ln.color;
      const v = el("span", "v");
      li.append(sw, el("span", null, ln.label + " "), v);
      this.legend.append(li);
      return v;
    });
    head.append(this.legend);
    const box = el("div", "tc-box");
    this.canvas = el("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", `${spec.title} chart. Drag to zoom, double-click to reset, arrow keys move the time cursor.`);
    this.tip = el("div", "tc-tip"); this.tip.hidden = true;
    box.append(this.canvas, this.tip);
    host.append(head, box);
    for (const ln of spec.lines) { const d = []; for (let i = 1; i < Math.min(ln.s.t.length, 400); i++) d.push(ln.s.t[i] - ln.s.t[i - 1]); d.sort((a, b) => a - b); ln.gap = Math.max(4000, 5 * (d[d.length >> 1] || 1000)); }
    this.bind();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(box);
    view.on(() => this.draw());
  }
  destroy() { this.ro.disconnect(); }

  bind() {
    const c = this.canvas, v = this.view;
    const tAt = (x) => v.x0 + ((x - this.L) / this.pw) * (v.x1 - v.x0);
    const px = (e) => e.clientX - c.getBoundingClientRect().left;
    c.addEventListener("pointerdown", (e) => { if (e.button === 0) { this.sel = { a: px(e), b: px(e) }; c.setPointerCapture(e.pointerId); } });
    c.addEventListener("pointermove", (e) => {
      const x = px(e);
      if (this.sel) { this.sel.b = x; this.draw(); }
      v.point(tAt(x)); this.showTip(x);
    });
    c.addEventListener("pointerup", () => {
      const s = this.sel; this.sel = null;
      if (s && Math.abs(s.b - s.a) > 6) v.zoom(tAt(Math.min(s.a, s.b)), tAt(Math.max(s.a, s.b))); else this.draw();
    });
    c.addEventListener("pointerleave", () => { this.tip.hidden = true; });
    c.addEventListener("dblclick", () => v.unzoom());
    c.addEventListener("keydown", (e) => {
      const step = (v.x1 - v.x0) / 100, t = v.cursor ?? v.x0;
      const k = { ArrowLeft: t - step, ArrowRight: t + step, Home: v.x0, End: v.x1 }[e.key];
      if (k != null) { e.preventDefault(); v.point(k); }
      if (e.key === "Escape") v.unzoom();
    });
  }

  showTip(x) {
    const t = this.view.cursor; if (t == null) return;
    const tip = this.tip; tip.replaceChildren(el("b", null, clockText(t, true)));
    for (const ln of this.spec.lines) { const i = nearest(ln.s, t); tip.append(el("div", null, `${ln.label}: ${fmt(ln.s.v[i], this.spec.digits)} ${this.spec.unit}`)); }
    tip.hidden = false;
    const w = this.canvas.clientWidth;
    tip.style.left = `${Math.min(Math.max(0, x + 12), w - tip.offsetWidth)}px`;
  }

  draw() {
    const c = this.canvas, v = this.view, spec = this.spec;
    const W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(this.host);
    const ink = css.getPropertyValue("--tc-ink").trim(), grid = css.getPropertyValue("--tc-grid").trim(), fail = css.getPropertyValue("--fail").trim(), warn = css.getPropertyValue("--warn").trim();
    const L = (this.L = 48), R = 12, T = 10, B = 22, pw = (this.pw = W - L - R), ph = H - T - B;
    const { x0, x1 } = v;

    let lo = spec.min ?? Infinity, hi = spec.max ?? -Infinity;
    for (const ln of spec.lines) {
      const a = Math.max(0, lowerBound(ln.s.t, x0) - 1), b = Math.min(ln.s.t.length, lowerBound(ln.s.t, x1) + 1);
      for (let i = a; i < b; i++) { const y = ln.s.v[i]; if (Number.isFinite(y)) { if (spec.min == null) lo = Math.min(lo, y); if (spec.max == null) hi = Math.max(hi, y); } }
    }
    for (const r of spec.refs || []) if (r.v >= lo - (hi - lo) * 0.5 && r.v <= hi + (hi - lo) * 0.5) { lo = Math.min(lo, r.v); hi = Math.max(hi, r.v); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = spec.min == null || spec.max == null ? (hi - lo) * 0.08 : 0;
    if (spec.min == null) lo -= pad; if (spec.max == null) hi += pad;
    const X = (t) => L + ((t - x0) / (x1 - x0)) * pw, Y = (y) => T + ph - ((y - lo) / (hi - lo)) * ph;

    ctx.font = "11px 'Geist Mono', ui-monospace, monospace"; ctx.lineWidth = 1;
    const ys = niceStep(hi - lo, 4);
    ctx.fillStyle = ink; ctx.strokeStyle = grid; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    // Tick loops step by index, never by accumulating: a hostile value range can't make them spin forever.
    for (let k = Math.ceil(lo / ys), n = 0; n < 12 && k * ys <= hi; k++, n++) {
      const y = k * ys;
      const py = Math.round(Y(y)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, py); ctx.lineTo(W - R, py); ctx.stroke();
      ctx.fillText(fmt(y, ys < 1 ? 2 : 0), L - 6, py);
    }
    const tsStep = Math.max(T_STEPS.find((s) => (x1 - x0) / s <= Math.max(2, pw / 90)) || 21600000, (x1 - x0) / 12);
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let k = Math.ceil(x0 / tsStep), n = 0; n < 14 && k * tsStep <= x1; k++, n++) { const t = k * tsStep; ctx.fillText(clockText(t, tsStep < 60000), X(t), T + ph + 6); }
    ctx.textAlign = "left"; ctx.fillText(spec.unit, 4, 0);

    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    ctx.setLineDash([4, 4]);
    for (const r of spec.refs || []) {
      const py = Math.round(Y(r.v)) + 0.5; ctx.strokeStyle = fail; ctx.beginPath(); ctx.moveTo(L, py); ctx.lineTo(W - R, py); ctx.stroke();
      ctx.fillStyle = ink; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(r.label, L + 4, py - 2); // left end: the crash label owns the right edge
    }
    for (const m of spec.marks || []) {
      if (m.t < x0 || m.t > x1) continue;
      const px = Math.round(X(m.t)) + 0.5; ctx.strokeStyle = m.sev === "fail" ? fail : warn;
      ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, T + ph); ctx.stroke();
      if (m.label) { ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillText(m.label, px - 4, T + 2); }
    }
    ctx.setLineDash([]);

    ctx.lineWidth = 2; ctx.lineJoin = "round";
    for (const ln of spec.lines) {
      const s = ln.s, a = Math.max(0, lowerBound(s.t, x0) - 1), b = Math.min(s.t.length, lowerBound(s.t, x1) + 1);
      ctx.strokeStyle = ln.color; ctx.beginPath();
      let pen = false, col = null, mn = 0, mx = 0, last = 0, prevT = -Infinity;
      const flush = () => { if (col == null) return; ctx.lineTo(col, Y(mn)); ctx.lineTo(col, Y(mx)); ctx.lineTo(col, Y(last)); };
      for (let i = a; i < b; i++) {
        const y = s.v[i]; if (!Number.isFinite(y)) { pen = false; continue; }
        const px = Math.round(X(s.t[i]));
        if (s.t[i] - prevT > ln.gap) { flush(); col = null; pen = false; }
        prevT = s.t[i];
        if (!pen) { ctx.moveTo(px, Y(y)); pen = true; col = px; mn = mx = last = y; continue; }
        if (px === col) { mn = Math.min(mn, y); mx = Math.max(mx, y); last = y; }
        else { flush(); col = px; mn = mx = last = y; ctx.lineTo(px, Y(y)); }
      }
      flush(); ctx.stroke();
    }
    if (this.sel) { ctx.fillStyle = grid; ctx.globalAlpha = 0.5; ctx.fillRect(Math.min(this.sel.a, this.sel.b), T, Math.abs(this.sel.b - this.sel.a), ph); ctx.globalAlpha = 1; }
    const t = v.cursor;
    if (t != null && t >= x0 && t <= x1) {
      const px = Math.round(X(t)) + 0.5; ctx.strokeStyle = ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, T + ph); ctx.stroke();
      for (const ln of spec.lines) {
        const i = nearest(ln.s, t); if (Math.abs(ln.s.t[i] - t) > ln.gap) continue;
        ctx.fillStyle = ln.color; ctx.strokeStyle = css.getPropertyValue("--lacquer").trim(); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(ln.s.t[i]), Y(ln.s.v[i]), 4, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
    spec.lines.forEach((ln, k) => { const i = t == null ? -1 : nearest(ln.s, t); this.vals[k].textContent = i >= 0 ? `${fmt(ln.s.v[i], spec.digits)} ${spec.unit}` : ""; });
  }
}

// Semicircle gauge for the replay. Status is shown by colour AND the word under the number.
export class Gauge {
  constructor(host, { label, unit, min, max, warn, fail, low }) {
    Object.assign(this, { min, max, warn, fail, low, unit });
    const wrap = el("figure", "gauge");
    const s = svg("svg", { viewBox: "0 0 120 70", "aria-hidden": "true" });
    const d = "M10 62 A 50 50 0 0 1 110 62";
    s.append(svg("path", { d, class: "g-track", pathLength: "100" }));
    this.arc = svg("path", { d, class: "g-arc", pathLength: "100", "stroke-dasharray": "0 100" });
    s.append(this.arc);
    this.num = el("div", "g-num", "–"); this.state = el("div", "g-state", "");
    wrap.append(s, this.num, this.state, el("figcaption", null, label));
    host.append(wrap); this.wrap = wrap;
  }
  set(v) {
    if (!Number.isFinite(v)) { this.num.textContent = "–"; this.state.textContent = "no data"; this.wrap.dataset.s = ""; this.arc.setAttribute("stroke-dasharray", "0 100"); return; }
    const p = Math.max(0, Math.min(100, (100 * (v - this.min)) / (this.max - this.min)));
    this.arc.setAttribute("stroke-dasharray", `${p} 100`);
    this.num.textContent = `${fmt(v, this.unit === "V" ? 2 : 0)} ${this.unit}`;
    let s = "ok";
    if (this.low) s = v < this.fail ? "fail" : v < this.warn ? "warn" : "ok";
    else s = v >= this.fail ? "fail" : v >= this.warn ? "warn" : "ok";
    this.wrap.dataset.s = s; this.state.textContent = { ok: "fine", warn: "high", fail: "danger" }[s];
    if (this.low && s !== "ok") this.state.textContent = s === "fail" ? "too low" : "low";
  }
}

// The Crisp-o-Meter dial: seven cooked levels, a needle at the score.
export function meter(host, score, level, names) {
  const s = svg("svg", { viewBox: "0 0 240 140", class: "meter", "aria-hidden": "true" });
  const cx = 120, cy = 120, r = 96, gap = 1.6;
  for (let i = 0; i < 7; i++) {
    const a0 = Math.PI + (i * Math.PI) / 7 + (gap * Math.PI) / 180, a1 = Math.PI + ((i + 1) * Math.PI) / 7 - (gap * Math.PI) / 180;
    const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    s.append(svg("path", { d: `M${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`, class: `seg lv${i}${i === level ? " on" : ""}` }));
    const am = (a0 + a1) / 2;
    const tx = svg("text", { x: (cx + (r - 30) * Math.cos(am)).toFixed(1), y: (cy + (r - 30) * Math.sin(am) + 4).toFixed(1), class: `segn${i === level ? " on" : ""}` });
    tx.textContent = String(i + 1); s.append(tx);
  }
  const ang = -90 + (Math.min(100, Math.max(0, score)) / 100) * 180;
  const needle = svg("g", { class: "needle" });
  needle.style.transform = `rotate(${ang}deg)`; // CSSOM, not a style attribute: allowed by the page's CSP
  needle.append(svg("path", { d: `M${cx - 5} ${cy} L${cx} ${cy - r + 46} L${cx + 5} ${cy} Z` }), svg("circle", { cx, cy, r: 9 }));
  s.append(needle);
  host.replaceChildren(s);
  return s;
}
