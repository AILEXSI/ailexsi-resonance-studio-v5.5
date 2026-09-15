/**
 * Standalone AFE-03 export bench. Bundled with esbuild, not Vite HTML.
 * Measures 720p30 full export with AILEXSI Frame Engine only.
 * Historical Mediabunny comparison slots are no longer run (V5.5).
 */
import {
  clearFrameSources,
  resetFrameSourceBackend,
  setFrameSourceBackend,
} from "../src/core/exporter/frame-source";
import { exportWithWebCodecs } from "../src/core/exporter/webcodecs";
import {
  beginAfePerf,
  createFrameSourceBackend,
  endAfePerf,
  getAfeSequentialPrefetch,
  installWebCodecsProbe,
  isAfeError,
  setAfeSequentialPrefetch,
  summarizePhases,
} from "../src/core/frame-engine";
import { clipOf, jobOf, wallStats } from "./afe-bench";
import { sequentialTimes } from "../tests/export/afe-plan";

const qs = new URLSearchParams(location.search);
const RECEIVE = "http://127.0.0.1:" + (qs.get("receive") || "18767");
const WARMUP = Math.max(0, Number(qs.get("warmup") ?? 10));
const MEASURED = Math.max(1, Number(qs.get("measured") ?? 50));
const PREFETCH = qs.get("prefetch");
if (PREFETCH) setAfeSequentialPrefetch(Number(PREFETCH));

const out = document.getElementById("out") || document.body;

function show(text: string) {
  out.textContent = text;
  document.title = text.split("\n")[0]!.slice(0, 80);
  void report("/afe-progress", { text, t: performance.now() });
}

async function report(path: string, body: unknown) {
  try {
    await fetch(RECEIVE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* */
  }
}

async function runOne(identity: "ailexsi", job: ReturnType<typeof jobOf>, i: number) {
  setFrameSourceBackend(identity);
  clearFrameSources();
  const t0 = performance.now();
  const result = await exportWithWebCodecs({ ...job, fileName: `${job.fileName}-${identity}-${i}` });
  const ms = performance.now() - t0;
  resetFrameSourceBackend();
  clearFrameSources();
  return { ok: result.success, error: result.error, ms, bytes: result.fileSizeBytes };
}

async function timed(identity: "ailexsi", job: ReturnType<typeof jobOf>) {
  installWebCodecsProbe();
  beginAfePerf(identity);
  setFrameSourceBackend(identity);
  clearFrameSources();
  const t0 = performance.now();
  const result = await exportWithWebCodecs(job);
  const wall = performance.now() - t0;
  const snap = endAfePerf();
  resetFrameSourceBackend();
  clearFrameSources();
  return {
    result: { success: result.success, error: result.error, bytes: result.fileSizeBytes },
    wall,
    snap,
    phases: snap ? summarizePhases(snap) : [],
  };
}

async function repeatBoth(job: ReturnType<typeof jobOf>, warmup: number, measured: number, seed = 0xafe03) {
  let a = seed >>> 0;
  const rand = () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const mbW: number[] = [];
  const afeW: number[] = [];
  const mbM: number[] = [];
  const afeM: number[] = [];
  let afeFirst = rand() < 0.5;
  for (let i = 0; i < warmup + measured; i++) {
    show(`export pair ${i + 1}/${warmup + measured} first=${afeFirst ? "afe" : "mb"}`);
    const first = "ailexsi" as const;
    const second = "ailexsi" as const;
    const x = await runOne(first, job, i * 2);
    const y = await runOne(second, job, i * 2 + 1);
    if (!x.ok || !y.ok) {
      return { error: `${!x.ok ? first : second}: ${!x.ok ? x.error : y.error}` };
    }
    const mb = x.ms;
    const afe = y.ms;
    if (i < warmup) {
      mbW.push(mb);
      afeW.push(afe);
    } else {
      mbM.push(mb);
      afeM.push(afe);
    }
    afeFirst = !afeFirst;
  }
  return {
    alternated: true,
    warmupN: warmup,
    measuredN: measured,
    mediabunny: { warmup: wallStats(mbW), measured: wallStats(mbM), rawWarm: mbW, rawMeasured: mbM },
    afe: { warmup: wallStats(afeW), measured: wallStats(afeM), rawWarm: afeW, rawMeasured: afeM },
  };
}

async function rawPass(identity: "ailexsi", url: string, times: number[]) {
  installWebCodecsProbe();
  beginAfePerf(identity);
  const tAll = performance.now();
  const opened = await createFrameSourceBackend(identity).open(url);
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d")!;
  const t0 = performance.now();
  for await (const sample of opened.getFramesAt(times)) {
    if (!sample) continue;
    sample.draw(ctx, 0, 0, 1280, 720);
    sample.close();
  }
  const decodeWall = performance.now() - t0;
  const snap = endAfePerf();
  opened.close();
  return { wall: performance.now() - tAll, decodeWall, snap, n: times.length };
}

function longJob(url: string, seconds: number) {
  const clipMs = 2000;
  const n = Math.max(1, Math.round((seconds * 1000) / clipMs));
  const clips = [];
  for (let i = 0; i < n; i++) {
    clips.push(clipOf(`L${i}`, url, i * clipMs, (i + 1) * clipMs, { sourceInMs: 0, sourceOutMs: clipMs }));
  }
  return jobOf(`long-${seconds}s`, url, 1280, 720, n * clipMs, 30, clips);
}

try {
  show("loading manifest");
  const manifest = await (await fetch("/tests/fixtures/afe/manifest.json")).json();
  const wide = manifest.files.find((f: { width?: number }) => (f.width ?? 0) >= 1280);
  if (!wide) throw new Error("no 720p fixture");
  const srcUrl = new URL("/" + wide.path, location.origin).href;
  const job = jobOf("afe-720", srcUrl, 1280, 720, 2000, 30, [
    clipOf("c1", srcUrl, 0, 2000, { sourceInMs: 0, sourceOutMs: 2000, label: "720p" }),
  ]);
  const seq = sequentialTimes(wide);

  show("abort + fallback");
  let abort = { ok: false as boolean, error: null as string | null };
  {
    const opened = await createFrameSourceBackend("ailexsi").open(srcUrl);
    const ac = new AbortController();
    const p = (async () => {
      for await (const sample of opened.getFramesAt(seq, ac.signal)) sample?.close();
    })();
    ac.abort();
    try {
      await p;
      abort = { ok: false, error: "iterator finished after abort" };
    } catch (e) {
      abort = { ok: isAfeError(e) && e.code === "AFE_ABORTED", error: e instanceof Error ? e.message : String(e) };
    }
    opened.close();
  }
  let fallback = { ok: false as boolean, code: null as string | null };
  try {
    await createFrameSourceBackend("ailexsi").open(new URL("/tests/fixtures/afe/README.md", location.origin).href);
  } catch (e) {
    fallback = { ok: isAfeError(e) && e.code === "AFE_UNSUPPORTED_CONTAINER", code: isAfeError(e) ? e.code : null };
  }

  show("phase export");
  const mbPhase = await timed("ailexsi", { ...job, fileName: "afe-phase-a.mp4" });
  const afePhase = await timed("ailexsi", { ...job, fileName: "afe-phase.mp4" });

  show("raw 720");
  const mbRaw = await rawPass("ailexsi", srcUrl, seq);
  const afeRaw = await rawPass("ailexsi", srcUrl, seq);

  show("repeat " + WARMUP + "+" + MEASURED);
  const exportRepeats = await repeatBoth(job, WARMUP, MEASURED);
  await report("/afe-progress", {
    text:
      "repeats-done mb=" +
      JSON.stringify(exportRepeats.mediabunny?.measured) +
      " afe=" +
      JSON.stringify(exportRepeats.afe?.measured),
  });

  const longSeconds = Math.max(0, Number(qs.get("longSeconds") ?? 30));
  let longExport: unknown = { ran: false };
  if (longSeconds > 0) {
    show("long " + longSeconds + "s");
    longExport = {
      ran: true,
      seconds: longSeconds,
      ...(await repeatBoth(
        longJob(srcUrl, longSeconds),
        Math.max(0, Number(qs.get("longWarmup") ?? 6)),
        Math.max(1, Number(qs.get("longMeasured") ?? 10)),
        0x30e03,
      )),
    };
    await report("/afe-progress", {
      text: "long-done mb=" + JSON.stringify((longExport as { mediabunny?: { measured?: unknown } }).mediabunny?.measured) +
        " afe=" + JSON.stringify((longExport as { afe?: { measured?: unknown } }).afe?.measured),
    });
  }

  const productionJob = jobOf(
    "prod-like",
    srcUrl,
    1280,
    720,
    4000,
    30,
    [
      clipOf("p1", srcUrl, 0, 1000, { sourceInMs: 0, sourceOutMs: 1000, label: "head" }),
      clipOf("p2", srcUrl, 1000, 2000, { sourceInMs: 500, sourceOutMs: 1500, label: "cut" }),
      clipOf("p3", srcUrl, 2000, 3000, { sourceInMs: 0, sourceOutMs: 1000, label: "repeat" }),
      clipOf("p4", srcUrl, 3000, 4000, { sourceInMs: 0, sourceOutMs: 2000, rate: 2, label: "rate2" }),
    ],
  );
  const skipProd = qs.get("skipProd") === "1";
  show(skipProd ? "skip production-like" : "production-like");
  const productionExport = skipProd
    ? { ran: false }
    : { ran: true, ...(await repeatBoth(productionJob, 4, 8, 0x70d03)) };

  let crossfadeExport: unknown = { ran: false };
  if (!skipProd) {
    const xfJob = jobOf(
      "E",
      srcUrl,
      1280,
      720,
      1500,
      30,
      [
        clipOf("e1", srcUrl, 0, 900, { sourceInMs: 0, sourceOutMs: 900 }),
        clipOf("e2", srcUrl, 600, 1500, { sourceInMs: 200, sourceOutMs: 1100 }),
      ],
      {
        transitions: [
          {
            id: "xf",
            type: "crossfade",
            startMs: 600,
            durationMs: 300,
            sourceAClipId: "e1",
            sourceBClipId: "e2",
            audio: "cut",
            audioMode: "cut",
            audioDurationMs: 0,
          },
        ],
      },
    );
    show("crossfade E");
    crossfadeExport = { ran: true, ...(await repeatBoth(xfJob, 3, 6, 0xe0303)) };
  }

  const result = {
    environment: {
      userAgent: navigator.userAgent,
      webCodecs: typeof VideoDecoder !== "undefined",
      videoEncoder: typeof VideoEncoder !== "undefined",
      platform: navigator.platform,
    },
    prefetch: getAfeSequentialPrefetch(),
    abort,
    fallback,
    phaseExport: { ran: true, mediabunny: mbPhase, afe: afePhase, bothOk: Boolean(mbPhase.result.success && afePhase.result.success) },
    raw720: { ran: true, mediabunny: mbRaw, afe: afeRaw },
    exportRepeats: { ran: true, ...exportRepeats },
    longExport,
    productionExport,
    crossfadeExport,
    totals: { compared: 0, agree: 0, mediabunny: {}, afe: {} },
    mismatchCount: 0,
  };
  (window as unknown as { __AFE_RESULT: unknown }).__AFE_RESULT = result;
  show(
    "AFE_DONE export mb=" +
      JSON.stringify(exportRepeats.mediabunny?.measured) +
      " afe=" +
      JSON.stringify(exportRepeats.afe?.measured),
  );
  await report("/afe-results", result);
} catch (e) {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  show("AFE_FAIL " + msg);
  await report("/afe-results", { error: msg });
}
