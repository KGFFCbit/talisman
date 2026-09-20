// Bungie API client that records what happened at every step (HTTP status, ms, Bungie's own
// ErrorStatus) so the network dashboard can show exactly where a refresh failed.
const { coloFrom } = require("./safe");

const BASE = "https://www.bungie.net/Platform";

// Bungie ErrorCode -> plain-English cause. Only the ones a support engineer will actually meet.
const BUNGIE_CODES = {
  5: { why: "Bungie has the API switched off (maintenance)", who: "vendor" },
  1618: { why: "Destiny 2 is down for maintenance", who: "vendor" },
  2101: { why: "Bungie says the API key is invalid or expired", who: "config" },
  2102: { why: "No API key was sent", who: "config" },
  2107: { why: "The key is locked to a different website (Origin Header)", who: "config" },
  2111: { why: "Rate limit hit, slow down", who: "vendor" },
  1601: { why: "That Destiny account was not found", who: "config" },
  1665: { why: "The player's inventory is private", who: "config" },
};

function makeClient(key) {
  const steps = [];
  const tally = { count: 0, failed: 0, msTotal: 0, msMax: 0, http: {} };
  const state = { colo: null };

  async function call(step, path, init = {}, { quiet = false } = {}) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(BASE + path, {
        ...init,
        headers: { "X-API-Key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      });
    } catch (e) {
      const reason = e.cause?.code || e.name;
      steps.push({ step, http: 0, ms: Date.now() - t0, error: reason });
      throw Object.assign(new Error(`Could not reach Bungie (${reason})`), { step, http: 0 });
    }
    state.colo ||= coloFrom(res.headers);
    const json = await res.json().catch(() => ({}));
    const ms = Date.now() - t0;
    if (quiet) {
      tally.count++; tally.msTotal += ms; tally.msMax = Math.max(tally.msMax, ms);
      tally.http[res.status] = (tally.http[res.status] || 0) + 1;
      if (json.ErrorCode !== 1) tally.failed++;
    } else {
      steps.push({ step, http: res.status, ms, bungie: json.ErrorStatus || null, code: json.ErrorCode ?? null });
    }
    if (json.ErrorCode !== 1) {
      throw Object.assign(new Error(json.Message || `Bungie error ${json.ErrorCode}`), {
        step, http: res.status, bungieStatus: json.ErrorStatus, bungieCode: json.ErrorCode,
      });
    }
    return json.Response;
  }

  const summary = () => {
    const out = [...steps];
    if (tally.count) {
      out.push({
        step: "definitions", count: tally.count, failed: tally.failed,
        ms: Math.round(tally.msTotal / tally.count), msMax: tally.msMax, http: tally.http,
      });
    }
    return out;
  };

  return { call, summary, get colo() { return state.colo; } };
}

module.exports = { makeClient, BUNGIE_CODES, BASE };
