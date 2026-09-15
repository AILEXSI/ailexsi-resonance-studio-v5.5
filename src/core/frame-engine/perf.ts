/**
 * Local AFE-02 benchmark telemetry. Not user/product telemetry.
 * Disabled unless beginAfePerf() is called. Cheap no-ops when off.
 */

export type AfePerfBackend = "ailexsi";

export const AFE_PERF_PHASES = [
  "sourceOpen",
  "containerParse",
  "sampleTableBuild",
  "keyframeLookup",
  "decoderCreate",
  "decoderConfigure",
  "encodedSampleRead",
  "videoDecode",
  "decodeQueueWait",
  "frameCacheLookup",
  "videoFrameHandoff",
  "frameCopyClone",
  "canvasDraw",
  "frameClose",
  "schedulerOverhead",
  "exportLoopOverhead",
  "videoEncoderWait",
  "mux",
  "cleanup",
] as const;

export type AfePerfPhase = (typeof AFE_PERF_PHASES)[number];

export const AFE_PERF_COUNTS = [
  "decoderCreates",
  "decoderConfigures",
  "decoderResets",
  "decoderFlushes",
  "encodedSamplesRead",
  "encodedChunksSubmitted",
  "framesDecoded",
  "framesYielded",
  "decodeSpanCalls",
  "cacheLookups",
  "cacheHits",
  "cacheMisses",
  "cacheEvictions",
  "duplicateDecodes",
  "videoFrameClones",
  "videoFrameCreates",
  "framesClosed",
  "keyframeLookups",
  "sampleIndexLookups",
  "sampleByteSlices",
  "readyImmediate",
  "framePromiseWaits",
  "streamPathFrames",
  "randomPathFrames",
  "inFlightPeak",
  "prefetchWindow",
] as const;

export type AfePerfCount = (typeof AFE_PERF_COUNTS)[number];

export type AfePerfPhaseMs = Record<AfePerfPhase, number>;
export type AfePerfCounts = Record<AfePerfCount, number>;

export interface AfePerfSnapshot {
  backend: AfePerfBackend;
  enabled: boolean;
  wallMs: number;
  phasesMs: AfePerfPhaseMs;
  counts: AfePerfCounts;
}

function emptyPhases(): AfePerfPhaseMs {
  return {
    sourceOpen: 0,
    containerParse: 0,
    sampleTableBuild: 0,
    keyframeLookup: 0,
    decoderCreate: 0,
    decoderConfigure: 0,
    encodedSampleRead: 0,
    videoDecode: 0,
    decodeQueueWait: 0,
    frameCacheLookup: 0,
    videoFrameHandoff: 0,
    frameCopyClone: 0,
    canvasDraw: 0,
    frameClose: 0,
    schedulerOverhead: 0,
    exportLoopOverhead: 0,
    videoEncoderWait: 0,
    mux: 0,
    cleanup: 0,
  };
}

function emptyCounts(): AfePerfCounts {
  return {
    decoderCreates: 0,
    decoderConfigures: 0,
    decoderResets: 0,
    decoderFlushes: 0,
    encodedSamplesRead: 0,
    encodedChunksSubmitted: 0,
    framesDecoded: 0,
    framesYielded: 0,
    decodeSpanCalls: 0,
    cacheLookups: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEvictions: 0,
    duplicateDecodes: 0,
    videoFrameClones: 0,
    videoFrameCreates: 0,
    framesClosed: 0,
    keyframeLookups: 0,
    sampleIndexLookups: 0,
    sampleByteSlices: 0,
    readyImmediate: 0,
    framePromiseWaits: 0,
    streamPathFrames: 0,
    randomPathFrames: 0,
    inFlightPeak: 0,
    prefetchWindow: 0,
  };
}

interface Session {
  backend: AfePerfBackend;
  started: number;
  phases: AfePerfPhaseMs;
  counts: AfePerfCounts;
  decodedOnce: Set<number>;
}

let session: Session | null = null;
let probeInstalled = false;
let origVideoDecoder: typeof VideoDecoder | undefined;
let origVideoFrameClone: ((this: VideoFrame) => VideoFrame) | undefined;
let origVideoDecoderProto: {
  configure: VideoDecoder["configure"];
  reset: VideoDecoder["reset"];
  flush: VideoDecoder["flush"];
  decode: VideoDecoder["decode"];
  close: VideoDecoder["close"];
} | null = null;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function afePerfEnabled(): boolean {
  return session != null;
}

export function beginAfePerf(backend: AfePerfBackend): void {
  session = {
    backend,
    started: now(),
    phases: emptyPhases(),
    counts: emptyCounts(),
    decodedOnce: new Set(),
  };
}

export function endAfePerf(): AfePerfSnapshot | null {
  if (!session) return null;
  const snap: AfePerfSnapshot = {
    backend: session.backend,
    enabled: true,
    wallMs: now() - session.started,
    phasesMs: { ...session.phases },
    counts: { ...session.counts },
  };
  session = null;
  return snap;
}

export function peekAfePerf(): AfePerfSnapshot | null {
  if (!session) return null;
  return {
    backend: session.backend,
    enabled: true,
    wallMs: now() - session.started,
    phasesMs: { ...session.phases },
    counts: { ...session.counts },
  };
}

export function afePerfAdd(phase: AfePerfPhase, ms: number): void {
  if (!session || !(ms > 0)) return;
  session.phases[phase] += ms;
}

export function afePerfCount(field: AfePerfCount, n = 1): void {
  if (!session || n === 0) return;
  session.counts[field] += n;
}

export function afePerfMax(field: AfePerfCount, n: number): void {
  if (!session) return;
  if (n > session.counts[field]) session.counts[field] = n;
}

export function afePerfMarkDecoded(sampleIndex: number): void {
  if (!session) return;
  if (session.decodedOnce.has(sampleIndex)) {
    session.counts.duplicateDecodes += 1;
  } else {
    session.decodedOnce.add(sampleIndex);
  }
}

export function afePerfTime<T>(phase: AfePerfPhase, fn: () => T): T {
  if (!session) return fn();
  const t0 = now();
  try {
    return fn();
  } finally {
    session.phases[phase] += now() - t0;
  }
}

export async function afePerfTimeAsync<T>(phase: AfePerfPhase, fn: () => Promise<T>): Promise<T> {
  if (!session) return fn();
  const t0 = now();
  try {
    return await fn();
  } finally {
    session.phases[phase] += now() - t0;
  }
}

/** Wrap VideoDecoder / VideoFrame.clone so AFE counters stay accurate. */
export function installWebCodecsProbe(): void {
  if (probeInstalled) return;
  if (typeof VideoDecoder === "undefined") return;
  probeInstalled = true;
  origVideoDecoder = VideoDecoder;
  origVideoDecoderProto = {
    configure: VideoDecoder.prototype.configure,
    reset: VideoDecoder.prototype.reset,
    flush: VideoDecoder.prototype.flush,
    decode: VideoDecoder.prototype.decode,
    close: VideoDecoder.prototype.close,
  };

  const Orig = VideoDecoder;
  function PatchedVideoDecoder(this: VideoDecoder, init: VideoDecoderInit) {
    afePerfCount("decoderCreates");
    const t0 = now();
    const inst = new Orig(init);
    afePerfAdd("decoderCreate", now() - t0);
    return inst;
  }
  PatchedVideoDecoder.prototype = Orig.prototype;
  PatchedVideoDecoder.isConfigSupported = Orig.isConfigSupported.bind(Orig);
  Object.defineProperty(PatchedVideoDecoder, "name", { value: "VideoDecoder" });
  (globalThis as { VideoDecoder: typeof VideoDecoder }).VideoDecoder =
    PatchedVideoDecoder as unknown as typeof VideoDecoder;

  VideoDecoder.prototype.configure = function configure(config: VideoDecoderConfig) {
    afePerfCount("decoderConfigures");
    return afePerfTime("decoderConfigure", () => origVideoDecoderProto!.configure.call(this, config));
  };
  VideoDecoder.prototype.reset = function reset() {
    afePerfCount("decoderResets");
    return origVideoDecoderProto!.reset.call(this);
  };
  VideoDecoder.prototype.flush = function flush() {
    afePerfCount("decoderFlushes");
    return afePerfTimeAsync("decodeQueueWait", () => origVideoDecoderProto!.flush.call(this));
  };
  VideoDecoder.prototype.decode = function decode(chunk: EncodedVideoChunk) {
    afePerfCount("encodedChunksSubmitted");
    return afePerfTime("videoDecode", () => origVideoDecoderProto!.decode.call(this, chunk));
  };

  if (typeof VideoFrame !== "undefined" && VideoFrame.prototype.clone) {
    origVideoFrameClone = VideoFrame.prototype.clone;
    VideoFrame.prototype.clone = function clone() {
      afePerfCount("videoFrameClones");
      return afePerfTime("frameCopyClone", () => origVideoFrameClone!.call(this));
    };
  }
}

export function uninstallWebCodecsProbe(): void {
  if (!probeInstalled || !origVideoDecoder || !origVideoDecoderProto) return;
  VideoDecoder.prototype.configure = origVideoDecoderProto.configure;
  VideoDecoder.prototype.reset = origVideoDecoderProto.reset;
  VideoDecoder.prototype.flush = origVideoDecoderProto.flush;
  VideoDecoder.prototype.decode = origVideoDecoderProto.decode;
  VideoDecoder.prototype.close = origVideoDecoderProto.close;
  (globalThis as { VideoDecoder: typeof VideoDecoder }).VideoDecoder = origVideoDecoder;
  if (origVideoFrameClone && typeof VideoFrame !== "undefined") {
    VideoFrame.prototype.clone = origVideoFrameClone;
  }
  origVideoDecoder = undefined;
  origVideoDecoderProto = null;
  origVideoFrameClone = undefined;
  probeInstalled = false;
}

export function afePerfProbeInstalled(): boolean {
  return probeInstalled;
}

export function summarizePhases(snap: AfePerfSnapshot): { phase: AfePerfPhase; ms: number; pct: number }[] {
  const total = AFE_PERF_PHASES.reduce((n, p) => n + snap.phasesMs[p], 0);
  return AFE_PERF_PHASES.map((phase) => ({
    phase,
    ms: snap.phasesMs[phase],
    pct: total > 0 ? (snap.phasesMs[phase] / total) * 100 : 0,
  })).sort((a, b) => b.ms - a.ms);
}
