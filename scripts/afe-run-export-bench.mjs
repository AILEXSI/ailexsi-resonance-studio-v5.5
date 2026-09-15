/**
 * Bundle + static-serve the AFE-03 export bench (avoids Vite HTML module hang).
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AFE_BENCH_PORT || 1435);
const RECEIVE = Number(process.env.AFE_RECEIVE_PORT || 18785);
const OUT = process.env.AFE_EVIDENCE || join(root, "docs", "compliance", "afe-03-export-bench.json");
const TIMEOUT_MS = Number(process.env.AFE_TIMEOUT_MS || 1800000);
const QS = process.env.AFE_HARNESS_QS || "warmup=10&measured=50&longSeconds=30";
const profile = process.env.AFE_CHROME_PROFILE || "/tmp/afe-chrome-export";

mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(join(root, "tmp"), { recursive: true });
const bundlePath = join(root, "tmp", "afe-export-bench.js");

await build({
  absWorkingDir: root,
  entryPoints: [join(root, "scripts", "afe-export-bench.ts")],
  outfile: bundlePath,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "info",
});

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>AFE export bench</title>
<style>body{font-family:ui-monospace,monospace;background:#111;color:#ddd;margin:16px}</style>
</head><body><pre id="out">starting</pre>
<script type="module" src="/tmp/afe-export-bench.js"></script>
</body></html>`;

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".html": "text/html",
  ".md": "text/plain",
};

function waitForResult() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("export bench timed out"));
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
            if (body?.text) console.log("progress", String(body.text).slice(0, 160));
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
      if (url.pathname === "/" || url.pathname === "/bench.html") {
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
      res.writeHead(200, { "content-type": type, "content-length": String(buf.length), "accept-ranges": "bytes" });
      res.end(buf);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

const pending = waitForResult();
const files = await staticServer();
const qs = new URLSearchParams(QS);
qs.set("receive", String(RECEIVE));
const url = `http://127.0.0.1:${PORT}/bench.html?${qs.toString()}`;
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

try {
  const result = await pending;
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log("wrote", OUT);
  if (result.error) {
    console.error("bench error", result.error);
    process.exitCode = 1;
  } else {
    console.log("exportRepeats", JSON.stringify(result.exportRepeats));
    console.log("longExport", JSON.stringify({
      seconds: result.longExport?.seconds,
      mb: result.longExport?.mediabunny?.measured,
      afe: result.longExport?.afe?.measured,
    }));
    console.log("production", JSON.stringify({
      mb: result.productionExport?.mediabunny?.measured,
      afe: result.productionExport?.afe?.measured,
    }));
    console.log("phaseCountsAFE", JSON.stringify(result.phaseExport?.afe?.snap?.counts));
    console.log("raw720", JSON.stringify({
      mb: result.raw720?.mediabunny?.wall,
      afe: result.raw720?.afe?.wall,
    }));
    const sumPath = OUT.replace(/\.json$/, "-summary.json");
    writeFileSync(sumPath, JSON.stringify({
      environment: result.environment,
      exportRepeats: result.exportRepeats,
      longExport: result.longExport,
      productionExport: result.productionExport,
      phaseExport: result.phaseExport,
      raw720: result.raw720,
      abort: result.abort,
      fallback: result.fallback,
      prefetch: result.prefetch,
    }, null, 2) + "\n");
    console.log("wrote", sumPath);
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
