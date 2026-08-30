"use strict";
const http = require("http");

const PORT = process.env.PORT || 3000;
const MAX_ENTRIES_PER_SESSION = 200;
const MAX_SESSIONS = 500;
const NAME_MAX = 40;
const CODE_MAX = 40;

// In-memory store: code -> Map(name -> entry)
const sessions = new Map();

function normCode(raw) {
  return String(raw || "").trim().toUpperCase().slice(0, CODE_MAX);
}
function normName(raw) {
  return String(raw || "").trim().slice(0, NAME_MAX);
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req, cb) {
  let data = "";
  let size = 0;
  let done = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > 20000) {
      if (!done) { done = true; cb(new Error("too_large")); }
      req.destroy();
      return;
    }
    data += chunk;
  });
  req.on("end", () => {
    if (done) return;
    done = true;
    if (!data) return cb(null, {});
    try {
      cb(null, JSON.parse(data));
    } catch (e) {
      cb(e);
    }
  });
  req.on("error", (e) => {
    if (!done) { done = true; cb(e); }
  });
}

function getOrCreateSession(code) {
  let s = sessions.get(code);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldestKey = sessions.keys().next().value;
      sessions.delete(oldestKey);
    }
    s = new Map();
    sessions.set(code, s);
  }
  return s;
}

const server = http.createServer((req, res) => {
  let u;
  try {
    u = new URL(req.url, "http://internal");
  } catch (e) {
    return sendJSON(res, 400, { ok: false, error: "Bad request." });
  }
  const parts = u.pathname.split("/").filter(Boolean);

  if (req.method === "OPTIONS") {
    return sendJSON(res, 204, {});
  }

  if (req.method === "GET" && u.pathname === "/api/health") {
    return sendJSON(res, 200, { ok: true, sessions: sessions.size });
  }

  if (parts[0] === "api" && parts[1] === "sessions" && parts[2]) {
    let code;
    try {
      code = normCode(decodeURIComponent(parts[2]));
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: "Bad class code." });
    }
    if (!code) return sendJSON(res, 400, { ok: false, error: "Missing class code." });

    if (req.method === "GET" && parts[3] === "leaderboard") {
      const s = sessions.get(code);
      const entries = s ? Array.from(s.values()) : [];
      entries.sort((a, b) => (b.points - a.points) || (b.profit - a.profit) || (a.ts - b.ts));
      return sendJSON(res, 200, { ok: true, code, entries });
    }

    if (req.method === "POST" && parts[3] === "join") {
      return readBody(req, (err, body) => {
        if (err) return sendJSON(res, 400, { ok: false, error: "Bad request." });
        const name = normName(body.name);
        if (!name) return sendJSON(res, 400, { ok: false, error: "Name required." });
        const s = getOrCreateSession(code);
        if (!s.has(name) && s.size >= MAX_ENTRIES_PER_SESSION) {
          return sendJSON(res, 429, { ok: false, error: "This session is full." });
        }
        if (!s.has(name)) {
          s.set(name, {
            name, business: null, profit: 0, points: 0, tier: null,
            joinedAt: Date.now(), ts: Date.now(),
          });
        }
        return sendJSON(res, 200, { ok: true });
      });
    }

    if (req.method === "POST" && parts[3] === "score") {
      return readBody(req, (err, body) => {
        if (err) return sendJSON(res, 400, { ok: false, error: "Bad request." });
        const name = normName(body.name);
        if (!name) return sendJSON(res, 400, { ok: false, error: "Name required." });
        const s = getOrCreateSession(code);
        const profit = Number.isFinite(Number(body.profit)) ? Number(body.profit) : 0;
        const points = Math.max(0, Math.min(500, Number.isFinite(Number(body.points)) ? Number(body.points) : 0));
        const business = typeof body.business === "string" ? body.business.slice(0, 60) : null;
        const tier = typeof body.tier === "string" ? body.tier.slice(0, 60) : null;
        s.set(name, { name, business, profit, points, tier, ts: Date.now() });
        return sendJSON(res, 200, { ok: true });
      });
    }

    if (req.method === "DELETE" && parts.length === 3) {
      sessions.delete(code);
      return sendJSON(res, 200, { ok: true });
    }
  }

  sendJSON(res, 404, { ok: false, error: "Not found." });
});

server.listen(PORT, () => {
  console.log("Break-Even Stall API listening on " + PORT);
});
