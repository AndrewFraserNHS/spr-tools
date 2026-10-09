// Tiny dependency-free server: serves the app and stores only encrypted vault data.
import http from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
export const COLLECTIONS = [
  "people",
  "workstreams",
  "teams",
  "links",
  "events",
  "acronyms",
  "config",
];
const PORT = Number(process.env.PORT) || 5173;
const HOST = "127.0.0.1";
const MAX_BODY = 20 * 1024 * 1024;
const VAULT_FILE = path.join(DATA_DIR, "vault.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Stable pretty JSON so git diffs stay small. */
export function serialise(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

export async function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function isVaultEnvelope(value) {
  if (
    !value ||
    value.version !== 1 ||
    value.kdf !== "PBKDF2-SHA-256" ||
    value.cipher !== "AES-256-GCM" ||
    value.iterations !== 310000
  )
    return false;
  if (
    ![value.salt, value.iv, value.ciphertext].every(
      (part) => typeof part === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(part),
    )
  )
    return false;
  return (
    Buffer.from(value.salt, "base64").length === 16 &&
    Buffer.from(value.iv, "base64").length === 12 &&
    Buffer.from(value.ciphertext, "base64").length >= 16
  );
}

export async function handleVault(req, res) {
  if (req.method === "GET") {
    try {
      return send(res, 200, await readFile(VAULT_FILE, "utf8"));
    } catch {
      return send(res, 404, '{"error":"Encrypted vault is not set up"}');
    }
  }
  if (req.method === "PUT") {
    try {
      const parsed = JSON.parse(await readBody(req));
      if (!isVaultEnvelope(parsed))
        return send(
          res,
          400,
          '{"error":"Only encrypted vault data is accepted"}',
        );
      await mkdir(DATA_DIR, { recursive: true });
      await writeAtomic(VAULT_FILE, serialise(parsed));
      return send(res, 200, '{"ok":true}');
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
  }
  send(res, 405, '{"error":"Method not allowed"}');
}

async function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep))
    return send(res, 403, "Forbidden", "text/plain");
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      if (pathname === "/api/vault") return await handleVault(req, res);
      if (pathname === "/api/ping")
        return send(res, 200, '{"ok":true,"writable":true}');
      return await handleStatic(req, res, pathname);
    } catch (e) {
      send(res, 500, JSON.stringify({ error: e.message }));
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  createServer().listen(PORT, HOST, () =>
    console.log(`SPR Tools running at http://localhost:${PORT}`),
  );
}
