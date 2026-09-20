// Privacy guard. Nothing that leaves the backend may contain an IP address or a router/host name.
// Only free-text fields are scrubbed (never timestamps, which contain colons).
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{0,4}\b/gi;
const TEXT_KEYS = new Set(["detail", "error", "message", "action", "label", "note"]);

const scrubText = (s) => String(s).replace(IPV4, "[ip]").replace(IPV6, "[ip]");

function scrub(value, key) {
  if (typeof value === "string") return TEXT_KEYS.has(key) ? scrubText(value) : value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  return value;
}

// Cloudflare adds "CF-RAY: <id>-<COLO>". Only the 3-letter city code is kept.
const coloFrom = (headers) => {
  const ray = headers?.get?.("cf-ray") || "";
  const m = ray.match(/-([A-Z]{3})$/);
  return m ? m[1] : null;
};

module.exports = { scrub, scrubText, coloFrom };
