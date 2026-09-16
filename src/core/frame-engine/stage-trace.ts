/**
 * STRESS-03 diagnostic only.
 *
 * Records the first awaited open/decode stages between a VIDEO frame request
 * and the first yielded sample. Does not change AFE scheduling, watermarks,
 * timeouts, reset/recreate, ENC-01, or STRESS-01 avcC patching.
 */

export const STRESS03_STAGE_NAMES = [
  "FRAME_REQUESTED",
  "CLIP_SELECTED",
  "SOURCE_RESOLVED",
  "OPEN_PREFERRED_BEGIN",
  "BACKEND_OPEN_BEGIN",
  "MP4_READ_BEGIN",
  "MP4_READ_DONE",
  "TRACK_PARSED",
  "DECODER_CREATE",
  "DECODER_CONFIGURE",
  "SAMPLE_SELECT",
  "TRANSACTION_BEGIN",
  "FRAME_READY",
] as const;

export type Stress03StageName = (typeof STRESS03_STAGE_NAMES)[number];

export type StageTraceContext = {
  timelineMs?: number | null;
  exportFrame?: number | null;
  clipId?: string | null;
  clipName?: string | null;
  sourceId?: string | null;
};

export type StageTraceEntry = {
  stage: Stress03StageName;
  timelineMs: number | null;
  exportFrame: number | null;
  clipId: string | null;
  clipName: string | null;
  sourceId: string | null;
  elapsedMs: number;
  atMs: number;
};

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function token(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  return String(value);
}

function roundElapsed(ms: number): string {
  return (Math.round(ms * 1000) / 1000).toString();
}

let context: StageTraceContext = {};
let requestOriginMs: number | null = null;
let entries: StageTraceEntry[] = [];

export function resetStageTrace(): void {
  context = {};
  requestOriginMs = null;
  entries = [];
}

export function setStageTraceContext(patch: StageTraceContext): void {
  context = { ...context, ...patch };
}

export function getStageTraceContext(): StageTraceContext {
  return { ...context };
}

export function markStage(stage: Stress03StageName, patch?: StageTraceContext): StageTraceEntry {
  if (patch) setStageTraceContext(patch);
  const atMs = nowMs();
  if (stage === "FRAME_REQUESTED") {
    entries = [];
    requestOriginMs = atMs;
  }
  const entry: StageTraceEntry = {
    stage,
    timelineMs: context.timelineMs ?? null,
    exportFrame: context.exportFrame ?? null,
    clipId: context.clipId ?? null,
    clipName: context.clipName ?? null,
    sourceId: context.sourceId ?? null,
    elapsedMs: requestOriginMs == null ? 0 : atMs - requestOriginMs,
    atMs,
  };
  /* Stray decoder/open marks from unit tests must not leak into stall dumps.
   * Export always starts a request with FRAME_REQUESTED. */
  if (requestOriginMs == null) return entry;
  const last = entries[entries.length - 1];
  if (last?.stage === stage) {
    entries[entries.length - 1] = entry;
    return entry;
  }
  entries.push(entry);
  return entry;
}

export function stageTraceEntries(): readonly StageTraceEntry[] {
  return entries;
}

/**
 * Last entered stage when FRAME_READY never arrived.
 * That is the first stage whose successor did not complete.
 */
export function firstBlockedStage(): Stress03StageName | null {
  if (entries.some((e) => e.stage === "FRAME_READY")) return null;
  if (entries.length === 0) return null;
  return entries[entries.length - 1]!.stage;
}

/** First required stage that has not been entered yet. */
export function nextExpectedStage(): Stress03StageName | null {
  const seen = new Set(entries.map((e) => e.stage));
  if (seen.has("FRAME_READY")) return null;
  for (const name of STRESS03_STAGE_NAMES) {
    if (!seen.has(name)) return name;
  }
  return null;
}

export function formatStageTraceForDump(): string {
  if (entries.length === 0) return "";
  const blocked = firstBlockedStage();
  const next = nextExpectedStage();
  const lines = [
    `firstBlockedStage ${blocked ?? "n/a"}`,
    `nextExpectedStage ${next ?? "n/a"}`,
    `stageCount ${entries.length}`,
  ];
  const trail = entries
    .map(
      (e) =>
        `${e.stage} elapsedMs ${roundElapsed(e.elapsedMs)} timelineMs ${token(e.timelineMs)} exportFrame ${token(e.exportFrame)} clipId ${token(e.clipId)} clipName ${token(e.clipName)} sourceId ${token(e.sourceId)}`,
    )
    .join(" | ");
  lines.push(`stageTrail ${trail}`);
  return lines.join("; ");
}

export function formatStageTraceLines(): string[] {
  const blocked = firstBlockedStage();
  const next = nextExpectedStage();
  const lines = [
    "STRESS-03 STAGE TRAIL",
    `firstBlockedStage ${blocked ?? "n/a"}`,
    `nextExpectedStage ${next ?? "n/a"}`,
    `stageCount ${entries.length}`,
  ];
  if (entries.length === 0) {
    lines.push("stageTrail (none)");
    return lines;
  }
  for (const e of entries) {
    lines.push(
      `${e.stage} elapsedMs ${roundElapsed(e.elapsedMs)} timelineMs ${token(e.timelineMs)} exportFrame ${token(e.exportFrame)} clipId ${token(e.clipId)} clipName ${token(e.clipName)} sourceId ${token(e.sourceId)}`,
    );
  }
  return lines;
}
