// POST /api/feedback — the feedback form's only door to email.
// The destination address lives in the FEEDBACK_TO environment variable (set in Vercel), never in the
// page, the JavaScript or this repo, so nobody can scrape it. Mail goes out as plain text through
// Resend's HTTPS API (RESEND_API_KEY; FEEDBACK_FROM must be on a domain verified in Resend).
// The form works without JavaScript: every outcome is a 303 back to /feedback.html#<result>.

const TOPICS = new Set(["crash", "recipes", "talismans", "website", "other"]);
const ORIGIN = /^(https:\/\/(www\.)?kgffc\.net|https:\/\/[\w-]+\.vercel\.app|http:\/\/localhost(:\d+)?)$/;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,24}$/i;
const hits = new Map(); // best-effort, per-instance rate limit; the address is held in memory only, never logged

const clean = (s, max) => String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, max);
const oneLine = (s) => s.replace(/[\r\n]+/g, " ");

function back(res, result) {
  res.statusCode = 303;
  res.setHeader("Location", `/feedback.html#${result}`);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

function fields(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return Object.fromEntries(new URLSearchParams(req.body));
  return {};
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); res.statusCode = 405; return res.end(); }
  const origin = req.headers.origin || "";
  if (origin && !ORIGIN.test(origin)) return back(res, "error");

  const b = fields(req);
  if (b.website) return back(res, "sent"); // spam trap filled: pretend it worked, send nothing

  const message = clean(b.message, 4000);
  const name = oneLine(clean(b.name, 80));
  const email = oneLine(clean(b.email, 120));
  const topic = TOPICS.has(b.topic) ? b.topic : "other";
  if (message.length < 10) return back(res, "invalid");

  const who = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(who) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 5) return back(res, "slow");
  recent.push(now);
  hits.set(who, recent);

  const { RESEND_API_KEY: key, FEEDBACK_TO: to } = process.env;
  const from = process.env.FEEDBACK_FROM || "KGFFC feedback <feedback@kgffc.net>";
  if (!key || !to) { console.error("feedback: RESEND_API_KEY or FEEDBACK_TO is not set"); return back(res, "error"); }

  const replyTo = EMAIL.test(email) ? email : null;
  const text = [`Topic: ${topic}`, `Name: ${name || "(not given)"}`, `Reply to: ${replyTo || "(not given)"}`, "", message, "", "— sent from kgffc.net/feedback.html"].join("\n");
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `KGFFC feedback: ${topic}`, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { console.error(`feedback: Resend answered HTTP ${r.status}`); return back(res, "error"); }
    return back(res, "sent");
  } catch (e) {
    console.error(`feedback: ${e.name}`);
    return back(res, "error");
  }
};
