/**
 * MODE A Chrome harness runner for VIDEO→VIS→VIDEO production export.
 * Bundles scripts/afe-17-real-export-qa.ts (esbuild) + static :1437 + receive :18787.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AFE_QA_PORT || 1437);
const RECEIVE = Number(process.env.AFE_QA_RECEIVE || 18787);
const VARIANT = process.env.AFE_QA_VARIANT || "primary";
const TIMEOUT_MS = Number(process.env.AFE_QA_TIMEOUT_MS || 180000);
const ARTIFACT_DIR = process.env.AFE_QA_ARTIFACTS || join(root, "artifacts", "qa-2026-09-16");
const profile = process.env.AFE_CHROME_PROFILE || `/tmp/afe-17-qa-chrome-${VARIANT}`;

mkdirSync(ARTIFACT_DIR, { recursive: true });
mkdirSync(join(root, "tmp"), { recursive: true });
const bundlePath = join(root, "tmp", "afe-17-real-export-qa.js");

await build({
  absWorkingDir: root,
  entryPoints: [join(root, "scripts", "afe-17-real-export-qa.ts")],
  outfile: bundlePath,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
});

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>AFE-17 real export QA</title>
<style>body{font-family:ui-monospace,monospace;background:#111;color:#ddd;margin:16px}</style>
</head><body><pre id="out">starting</pre>
<script type="module" src="/tmp/afe-17-real-export-qa.js"></script>
</body></html>`;

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".html": "text/html",
  ".wav": "audio/wav",
};

function waitForResult() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("real export QA timed out"));
    }, TIMEOUT_MS);
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/afe-progress") {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (body?.text) console.log("progress", String(body.text).slice(0, 200));
          } catch {
            /* */
          }
        });
        return;
      }
      if (req.method === "POST" && req.url === "/afe-results") {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          clearTimeout(timer);
          const raw = Buffer.concat(chunks).toString("utf8");
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
          server.close();
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(RECEIVE, "127.0.0.1");
  });
}

function staticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      if (url.pathname === "/" || url.pathname === "/qa.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
        return;
      }
      let rel = url.pathname.replace(/^\/+/, "");
      if (rel.includes("..")) {
        res.writeHead(403);
        res.end();
        return;
      }
      const file = join(root, rel);
      if (!existsSync(file)) {
        res.writeHead(404);
        res.end("not found " + rel);
        return;
      }
      const type = MIME[extname(file)] || "application/octet-stream";
      const buf = readFileSync(file);
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        if (m) {
          const start = Number(m[1]);
          const end = m[2] ? Number(m[2]) : buf.length - 1;
          const slice = buf.subarray(start, end + 1);
          res.writeHead(206, {
            "content-type": type,
            "content-length": String(slice.length),
            "content-range": `bytes ${start}-${start + slice.length - 1}/${buf.length}`,
            "accept-ranges": "bytes",
          });
          res.end(slice);
          return;
        }
      }
      res.writeHead(200, {
        "content-type": type,
        "content-length": String(buf.length),
        "accept-ranges": "bytes",
      });
      res.end(buf);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const pending = waitForResult();
const files = await staticServer();
const qs = new URLSearchParams();
qs.set("receive", String(RECEIVE));
qs.set("variant", VARIANT);
qs.set("video", "/tests/fixtures/user-video.mp4");
qs.set("audio", "/tests/fixtures/user-audio.mp3");
const url = `http://127.0.0.1:${PORT}/qa.html?${qs.toString()}`;
console.log("chrome", url);
const chrome = spawn(
  process.env.CHROME_BIN || "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    "--autoplay-policy=no-user-gesture-required",
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--window-size=900,700",
    url,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let chromeErr = "";
chrome.stderr.on("data", (d) => {
  chromeErr += String(d);
});

function parseUnresolved(error) {
  if (!error) return null;
  const m = /unresolvedRequested (\d+)/.exec(String(error));
  return m ? Number(m[1]) : null;
}

try {
  const result = await pending;
  const bytes = Array.isArray(result.bytes) ? Buffer.from(result.bytes) : null;
  delete result.bytes;
  result.unresolvedRequested =
    result.unresolvedRequested ?? parseUnresolved(result.error) ?? (result.success ? 0 : null);
  const stem = VARIANT === "b0" ? "afe-17-variant-b0-source0" : "afe-17-video-vis-video";
  const evidencePath = join(
    ARTIFACT_DIR,
    VARIANT === "b0" ? "afe-17-variant-b0-source0-evidence.json" : "afe-17-real-export-qa-evidence.json",
  );
  writeFileSync(evidencePath, JSON.stringify(result, null, 2) + "\n");
  console.log("wrote", evidencePath);
  if (bytes && bytes.length > 0) {
    const mp4Path = join(ARTIFACT_DIR, `${stem}.mp4`);
    writeFileSync(mp4Path, bytes);
    console.log("wrote", mp4Path, bytes.length);
  }
  if (result.stall || /AFE_DECODE_STALL/i.test(String(result.error || ""))) {
    const stallPath = join(ARTIFACT_DIR, "afe-17-AFE_DECODE_STALL.txt");
    writeFileSync(stallPath, String(result.error) + "\n");
    console.log("wrote", stallPath);
  }
  console.log(
    "summary",
    JSON.stringify({
      variant: VARIANT,
      success: result.success,
      stall: result.stall,
      fileSizeBytes: result.fileSizeBytes,
      videoFramesRequested: result.videoFramesRequested,
      videoFramesDecoded: result.videoFramesDecoded,
      videoFramesEncoded: result.videoFramesEncoded,
      visFramesEncoded: result.visFramesEncoded,
      unresolvedRequested: result.unresolvedRequested,
      chainOk: result.chainOk,
      error: result.error ? String(result.error).slice(0, 240) : null,
    }),
  );
  if (
    !result.success ||
    result.stall ||
    !result.chainOk ||
    result.pictureOk === false ||
    !result.videoFramesRequested
  ) {
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e);
  if (chromeErr) console.error(chromeErr.slice(-2000));
  process.exitCode = 1;
} finally {
  chrome.kill("SIGTERM");
  files.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 800);
}
