/**
 * STRESS-02 diagnostic only.
 *
 * Captures the original thrown value at the export boundary and on
 * window.onerror / unhandledrejection. Does not replace an Error's
 * .stack with a newly constructed Error. Does not swallow failures.
 * Does not change AFE scheduling, timeouts, queues, or encoder selection.
 */

import { ailexsiBuildIdentity, formatBuildIdentityLedger } from "../build-info";
import type { AfeStallSnapshot } from "../frame-engine";
import {
  firstBlockedStage,
  formatStageTraceForDump,
  formatStageTraceLines,
  nextExpectedStage,
  resetStageTrace,
} from "../frame-engine/stage-trace";
import type { ExportJob, ExportResult } from "./types";

export const EXPORT_FAIL_DUMP_TITLE = "STRESS-02 CALL-STACK DIAGNOSTIC";

export type CapturedThrown = {
  kind: "error" | "nonerror";
  name: string | null;
  message: string | null;
  /** Original Error.stack when present. Never a replacement stack. */
  stack: string | null;
  typeofValue: string;
  stringValue: string;
};

export type ExportFailContext = {
  productVersion?: string | null;
  gitSha?: string | null;
  branch?: string | null;
  exportFrame?: number | null;
  timelineMs?: number | null;
  fps?: number | null;
  resolution?: string | null;
  clipId?: string | null;
  clipName?: string | null;
  sourceId?: string | null;
  sourceInMs?: number | null;
  sourceOutMs?: number | null;
  pictureMode?: string | null;
  videoReq?: number | null;
  videoDec?: number | null;
  videoEnc?: number | null;
  afeFrames?: number | null;
  visFrames?: number | null;
  blackFrames?: number | null;
  decoderQueue?: number | null;
  encoderQueue?: number | null;
  transactionId?: number | null;
  requestedSample?: number | null;
  requestedPts?: number | null;
  stage?: string | null;
  firstBlockedStage?: string | null;
  nextExpectedStage?: string | null;
  stageTrail?: string | null;
};

const CONTEXT_FIELDS: Array<keyof ExportFailContext> = [
  "productVersion",
  "gitSha",
  "branch",
  "exportFrame",
  "timelineMs",
  "fps",
  "resolution",
  "clipId",
  "clipName",
  "sourceId",
  "sourceInMs",
  "sourceOutMs",
  "pictureMode",
  "videoReq",
  "videoDec",
  "videoEnc",
  "afeFrames",
  "visFrames",
  "blackFrames",
  "decoderQueue",
  "encoderQueue",
  "transactionId",
  "requestedSample",
  "requestedPts",
  "stage",
  "firstBlockedStage",
  "nextExpectedStage",
  "stageTrail",
];

let liveContext: ExportFailContext = {};
let lastCaptured: CapturedThrown | null = null;
let lastGlobalCaptured: CapturedThrown | null = null;
let handlersInstalled = false;
let previousOnError: OnErrorEventHandler | null = null;
let previousOnUnhandled: Window["onunhandledrejection"] | null = null;

function definedDiagToken(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0 && value !== "undefined") return value;
  return fallback;
}

export function diagnosticSourcemapEnabled(): boolean {
  return (
    definedDiagToken(
      typeof __AILEXSI_DIAG_SOURCEMAP__ !== "undefined" ? __AILEXSI_DIAG_SOURCEMAP__ : undefined,
      "0",
    ) === "1"
  );
}

export function isStackOverflowThrown(value: unknown): boolean {
  const msg = value instanceof Error ? value.message : String(value);
  if (/maximum call stack size exceeded/i.test(msg)) return true;
  if (/too much recursion/i.test(msg)) return true;
  if (/stack overflow/i.test(msg)) return true;
  return value instanceof RangeError && /call stack|recursion/i.test(msg);
}

export function captureThrownValue(value: unknown): CapturedThrown {
  if (value instanceof Error) {
    lastCaptured = {
      kind: "error",
      name: value.name || value.constructor?.name || "Error",
      message: typeof value.message === "string" ? value.message : String(value.message),
      stack: typeof value.stack === "string" ? value.stack : value.stack == null ? null : String(value.stack),
      typeofValue: "object",
      stringValue: String(value),
    };
    return lastCaptured;
  }
  lastCaptured = {
    kind: "nonerror",
    name: null,
    message: null,
    stack: null,
    typeofValue: typeof value,
    stringValue: String(value),
  };
  return lastCaptured;
}

export function lastCapturedThrown(): CapturedThrown | null {
  return lastCaptured;
}

export function lastGlobalExportFail(): CapturedThrown | null {
  return lastGlobalCaptured;
}

export function clearExportFailDiagnostics(): void {
  liveContext = {};
  lastCaptured = null;
  lastGlobalCaptured = null;
  resetStageTrace();
}

export function resetExportFailContext(): void {
  liveContext = {};
}

export function updateExportFailContext(patch: ExportFailContext): void {
  liveContext = { ...liveContext, ...patch };
}

export function getExportFailContext(): ExportFailContext {
  return { ...liveContext };
}

export function beginExportFailSession(job: ExportJob): void {
  resetStageTrace();
  const id = ailexsiBuildIdentity();
  liveContext = {
    productVersion: id.productVersion,
    gitSha: id.gitSha,
    branch: id.branch,
    fps: job.fps,
    resolution: `${job.width}x${job.height}`,
    timelineMs: job.startMs,
    exportFrame: 0,
    stage: "start",
  };
}

export function mergeStallSnapshotIntoExportFailContext(dump: Partial<AfeStallSnapshot>): void {
  updateExportFailContext({
    exportFrame: dump.exportFrameIndex ?? liveContext.exportFrame ?? null,
    timelineMs: dump.timelineMs ?? liveContext.timelineMs ?? null,
    fps: dump.fps ?? liveContext.fps ?? null,
    clipId: dump.sourceClipId ?? liveContext.clipId ?? null,
    clipName: dump.sourceClipLabel ?? liveContext.clipName ?? null,
    sourceId: dump.sourceUrlName ?? liveContext.sourceId ?? null,
    sourceInMs: dump.sourceInMs ?? liveContext.sourceInMs ?? null,
    sourceOutMs: dump.sourceOutMs ?? liveContext.sourceOutMs ?? null,
    pictureMode: dump.pictureKind ?? liveContext.pictureMode ?? null,
    videoReq: dump.videoFramesRequested ?? liveContext.videoReq ?? null,
    videoDec: dump.videoFramesDecoded ?? liveContext.videoDec ?? null,
    videoEnc: dump.videoFramesEncoded ?? liveContext.videoEnc ?? null,
    afeFrames: dump.afeFrames ?? liveContext.afeFrames ?? null,
    visFrames: dump.visFrames ?? liveContext.visFrames ?? null,
    blackFrames: dump.blackFrames ?? liveContext.blackFrames ?? null,
    decoderQueue: dump.decodeQueueSize ?? liveContext.decoderQueue ?? null,
    encoderQueue: dump.encoderEncodeQueueSize ?? liveContext.encoderQueue ?? null,
    transactionId: dump.transactionId ?? liveContext.transactionId ?? null,
    requestedSample: dump.sourceSampleRequested ?? dump.originRequestedSample ?? liveContext.requestedSample ?? null,
    requestedPts: dump.requestedPtsUs ?? dump.originRequestedPts ?? liveContext.requestedPts ?? null,
    firstBlockedStage: firstBlockedStage() ?? liveContext.firstBlockedStage ?? null,
    nextExpectedStage: nextExpectedStage() ?? liveContext.nextExpectedStage ?? null,
    stageTrail: formatStageTraceForDump(),
  });
}

function formatContextLines(context: ExportFailContext): string[] {
  const id = ailexsiBuildIdentity();
  const merged: ExportFailContext = {
    productVersion: context.productVersion ?? id.productVersion,
    gitSha: context.gitSha ?? id.gitSha,
    branch: context.branch ?? id.branch,
    ...context,
  };
  const lines: string[] = [];
  for (const key of CONTEXT_FIELDS) {
    const value = merged[key];
    if (value === undefined) continue;
    lines.push(`${key} ${value === null ? "n/a" : String(value)}`);
  }
  return lines;
}

export function formatExportFailDump(
  captured: CapturedThrown,
  context: ExportFailContext = getExportFailContext(),
): string {
  const lines: string[] = [
    EXPORT_FAIL_DUMP_TITLE,
    ...formatBuildIdentityLedger(),
    `sourcemapDiagnostic ${diagnosticSourcemapEnabled() ? "yes" : "no"}`,
  ];
  if (captured.kind === "error") {
    lines.push(`error.name ${captured.name ?? "n/a"}`);
    lines.push(`error.message ${captured.message ?? "n/a"}`);
    lines.push("error.stack");
    lines.push(captured.stack && captured.stack.length > 0 ? captured.stack : "(no stack on thrown Error)");
  } else {
    lines.push(`thrown.typeof ${captured.typeofValue}`);
    lines.push(`thrown.string ${captured.stringValue}`);
    lines.push("error.stack (not an Error — original stack unavailable)");
  }
  lines.push("--- export context ---");
  lines.push(...formatContextLines(context));
  lines.push("--- STRESS-03 stage trail ---");
  lines.push(...formatStageTraceLines());
  lines.push("--- operator ---");
  lines.push("Mark FIRST application frame (first src/ / app frame after WebView2/V8 natives).");
  lines.push("Mark FIRST repeated function/frame. Do not classify A–F until that stack exists.");
  return lines.join("\n");
}

export function exportResultFromCaughtThrow(job: ExportJob | undefined, thrown: unknown): ExportResult {
  const captured = captureThrownValue(thrown);
  return {
    success: false,
    aborted: false,
    error: formatExportFailDump(captured, getExportFailContext()),
    fileName: job?.fileName ?? "export.mp4",
    durationMs: job?.durationMs ?? 0,
    fileSizeBytes: 0,
  };
}

function recordGlobalThrown(value: unknown): void {
  lastGlobalCaptured = captureThrownValue(value);
}

function onWindowError(
  message: Event | string,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error,
): boolean {
  recordGlobalThrown(error ?? (typeof message === "string" ? message : "window.onerror"));
  if (typeof previousOnError === "function") {
    return previousOnError.call(window, message, source, lineno, colno, error) === true;
  }
  return false;
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  recordGlobalThrown(event.reason);
  if (typeof previousOnUnhandled === "function") {
    previousOnUnhandled.call(window, event);
  }
}

/** Reporting only. Never preventDefault / return true (do not swallow). */
export function installExportFailDiagnostics(): void {
  if (typeof window === "undefined" || handlersInstalled) return;
  previousOnError = window.onerror;
  previousOnUnhandled = window.onunhandledrejection;
  window.onerror = onWindowError;
  window.onunhandledrejection = onUnhandledRejection;
  handlersInstalled = true;
}

/** Test-only: restore previous handlers. */
export function uninstallExportFailDiagnostics(): void {
  if (typeof window === "undefined" || !handlersInstalled) return;
  window.onerror = previousOnError;
  window.onunhandledrejection = previousOnUnhandled;
  previousOnError = null;
  previousOnUnhandled = null;
  handlersInstalled = false;
}

export function exportFailDiagnosticsInstalled(): boolean {
  return handlersInstalled;
}
