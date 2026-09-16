/**
 * STRESS-01 Chrome differential on the exact failing MP4.
 * Diagnostic only. Does not change product runtime.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.STRESS01_VITE_PORT || 1424);
const RECEIVE = Number(process.env.STRESS01_RECEIVE_PORT || 18771);
const OUT =
  process.env.STRESS01_OUT ||
  join(root, "docs", "compliance", "stress-01-clip-start-pts-100000.json");
const CLIP_DEST = join(root, "scripts", "stress-01-evidence", "6C16E2CA-Kopie.mp4");
const CLIP_CANDIDATES = [
  process.env.STRESS01_CLIP,
  "/home/ubuntu/.cursor/projects/workspace/uploads/stress-01-6C16E2CA-Kopie_da18.mp4",
  join(root, "scripts", "stress-01-evidence", "6C16E2CA-Kopie.mp4"),
].filter(Boolean);

mkdirSync(dirname(OUT), { recursive: true });
mkdirSync(dirname(CLIP_DEST), { recursive: true });

const clipSrc = CLIP_CANDIDATES.find((p) => existsSync(p));
if (!clipSrc) throw new Error("STRESS-01 clip not found. Set STRESS01_CLIP.");
if (clipSrc !== CLIP_DEST) copyFileSync(clipSrc, CLIP_DEST);
console.log("clip", clipSrc, "->", CLIP_DEST);

function waitForResult() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("STRESS-01 harness timed out"));
    }, 120000);
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
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

function spawnVite() {
  const child = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let ready = false;
  return new Promise((resolve, reject) => {
    const onData = (d) => {
      const s = String(d);
      process.stdout.write(s);
      if (/Local:|ready in/i.test(s) && !ready) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error("vite exited " + code));
    });
    setTimeout(() => {
      if (!ready) resolve(child);
    }, 12000);
  });
}

function spawnChrome() {
  const url =
    `http://127.0.0.1:${PORT}/scripts/stress-01-clip-start-harness.html` +
    `?receive=${RECEIVE}`;
  const bin = process.env.CHROME_BIN || "google-chrome";
  const profile = process.env.STRESS01_CHROME_PROFILE || "/tmp/stress-01-chrome-profile";
  console.log("chrome", bin, url);
  return spawn(
    bin,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--autoplay-policy=no-user-gesture-required",
      "--use-gl=angle",
      "--use-angle=swiftshader-webgl",
      "--window-size=900,700",
      url,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

const pending = waitForResult();
const vite = await spawnVite();
const chrome = spawnChrome();
let chromeErr = "";
chrome.stderr.on("data", (d) => {
  chromeErr += String(d);
});
chrome.stdout.on("data", (d) => {
  process.stdout.write(String(d));
});

try {
  const result = await pending;
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log("wrote", OUT);
  if (result.error) {
    console.error("harness error", result.error);
    process.exitCode = 1;
  } else {
    console.log("table", JSON.stringify(result.table, null, 2));
    console.log("firstDivergence", result.firstDivergence);
    console.log("sample3", JSON.stringify(result.sample3));
    console.log("sps", JSON.stringify(result.spsInfo));
    console.log("chromeSw has100000", result.chromeSw?.has100000, result.chromeSw?.outputs);
    console.log("ailexsi has100000", result.ailexsi?.has100000, result.ailexsi?.outputs);
    console.log("mediabunny", result.mediabunny?.error || result.mediabunny?.has100000, result.mediabunny?.outputs);
    console.log("patched", result.patched?.has100000, result.patched?.outputs);
  }
} catch (e) {
  console.error(e);
  console.error("chrome stderr", chromeErr.slice(-4000));
  process.exitCode = 1;
} finally {
  chrome.kill("SIGTERM");
  vite.kill("SIGTERM");
}
