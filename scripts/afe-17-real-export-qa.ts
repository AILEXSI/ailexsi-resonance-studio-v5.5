/**
 * MODE A Chrome harness: production exportWithWebCodecs on VIDEO→VIS→VIDEO.
 * Bundled by scripts/afe-17-run-real-export-qa.mjs — not a Vite HTML entry.
 */
import {
  clearFrameSources,
  getFrameSourceBackend,
  setFrameSourceBackend,
} from "../src/core/exporter/frame-source";
import { exportWithWebCodecs } from "../src/core/exporter/webcodecs";
import type { ExportJob, ExportProgress, ExportResult } from "../src/core/exporter/types";

const qs = new URLSearchParams(location.search);
const RECEIVE = "http://127.0.0.1:" + (qs.get("receive") || "18787");
const VIDEO = new URL(qs.get("video") || "/tests/fixtures/user-video.mp4", location.origin).href;
const AUDIO = new URL(qs.get("audio") || "/tests/fixtures/user-audio.mp3", location.origin).href;
const VARIANT = qs.get("variant") || "primary";

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

function clip(
  id: string,
  trackId: "V1" | "A1",
  kind: "video" | "audio",
  startMs: number,
  endMs: number,
  sourceUrl: string,
  sourceInMs: number,
  sourceOutMs: number,
) {
  return {
    id,
    trackId,
    kind,
    startMs,
    endMs,
    sourceUrl,
    sourceInMs,
    sourceOutMs,
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    rate: 1,
    missing: false,
    label: id === "vB" ? "user-video-B" : id === "vA" ? "user-video-A" : id,
  };
}

function buildJob(): ExportJob {
  const bIn = VARIANT === "b0" ? 0 : 2500;
  const bOut = VARIANT === "b0" ? 1500 : 4000;
  return {
    id: "afe-17-real-export-qa",
    projectId: "p",
    projectName: "afe-17-video-vis-video",
    startMs: 0,
    endMs: 4000,
    durationMs: 4000,
    width: 1280,
    height: 720,
    fps: 30,
    fileName: "afe-17-video-vis-video.mp4",
    tracks: [
      {
        id: "V1",
        kind: "video",
        pan: 0,
        clips: [
          clip("vA", "V1", "video", 0, 1500, VIDEO, 0, 1500),
          clip("vB", "V1", "video", 2500, 4000, VIDEO, bIn, bOut),
        ],
      },
      {
        id: "A1",
        kind: "audio",
        pan: 0,
        clips: [clip("a1", "A1", "audio", 0, 4000, AUDIO, 0, 4000)],
      },
    ],
    visualizer: {
      enabled: true,
      muted: false,
      sceneId: "spectrum-bars",
      startMs: 1500,
      durationMs: 1000,
    },
  };
}

function bytesFromBlob(blob: Blob): Promise<number[]> {
  return blob.arrayBuffer().then((buf) => Array.from(new Uint8Array(buf)));
}

async function main() {
  const job = buildJob();
  const idBefore = getFrameSourceBackend();
  setFrameSourceBackend("ailexsi");
  clearFrameSources();
  const idAfter = getFrameSourceBackend();
  const backend = {
    idBefore,
    labelBefore: idBefore === "ailexsi" ? "AILEXSI" : idBefore,
    idAfter,
    setExplicitly: "ailexsi",
    frameEngineOnly: idAfter === "ailexsi",
  };
  show(`export ${VARIANT} backend=${idAfter}`);
  let lastProgress: ExportProgress | null = null;
  const t0 = performance.now();
  let result: ExportResult;
  try {
    result = await exportWithWebCodecs(job, {
      onProgress: (p) => {
        lastProgress = p;
        if (p.currentTimeMs != null && p.currentTimeMs >= 2400) {
          show(
            `${p.stage} t=${p.currentTimeMs} req/dec/enc ${p.videoFramesRequested}/${p.videoFramesDecoded}/${p.videoFramesEncoded} vis ${p.visFramesEncoded}`,
          );
        }
      },
    });
  } catch (e) {
    result = {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      fileName: job.fileName,
      durationMs: job.durationMs,
      fileSizeBytes: 0,
    };
  }
  const wallMs = performance.now() - t0;
  const error = result.error ?? "";
  const stall = /AFE_DECODE_STALL/i.test(error);
  const banned = /nearest|snap|allowSkip|Mediabunny|HTMLVideo|paintFallback/i.test(error);
  const req = result.videoFramesRequested ?? lastProgress?.videoFramesRequested ?? null;
  const dec = result.videoFramesDecoded ?? lastProgress?.videoFramesDecoded ?? null;
  const enc = result.videoFramesEncoded ?? lastProgress?.videoFramesEncoded ?? null;
  const vis = result.visFramesEncoded ?? lastProgress?.visFramesEncoded ?? null;
  const black = result.blackFramesEncoded ?? lastProgress?.blackFramesEncoded ?? null;
  const chainOk = req != null && dec != null && enc != null && req === dec && dec === enc;
  const expectedVideo = 90;
  const expectedVis = 30;
  const pictureOk = req === expectedVideo && vis === expectedVis && (black ?? 0) === 0;
  const unresolvedMatch = /unresolvedRequested (\d+)/.exec(error);
  const unresolvedRequested = unresolvedMatch
    ? Number(unresolvedMatch[1])
    : result.success
      ? 0
      : null;
  const payload = {
    variant: VARIANT,
    success: result.success === true,
    error: result.error ?? null,
    stall,
    bannedLanguage: banned,
    wallMs,
    fileSizeBytes: result.fileSizeBytes ?? 0,
    brands: result.brands ?? null,
    audio: result.audio ?? null,
    videoFramesRequested: req,
    videoFramesDecoded: dec,
    videoFramesEncoded: enc,
    visFramesEncoded: vis,
    blackFramesEncoded: black,
    unresolvedRequested,
    chainOk,
    pictureOk,
    expectedVideo,
    expectedVis,
    backend,
    lastProgress,
    bytes: result.success && result.blob ? await bytesFromBlob(result.blob) : null,
  };
  show(result.success ? `OK ${result.fileSizeBytes} bytes` : `FAIL ${error.slice(0, 240)}`);
  await report("/afe-results", payload);
}

void main().catch(async (e) => {
  const msg = e instanceof Error ? e.message : String(e);
  show(`FAIL ${msg}`);
  await report("/afe-results", { success: false, error: msg, fileSizeBytes: 0 });
});
