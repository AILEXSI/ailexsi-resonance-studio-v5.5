import { encodeAac, mixJobAudio, probeAac, withTimeout, type AacProbe } from "./audio";
import { clearFrameSources, getDecoder, sourceTimeSec } from "./frame-source";
import { AfeError, isAfeError } from "../frame-engine";
import { afePerfAdd, afePerfEnabled, afePerfTimeAsync } from "../frame-engine/perf";
import { validateMp4Ftyp } from "./ftyp";
import { videoClipAt } from "./job";
import { clearMediaCache, isPlayableSource } from "./media";
import { clearStillCache, paintStillUrl } from "../still";
import { audioInputForMux, mp4HasAudioTrack, muxAvcToMp4, type AvcSample } from "./mp4";
import type { ExportClip, ExportHooks, ExportJob, ExportResult } from "./types";
import { videoAlphaAtClipTime } from "../fades";
import {
  compositeVideoAt,
  contextFromExportClips,
  layerAlpha,
  resolvePictureSource,
} from "../transition";
import { exportVisOf } from "./job";

export { compositeVideoAt as exportComposite } from "../transition";
import {
  visFeaturesForExport,
  type MixPcm,
  renderVisualizerScene,
  visualizerEventAt,
  visualizerEventsOf,
} from "../visualizer";

const AVC_CODEC = "avc1.42001f";

export function canUseWebCodecs(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof VideoEncoder.isConfigSupported === "function"
  );
}

export function webCodecsUnavailableMessage(): string {
  return "FAIL: WebCodecs unavailable. H.264 MP4 export requires VideoEncoder and VideoFrame. WebM is not a fallback.";
}

function fail(job: ExportJob, error: string, aborted = false): ExportResult {
  return {
    success: false,
    aborted,
    error,
    fileName: job.fileName,
    durationMs: job.durationMs,
    fileSizeBytes: 0,
  };
}

function aborted(job: ExportJob): ExportResult {
  return fail(job, "Export aborted", true);
}

function even(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}

function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = "#101318";
  ctx.fillRect(0, 0, width, height);
}

function exportPictureCtx(job: ExportJob) {
  const clips = job.tracks.filter((t) => t.kind === "video").flatMap((t) => t.clips);
  const front = job.frontVideoTrackId === "V1" ? "V1" : "V2";
  return contextFromExportClips(clips, job.transitions ?? [], front, exportVisOf(job));
}

function jobComposite(job: ExportJob, timeMs: number) {
  return compositeVideoAt(exportPictureCtx(job), timeMs);
}

function paintTransitionPlate(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  job: ExportJob,
  timeMs: number,
): void {
  const plate = jobComposite(job, timeMs).plate;
  if (!plate || plate.alpha <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * plate.alpha;
  ctx.fillStyle = plate.color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = prev;
}

function beginExportFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  job: ExportJob,
  timeMs: number,
): void {
  clearCanvas(ctx, width, height);
  paintTransitionPlate(ctx, width, height, job, timeMs);
}

function exportPaintAlpha(job: ExportJob, clip: ExportClip, timeMs: number): number {
  return exportClipVideoAlpha(clip, timeMs) * layerAlpha(jobComposite(job, timeMs), clip.id);
}

function paintVisualizer(
  ctx: CanvasRenderingContext2D,
  job: ExportJob,
  timeMs: number,
  dt: number,
  mix?: MixPcm | null,
): void {
  if (resolvePictureSource(exportPictureCtx(job), timeMs).kind !== "vis") return;
  const covering = visualizerEventAt(job.visualizer, timeMs);
  const sceneId = covering
    ? covering.sceneId
    : visualizerEventsOf(job.visualizer).length === 0
      ? job.visualizer.sceneId
      : undefined;
  if (!sceneId) return;
  const features = visFeaturesForExport(timeMs, job.durationMs, mix, {
    timelineOriginMs: job.startMs,
  });
  renderVisualizerScene(ctx, job.width, job.height, sceneId, features, dt);
}

type FrameRun = {
  clip: ExportClip | undefined;
  startIndex: number;
  count: number;
};

function groupFrameRuns(job: ExportJob, total: number, fps: number): FrameRun[] {
  const runs: FrameRun[] = [];
  let current: FrameRun | undefined;
  for (let i = 0; i < total; i++) {
    const clip = videoClipAt(job, (i / fps) * 1000);
    const id = clip?.id ?? "";
    if (current && (current.clip?.id ?? "") === id) {
      current.count += 1;
    } else {
      current = { clip, startIndex: i, count: 1 };
      runs.push(current);
    }
  }
  return runs;
}

function exportClipLocalMs(clip: ExportClip, timeMs: number): number {
  return timeMs - clip.startMs;
}

function exportClipVideoAlpha(clip: ExportClip, timeMs: number): number {
  return videoAlphaAtClipTime(
    {
      durationMs: Math.max(0, clip.endMs - clip.startMs),
      gain: clip.videoGain ?? clip.gain,
      fadeInMs: clip.fadeInMs,
      fadeOutMs: clip.fadeOutMs,
      fadeInFrom: clip.fadeInFrom,
      fadeOutTo: clip.fadeOutTo,
    },
    exportClipLocalMs(clip, timeMs),
  );
}

function withVideoClipAlpha(
  ctx: CanvasRenderingContext2D,
  job: ExportJob,
  clip: ExportClip,
  timeMs: number,
  draw: () => void,
): void {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * exportPaintAlpha(job, clip, timeMs);
  try {
    draw();
  } finally {
    ctx.globalAlpha = prev;
  }
}

function failAfe(job: ExportJob, error: unknown): ExportResult {
  if (isAfeError(error)) return fail(job, `FAIL: ${error.code}: ${error.message.replace(/^[A-Z0-9_]+:\s*/, "")}`);
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.startsWith("AFE_")) return fail(job, `FAIL: ${msg}`);
  return fail(job, msg.startsWith("FAIL:") || msg.startsWith("missing:") ? (msg.startsWith("missing:") ? `FAIL: ${msg}` : msg) : `FAIL: ${msg}`);
}

export async function exportWithWebCodecs(
  job: ExportJob,
  hooks: ExportHooks = {},
): Promise<ExportResult> {
  if (!canUseWebCodecs()) return fail(job, webCodecsUnavailableMessage());
  if (job.durationMs <= 0) return fail(job, "FAIL: empty export range");

  const width = even(job.width);
  const height = even(job.height);

  const supported = await VideoEncoder.isConfigSupported({
    codec: AVC_CODEC,
    width,
    height,
    bitrate: 3_000_000,
    framerate: job.fps,
    avc: { format: "avc" },
  });
  if (!supported.supported) {
    return fail(job, `FAIL: H.264 encoder not supported (${AVC_CODEC})`);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: false });
  if (!ctx) return fail(job, "FAIL: 2D canvas unavailable");

  hooks.onProgress?.({ percent: 4, stage: "Mixing audio" });
  let aacProbe: AacProbe | null = null;
  let mixed: AudioBuffer | null = null;
  try {
    aacProbe = await withTimeout(probeAac(), 4000, null);
  } catch {
    aacProbe = null;
  }
  const mixLayout = aacProbe ?? { sampleRate: 44100, channels: 2, bitrate: 128_000 };
  if (job.visualizer.enabled && !job.visualizer.muted) {
    try {
      mixed = await withTimeout(mixJobAudio(job, mixLayout, hooks.signal), 12000, null);
    } catch {
      mixed = null;
    }
  }

  hooks.onProgress?.({ percent: 6, stage: "Encoding H.264" });

  const samples: AvcSample[] = [];
  let description: Uint8Array | undefined;
  let encoderError: Error | undefined;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig?.description) {
        const desc = meta.decoderConfig.description;
        if (desc instanceof ArrayBuffer) description = new Uint8Array(desc);
        else if (ArrayBuffer.isView(desc)) {
          description = new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
        }
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({
        data,
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? Math.round(1_000_000 / job.fps),
        key: chunk.type === "key",
      });
    },
    error: (e) => {
      encoderError = e;
    },
  });

  encoder.configure({
    codec: AVC_CODEC,
    width,
    height,
    bitrate: 3_000_000,
    framerate: job.fps,
    avc: { format: "avc" },
    latencyMode: "quality",
    hardwareAcceleration: "prefer-software",
  });

  const frameCount = Math.max(1, Math.round((job.durationMs / 1000) * job.fps));
  const frameDurUs = Math.round(1_000_000 / job.fps);
  const dt = 1 / job.fps;
  const runs = groupFrameRuns(job, frameCount, job.fps);

  const waitForQueue = async () => {
    if (!afePerfEnabled()) {
      while (encoder.encodeQueueSize > 8) {
        await new Promise<void>((resolve) => {
          const done = () => {
            encoder.removeEventListener("dequeue", done);
            window.clearTimeout(timer);
            resolve();
          };
          const timer = window.setTimeout(done, 200);
          encoder.addEventListener("dequeue", done);
        });
      }
      return;
    }
    const t0 = performance.now();
    while (encoder.encodeQueueSize > 8) {
      await new Promise<void>((resolve) => {
        const done = () => {
          encoder.removeEventListener("dequeue", done);
          window.clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(done, 200);
        encoder.addEventListener("dequeue", done);
      });
    }
    afePerfAdd("videoEncoderWait", performance.now() - t0);
  };

  const encodeCanvas = async (i: number) => {
    const timeMs = (i / job.fps) * 1000;
    paintVisualizer(ctx, job, timeMs, dt, mixed);
    await waitForQueue();
    const frame = new VideoFrame(canvas, {
      timestamp: i * frameDurUs,
      duration: frameDurUs,
    });
    encoder.encode(frame, { keyFrame: i % (job.fps * 2) === 0 });
    frame.close();
  };

  const paintFallback = (i: number) => {
    const timeMs = (i / job.fps) * 1000;
    beginExportFrame(ctx, width, height, job, timeMs);
    paintVisualizer(ctx, job, timeMs, dt, mixed);
  };

  try {
    for (const run of runs) {
      if (hooks.signal?.aborted) throw new Error("Export aborted");
      if (encoderError) throw encoderError;
      const clip = run.clip;
      if (!clip || clip.missing || !isPlayableSource(clip.sourceUrl)) {
        for (let k = 0; k < run.count; k++) {
          if (hooks.signal?.aborted) throw new Error("Export aborted");
          const i = run.startIndex + k;
          hooks.onProgress?.({
            percent: Math.round((i / frameCount) * 80) + 8,
            stage: "Encoding H.264",
            currentTimeMs: (i / job.fps) * 1000,
          });
          paintFallback(i);
          await encodeCanvas(i);
        }
        continue;
      }

      const timestamps = Array.from({ length: run.count }, (_, k) =>
        sourceTimeSec(clip, ((run.startIndex + k) / job.fps) * 1000, job.fps),
      );

      let painted = 0;
      if (clip.still) {
        for (let k = 0; k < run.count; k++) {
          if (hooks.signal?.aborted) throw new Error("Export aborted");
          const i = run.startIndex + k;
          hooks.onProgress?.({
            percent: Math.round((i / frameCount) * 80) + 8,
            stage: "Encoding H.264",
            currentTimeMs: (i / job.fps) * 1000,
          });
          const timeMs = (i / job.fps) * 1000;
          beginExportFrame(ctx, width, height, job, timeMs);
          if (await paintStillUrl(ctx, canvas, clip.sourceUrl, exportPaintAlpha(job, clip, timeMs))) {
            painted += 1;
          } else {
            paintFallback(i);
          }
          await encodeCanvas(i);
        }
        if (painted === 0) throw new Error(`missing:${clip.label}`);
        continue;
      }
      let decoded;
      try {
        decoded = await withTimeout(getDecoder(clip.sourceUrl, hooks.signal), 20000, null);
      } catch (e) {
        if (isAfeError(e) && e.code === "AFE_ABORTED") throw e;
        if (isAfeError(e)) throw e;
        throw e;
      }
      if (!decoded) {
        throw new AfeError("AFE_DECODE_FAILED", `timed out opening ${clip.label}`);
      }
      let k = 0;
      try {
        for await (const sample of decoded.samplesAtTimestamps(timestamps, hooks.signal)) {
          if (hooks.signal?.aborted) throw new Error("Export aborted");
          if (encoderError) throw encoderError;
          const i = run.startIndex + k;
          hooks.onProgress?.({
            percent: Math.round((i / frameCount) * 80) + 8,
            stage: "Encoding H.264",
            currentTimeMs: (i / job.fps) * 1000,
          });
          const timeMs = (i / job.fps) * 1000;
          const loop0 = afePerfEnabled() ? performance.now() : 0;
          beginExportFrame(ctx, width, height, job, timeMs);
          if (loop0) afePerfAdd("exportLoopOverhead", performance.now() - loop0);
          if (sample) {
            withVideoClipAlpha(ctx, job, clip, timeMs, () => {
              sample.drawWithFit(ctx, { fit: "contain" });
            });
            sample.close();
            painted += 1;
          } else {
            paintFallback(i);
          }
          await encodeCanvas(i);
          k += 1;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/abort/i.test(msg) || (isAfeError(e) && e.code === "AFE_ABORTED")) throw e;
        if (isAfeError(e)) throw e;
        throw new AfeError("AFE_DECODE_FAILED", msg);
      }
      if (k < run.count) {
        throw new AfeError("AFE_DECODE_FAILED", `incomplete frame run for ${clip.label}`);
      }

      if (painted === 0) {
        throw new Error(`missing:${clip.label}`);
      }
    }

    await afePerfTimeAsync("videoEncoderWait", () => encoder.flush());
    encoder.close();
  } catch (e) {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
    clearFrameSources();
    clearMediaCache();
    clearStillCache();
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg) || (isAfeError(e) && e.code === "AFE_ABORTED")) {
      return aborted(job);
    }
    if (isAfeError(e) || msg.startsWith("AFE_")) return failAfe(job, e);
    const prefixed = msg.startsWith("FAIL:") || msg.startsWith("missing:") ? msg : `FAIL: ${msg}`;
    return fail(job, prefixed.startsWith("missing:") ? `FAIL: ${prefixed}` : prefixed);
  }

  clearFrameSources();
  clearMediaCache();
  clearStillCache();

  if (hooks.signal?.aborted) return aborted(job);
  if (!description) return fail(job, "FAIL: encoder did not emit AVC description");
  if (samples.length === 0) return fail(job, "FAIL: encoder produced no samples");

  hooks.onProgress?.({ percent: 90, stage: "Encoding AAC" });
  let audioTrack: Parameters<typeof muxAvcToMp4>[0]["audio"];
  let audioKind: "aac" | "none" = "none";
  try {
    const aacProbe = await withTimeout(probeAac(), 4000, null);
    if (aacProbe) {
      if (!mixed) {
        mixed = await withTimeout(mixJobAudio(job, aacProbe, hooks.signal), 12000, null);
      }
      if (mixed) {
        const encoded = await withTimeout(encodeAac(mixed, aacProbe, hooks), 12000, null);
        audioTrack = audioInputForMux(encoded, aacProbe);
        if (audioTrack) audioKind = "aac";
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (hooks.signal?.aborted || /abort/i.test(msg)) return aborted(job);
    audioKind = "none";
  }

  if (hooks.signal?.aborted) return aborted(job);
  hooks.onProgress?.({ percent: 95, stage: "Muxing MP4" });
  let bytes: Uint8Array;
  try {
    const mux0 = afePerfEnabled() ? performance.now() : 0;
    bytes = muxAvcToMp4({
      width,
      height,
      fps: job.fps,
      description,
      samples,
      audio: audioTrack,
    });
    if (mux0) afePerfAdd("mux", performance.now() - mux0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(job, `FAIL: mux ${msg}`);
  }

  const check = validateMp4Ftyp(bytes);
  if (!check.ok) return fail(job, `FAIL: ${check.error}`);
  if (audioKind === "aac" && !mp4HasAudioTrack(bytes)) {
    audioKind = "none";
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "video/mp4" });
  hooks.onProgress?.({ percent: 100, stage: "Done" });
  return {
    success: true,
    fileName: job.fileName,
    durationMs: job.durationMs,
    fileSizeBytes: blob.size,
    mimeType: "video/mp4",
    blob,
    brands: check.brands,
    audio: audioKind,
  };
}
