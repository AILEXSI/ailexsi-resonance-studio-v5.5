/**
 * Launch Vite + headless Chrome for the AFE vs Mediabunny harness.
 * Writes docs/compliance/afe-evidence.json
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.AFE_VITE_PORT || 1423);
const RECEIVE = Number(process.env.AFE_RECEIVE_PORT || 18767);
const OUT = process.env.AFE_EVIDENCE || join(root, "docs", "compliance", "afe-evidence.json");
const TIMEOUT_MS = Number(process.env.AFE_TIMEOUT_MS || 1800000);
const HARNESS_QS = process.env.AFE_HARNESS_QS || "warmup=10&measured=50";

mkdirSync(dirname(OUT), { recursive: true });

function waitForResult() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("AFE harness timed out waiting for POST /afe-results"));
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
            if (body?.checkpoint) {
              const cp = OUT.replace(/\.json$/, "-checkpoint.json");
              writeFileSync(cp, JSON.stringify(body.checkpoint, null, 2) + "\n");
              console.log("checkpoint", cp);
            }
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
    }, 8000);
  });
}

function spawnChrome() {
  const qs = new URLSearchParams(HARNESS_QS);
  if (!qs.has("receive")) qs.set("receive", String(RECEIVE));
  const url = `http://127.0.0.1:${PORT}/scripts/afe-frame-harness.html?${qs.toString()}`;
  const bin = process.env.CHROME_BIN || "google-chrome";
  const profile = process.env.AFE_CHROME_PROFILE || "/tmp/afe-chrome-profile";
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

try {
  const result = await pending;
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log("wrote", OUT);
  if (result.error) {
    console.error("harness error", result.error);
    process.exitCode = 1;
  } else {
    console.log("compared", result.totals?.compared, "agree", result.totals?.agree);
    console.log("MB", JSON.stringify(result.totals?.mediabunny));
    console.log("AFE", JSON.stringify(result.totals?.afe));
    console.log("seq", JSON.stringify(result.sequentialBatch));
    console.log("rand", JSON.stringify(result.random));
    console.log("export720", JSON.stringify(result.export720));
    console.log("exportRepeats", JSON.stringify({
      warmupN: result.exportRepeats?.warmupN,
      measuredN: result.exportRepeats?.measuredN,
      alternated: result.exportRepeats?.alternated,
      prefetch: result.exportRepeats?.prefetch,
      mediabunny: result.exportRepeats?.mediabunny?.measured,
      afe: result.exportRepeats?.afe?.measured,
    }));
    console.log("longExport", JSON.stringify({
      seconds: result.longExport?.seconds,
      mediabunny: result.longExport?.mediabunny?.measured,
      afe: result.longExport?.afe?.measured,
    }));
    console.log("productionExport", JSON.stringify({
      mediabunny: result.productionExport?.mediabunny?.measured,
      afe: result.productionExport?.afe?.measured,
    }));
    console.log("deliveryAFE", JSON.stringify({
      readyImmediate: result.phaseExport?.afe?.snap?.counts?.readyImmediate,
      framePromiseWaits: result.phaseExport?.afe?.snap?.counts?.framePromiseWaits,
      streamPathFrames: result.phaseExport?.afe?.snap?.counts?.streamPathFrames,
      inFlightPeak: result.phaseExport?.afe?.snap?.counts?.inFlightPeak,
      prefetchWindow: result.phaseExport?.afe?.snap?.counts?.prefetchWindow,
      sampleIndexLookups: result.phaseExport?.afe?.snap?.counts?.sampleIndexLookups,
    }));
    console.log("phaseMB", JSON.stringify(result.phaseExport?.mediabunny?.phases?.slice(0, 8)));
    console.log("phaseAFE", JSON.stringify(result.phaseExport?.afe?.phases?.slice(0, 8)));
    console.log("phaseCountsMB", JSON.stringify(result.phaseExport?.mediabunny?.snap?.counts));
    console.log("phaseCountsAFE", JSON.stringify(result.phaseExport?.afe?.snap?.counts));
    console.log("raw720", JSON.stringify({
      cold: {
        mb: result.raw720?.cold?.mediabunny?.wall,
        afe: result.raw720?.cold?.afe?.wall,
      },
      warm: {
        mb: result.raw720?.warm?.mediabunny?.wall,
        afe: result.raw720?.warm?.afe?.wall,
      },
    }));
    console.log("abort", JSON.stringify(result.abortTest));
    console.log("abortOpen", JSON.stringify(result.abortOpen));
    console.log("abortRandom", JSON.stringify(result.abortRandom));
    console.log("abortExport", JSON.stringify(result.abortExport));
    console.log("fallback", JSON.stringify(result.fallbackTest));
    const summary = {
      environment: result.environment,
      pixels: result.totals,
      sequential: result.sequentialBatch,
      random: result.random,
      export720: result.export720,
      exportRepeats: result.exportRepeats,
      longExport: result.longExport,
      productionExport: result.productionExport,
      prefetchSweep: result.prefetchSweep,
      phaseExport: result.phaseExport,
      raw720: result.raw720,
      benches: (result.benches || []).map((b) => ({
        id: b.id,
        title: b.title,
        rawMb: b.raw?.mediabunny?.wall,
        rawAfe: b.raw?.afe?.wall,
        exportMb: b.export?.mediabunny?.measured,
        exportAfe: b.export?.afe?.measured,
        rawByFps: b.rawByFps,
      })),
      abort: { batch: result.abortTest, open: result.abortOpen, random: result.abortRandom, export: result.abortExport },
      fallback: result.fallbackTest,
      memory: result.memory,
    };
    const sumPath = OUT.replace(/afe-evidence\.json$/, "afe-03-evidence-summary.json");
    writeFileSync(sumPath, JSON.stringify(summary, null, 2) + "\n");
    console.log("wrote", sumPath);
  }
} catch (e) {
  console.error(e);
  if (chromeErr) console.error(chromeErr.slice(-2000));
  process.exitCode = 1;
} finally {
  chrome.kill("SIGTERM");
  vite.kill("SIGTERM");
  setTimeout(() => {
    try {
      chrome.kill("SIGKILL");
    } catch {
      /* */
    }
    try {
      vite.kill("SIGKILL");
    } catch {
      /* */
    }
    process.exit(process.exitCode ?? 0);
  }, 1500);
}
