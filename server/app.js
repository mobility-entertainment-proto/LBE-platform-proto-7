import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { URL } from "node:url";
import { synthesizeGuide } from "./azure-speech.js";

const ROOT_DIR = path.resolve(".");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function resolveStaticPath(urlPath) {
  const normalizedPath = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const candidate = path.resolve(ROOT_DIR, `.${normalizedPath}`);
  if (!candidate.startsWith(ROOT_DIR)) return null;
  if (!fs.existsSync(candidate)) return null;
  if (fs.statSync(candidate).isDirectory()) {
    const indexFile = path.join(candidate, "index.html");
    return fs.existsSync(indexFile) ? indexFile : null;
  }
  return candidate;
}

async function handleTtsGuide(req, res) {
  try {
    const raw = await readRequestBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const { audioData, format, voice } = await synthesizeGuide(body.text);
    res.writeHead(200, {
      "Content-Type": format,
      "Content-Length": audioData.byteLength,
      "X-Azure-TTS-Voice": voice,
      "Cache-Control": "no-store",
    });
    res.end(audioData);
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function handleStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    sendJson(res, 404, { error: `Not found: ${pathname}` });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mimeType });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/tts-guide") {
    await handleTtsGuide(req, res);
    return;
  }

  if (req.method === "GET") {
    handleStatic(req, res, requestUrl.pathname);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(PORT, HOST, () => {
  console.log(`LBE proto-5 server running at http://${HOST}:${PORT}`);
});
