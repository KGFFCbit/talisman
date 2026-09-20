// HTTP status code reference for support engineers: what the number means in plain English and
// whose problem it usually is. Codes seen in the latest checks are highlighted.
// who: client = the caller / browser, network = path in between, server = the site, vendor = Cloudflare/Bungie
export const CODES = [
  [100, "Continue", "Server got the request headers and wants the rest.", "network"],
  [101, "Switching Protocols", "Connection is upgrading (for example to WebSocket).", "network"],
  [200, "OK", "It worked.", "none"],
  [201, "Created", "Something new was created.", "none"],
  [204, "No Content", "It worked and there is nothing to send back.", "none"],
  [206, "Partial Content", "Only part of the file was sent (resumed or ranged download).", "none"],
  [301, "Moved Permanently", "The address changed for good; follow the new one.", "server"],
  [302, "Found (redirect)", "Temporary redirect. Bungie's sign-in page answers this when healthy.", "none"],
  [304, "Not Modified", "Your cached copy is still current.", "none"],
  [307, "Temporary Redirect", "Redirect that keeps the request method.", "server"],
  [308, "Permanent Redirect", "Permanent redirect that keeps the request method.", "server"],
  [400, "Bad Request", "The request was malformed. A healthy token service answers this to a bad OAuth code.", "client"],
  [401, "Unauthorized", "Missing or wrong credentials (key, token or login).", "client"],
  [403, "Forbidden", "Credentials are fine but access is refused (firewall, origin lock, permission).", "client"],
  [404, "Not Found", "Nothing lives at that address. On our site this means the page or function is not deployed.", "server"],
  [405, "Method Not Allowed", "Wrong verb (for example GET where POST is required).", "client"],
  [408, "Request Timeout", "The server gave up waiting for the request.", "network"],
  [409, "Conflict", "Clashes with the current state of the resource.", "client"],
  [410, "Gone", "It used to exist and was removed on purpose.", "server"],
  [413, "Payload Too Large", "The request body is too big.", "client"],
  [414, "URI Too Long", "The address is too long.", "client"],
  [418, "I'm a teapot", "A joke status. Seeing it means someone is testing.", "none"],
  [422, "Unprocessable Content", "Well-formed but the values are not acceptable.", "client"],
  [429, "Too Many Requests", "Rate limited. Slow down and retry later.", "vendor"],
  [431, "Header Fields Too Large", "Headers or cookies are too big.", "client"],
  [451, "Unavailable For Legal Reasons", "Blocked for legal reasons.", "vendor"],
  [500, "Internal Server Error", "The server crashed handling the request.", "server"],
  [501, "Not Implemented", "The server does not support that request.", "server"],
  [502, "Bad Gateway", "A server in the middle got a bad answer from the one behind it. On our refresh this means Bungie failed.", "vendor"],
  [503, "Service Unavailable", "Overloaded, down for maintenance, or not configured (our refresh returns this when the key is missing).", "server"],
  [504, "Gateway Timeout", "A server in the middle waited too long for the one behind it.", "vendor"],
  [505, "HTTP Version Not Supported", "The server cannot speak this HTTP version.", "server"],
  [520, "Cloudflare: Unknown Error", "Cloudflare got an empty or odd reply from the origin.", "vendor"],
  [521, "Cloudflare: Web Server Is Down", "The origin refused Cloudflare's connection.", "vendor"],
  [522, "Cloudflare: Connection Timed Out", "Cloudflare could not connect to the origin in time.", "vendor"],
  [523, "Cloudflare: Origin Is Unreachable", "Cloudflare cannot find a route to the origin.", "vendor"],
  [524, "Cloudflare: A Timeout Occurred", "Connected, but the origin took too long to answer.", "vendor"],
  [525, "Cloudflare: SSL Handshake Failed", "TLS setup between Cloudflare and the origin failed.", "vendor"],
  [526, "Cloudflare: Invalid SSL Certificate", "The origin's certificate is not valid.", "vendor"],
  [530, "Cloudflare: Error 1xxx", "A Cloudflare error page (see the 1xxx code shown).", "vendor"],
];

const WHO_LABEL = { none: "OK", client: "Caller / config", network: "Network path", server: "Site / our app", vendor: "Vendor" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function renderCodes(el, { seen = new Set(), filter = "", cls = "all" } = {}) {
  const q = filter.trim().toLowerCase();
  const rows = CODES.filter(([code, name, meaning]) =>
    (cls === "all" || String(code).startsWith(cls[0])) &&
    (!q || `${code} ${name} ${meaning}`.toLowerCase().includes(q)));
  el.innerHTML = rows.length
    ? rows.map(([code, name, meaning, who]) => `<tr class="${seen.has(code) ? "seen" : ""}">
        <th scope="row"><span class="code c${String(code)[0]}">${code}</span></th>
        <td><b>${esc(name)}</b><br><span class="mean">${esc(meaning)}</span></td>
        <td><span class="who ${who}">${WHO_LABEL[who]}</span>${seen.has(code) ? ' <span class="seenTag">seen in latest check</span>' : ""}</td></tr>`).join("")
    : '<tr><td colspan="3" class="empty">No codes match.</td></tr>';
}
