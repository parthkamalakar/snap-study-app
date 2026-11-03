#!/usr/bin/env node
// Snap Study local server.
// Serves the app and forwards chat requests to Ollama on this computer.
// No API keys, no cloud. Needs Node 18 or newer and no npm packages.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const OLLAMA = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
const MAX_IMAGES = Number(process.env.MAX_IMAGES) || 4;
const NUM_CTX = Number(process.env.NUM_CTX) || 8192;
const MAX_BODY = 80 * 1024 * 1024;
const PUBLIC = path.join(__dirname, "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline'; connect-src 'self' https://generativelanguage.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// Only cache positive/negative answers that came from Ollama itself.
// A failed lookup (Ollama down) must not be remembered.
const visionCache = new Map();

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function isVision(name) {
  if (visionCache.has(name)) return visionCache.get(name);
  try {
    const r = await fetch(OLLAMA + "/api/show", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    let v = null;
    if (Array.isArray(j.capabilities)) v = j.capabilities.includes("vision");
    else if (j.details && Array.isArray(j.details.families)) v = j.details.families.some((f) => /clip|mllama/i.test(f)) ? true : null;
    if (v !== null) visionCache.set(name, v);
    return v;
  } catch (e) {
    return null;
  }
}

async function listModels(res) {
  try {
    const r = await fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error("tags " + r.status);
    const j = await r.json();
    const names = (j.models || []).map((m) => m.name);
    const models = await Promise.all(names.map(async (name) => ({ name, vision: await isVision(name) })));
    json(res, 200, { models, maxImages: MAX_IMAGES });
  } catch (e) {
    json(res, 503, { error: "ollama_unreachable", retryable: true, message: "Ollama is not running at " + OLLAMA });
  }
}

// Turn an Ollama failure into a stable error code the page can act on.
function classify(status, message) {
  const m = String(message || "");
  if (status === 404 || /not found/i.test(m)) return { http: 404, error: "model_not_found", retryable: false };
  if (/image|vision|multimodal/i.test(m)) return { http: 400, error: "model_no_vision", retryable: false };
  if (/memory|alloc/i.test(m)) return { http: 507, error: "out_of_memory", retryable: false };
  if (status === 429) return { http: 429, error: "busy", retryable: true };
  if (status === 503) return { http: 503, error: "busy", retryable: true };
  if (status >= 500) return { http: 502, error: "ollama_error", retryable: true };
  return { http: 502, error: "ollama_error", retryable: false };
}

function stripDataUrl(s) {
  s = String(s);
  const i = s.indexOf("base64,");
  return s.startsWith("data:") && i !== -1 ? s.slice(i + 7) : s;
}

async function chat(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return json(res, 400, { error: "bad_request", message: "Could not read the request." }); }
  if (!payload || typeof payload.model !== "string" || !payload.model || !Array.isArray(payload.messages)) {
    return json(res, 400, { error: "bad_request", message: "Missing model or messages." });
  }

  const messages = payload.messages.map((m) => ({
    role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user",
    content: String(m.content == null ? "" : m.content),
    ...(Array.isArray(m.images) && m.images.length ? { images: m.images.slice(0, MAX_IMAGES).map(stripDataUrl) } : {}),
  }));

  // Refuse early instead of letting a text-only model answer a photo it never saw.
  if (messages.some((m) => m.images) && (await isVision(payload.model)) === false) {
    return json(res, 400, { error: "model_no_vision", retryable: false, message: payload.model + " cannot read photos." });
  }

  const body = {
    model: payload.model,
    messages,
    stream: true,
    options: {
      temperature: typeof payload.options?.temperature === "number" ? payload.options.temperature : 0.4,
      num_ctx: NUM_CTX,
    },
  };
  if (payload.format === "json") body.format = "json";

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  try {
    const up = await fetch(OLLAMA + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!up.ok) {
      const text = await up.text().catch(() => "");
      let msg = text;
      try { msg = JSON.parse(text).error || text; } catch (e) {}
      msg = String(msg).slice(0, 300);
      const c = classify(up.status, msg);
      return json(res, c.http, { error: c.error, retryable: c.retryable, message: msg });
    }
    res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", ...SECURITY_HEADERS });
    for await (const chunk of up.body) res.write(chunk);
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return;
    if (!res.headersSent) return json(res, 503, { error: "ollama_unreachable", retryable: true, message: "Ollama is not running at " + OLLAMA });
    // Headers are already out: tell the page the stream broke instead of ending silently.
    res.write(JSON.stringify({ error: "Connection to Ollama was lost." }) + "\n");
    res.end();
  }
}

function serveStatic(res, url) {
  const rel = url === "/" ? "index.html" : decodeURIComponent(url.slice(1));
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)]) { res.writeHead(404); return res.end("Not found"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)], "cache-control": "no-store", ...SECURITY_HEADERS });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || "");
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) { res.writeHead(403); return res.end("Forbidden"); }
  if (req.method === "POST") {
    const origin = req.headers.origin;
    if (origin) { try { if (new URL(origin).host !== host) { res.writeHead(403); return res.end("Forbidden"); } } catch (e) { res.writeHead(403); return res.end("Forbidden"); } }
  }
  let url;
  try { url = (req.url || "/").split("?")[0]; decodeURIComponent(url); } catch (e) { res.writeHead(400); return res.end("Bad request"); }
  if (req.method === "GET" && url === "/api/models") return listModels(res);
  if (req.method === "POST" && url === "/api/chat") return chat(req, res);
  if (req.method === "GET") return serveStatic(res, url);
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Snap Study is running at http://localhost:" + PORT);
  console.log("Using Ollama at " + OLLAMA + " (photos per message: " + MAX_IMAGES + ")");
});
