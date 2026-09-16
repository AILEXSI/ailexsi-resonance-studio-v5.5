import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_STALL_MS,
  STRESS03_STAGE_NAMES,
  firstBlockedStage,
  formatStallMessage,
  formatStageTraceForDump,
  formatStageTraceLines,
  markStage,
  nextExpectedStage,
  resetStageTrace,
  sampleIndexAtTime,
  setStageTraceContext,
  stageTraceEntries,
} from "../../src/core/frame-engine";
import {
  beginExportFailSession,
  clearExportFailDiagnostics,
  EXPORT_FAIL_DUMP_TITLE,
  exportResultFromCaughtThrow,
  failExportDialog,
  formatExportFailDump,
  openExportDialog,
} from "../../src/core/exporter";
import type { ExportJob } from "../../src/core/exporter/types";

const HUMAN = {
  originTimelineMs: 168733.3333333333,
  originExportFrame: 5062,
  clipName: "1000001827 - Kopie.mp4",
  sourceInMs: 0,
  sourceOutMs: 5208,
  fps: 30,
  videoReq: 5063,
  videoDec: 5062,
  videoEnc: 5062,
};

function job(partial: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "stress-03",
    projectId: "p",
    projectName: "stress-03",
    startMs: 0,
    endMs: 1_500_000,
    durationMs: 1_500_000,
    width: 1920,
    height: 1080,
    fps: 30,
    fileName: "stress-03.mp4",
    tracks: [
      {
        id: "V1",
        kind: "video",
        pan: 0,
        clips: [
          {
            id: "clip-k",
            trackId: "V1",
            kind: "video",
            startMs: HUMAN.originTimelineMs,
            endMs: HUMAN.originTimelineMs + HUMAN.sourceOutMs,
            sourceUrl: "blob:stress-03",
            sourceInMs: HUMAN.sourceInMs,
            sourceOutMs: HUMAN.sourceOutMs,
            gain: 1,
            fadeInMs: 0,
            fadeOutMs: 0,
            rate: 1,
            missing: false,
            label: HUMAN.clipName,
          },
        ],
      },
    ],
    visualizer: { enabled: false, muted: true, sceneId: "spectrum-bars" },
    ...partial,
  };
}

afterEach(() => {
  resetStageTrace();
  clearExportFailDiagnostics();
});

describe("STRESS-03 stage-trace instrumentation", () => {
  it("A. required stage names are exact and first-blocked is last entered without FRAME_READY", () => {
    expect(STRESS03_STAGE_NAMES).toEqual([
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
    ]);
    setStageTraceContext({
      timelineMs: HUMAN.originTimelineMs,
      exportFrame: HUMAN.originExportFrame,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    for (const stage of [
      "FRAME_REQUESTED",
      "CLIP_SELECTED",
      "SOURCE_RESOLVED",
      "OPEN_PREFERRED_BEGIN",
      "BACKEND_OPEN_BEGIN",
      "MP4_READ_BEGIN",
      "MP4_READ_DONE",
      "TRACK_PARSED",
    ] as const) {
      markStage(stage);
    }
    expect(firstBlockedStage()).toBe("TRACK_PARSED");
    expect(nextExpectedStage()).toBe("DECODER_CREATE");
    const dump = formatStageTraceForDump();
    expect(dump).toContain("firstBlockedStage TRACK_PARSED");
    expect(dump).toContain("nextExpectedStage DECODER_CREATE");
    expect(dump).toContain("FRAME_REQUESTED");
    expect(dump).toContain("TRACK_PARSED");
    expect(dump).not.toContain("DECODER_CREATE elapsedMs");
    expect(dump).not.toMatch(/nearest|snap|dup|paintFallback|allowSkip|ffmpeg|WASM|Mediabunny/i);
    expect(AFE_DECODE_STALL_MS).toBe(3000);
  });

  it("B. SAMPLE_SELECT entered without DECODER_CREATE reports SAMPLE_SELECT as first blocked", () => {
    markStage("FRAME_REQUESTED", {
      timelineMs: HUMAN.originTimelineMs,
      exportFrame: HUMAN.originExportFrame,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    markStage("CLIP_SELECTED");
    markStage("SOURCE_RESOLVED");
    markStage("SAMPLE_SELECT");
    expect(firstBlockedStage()).toBe("SAMPLE_SELECT");
    expect(nextExpectedStage()).toBe("OPEN_PREFERRED_BEGIN");
    expect(formatStageTraceForDump()).toContain("firstBlockedStage SAMPLE_SELECT");
  });

  it("C. FRAME_READY clears first-blocked (request completed)", () => {
    markStage("FRAME_REQUESTED");
    markStage("CLIP_SELECTED");
    markStage("SOURCE_RESOLVED");
    markStage("SAMPLE_SELECT");
    markStage("TRANSACTION_BEGIN");
    markStage("FRAME_READY");
    expect(firstBlockedStage()).toBeNull();
    expect(nextExpectedStage()).toBeNull();
    expect(formatStageTraceForDump()).toContain("firstBlockedStage n/a");
  });

  it("D. FRAME_REQUESTED resets the trail for the next export frame", () => {
    markStage("FRAME_REQUESTED", { exportFrame: 1, clipId: "a" });
    markStage("CLIP_SELECTED");
    markStage("FRAME_REQUESTED", { exportFrame: 2, clipId: "b" });
    expect(stageTraceEntries().map((e) => e.stage)).toEqual(["FRAME_REQUESTED"]);
    expect(stageTraceEntries()[0]?.exportFrame).toBe(2);
    expect(firstBlockedStage()).toBe("FRAME_REQUESTED");
  });

  it("E. stall dump and export-fail dump surface the trail (scrollable failed-status, not console-only)", () => {
    markStage("FRAME_REQUESTED", {
      timelineMs: HUMAN.originTimelineMs,
      exportFrame: HUMAN.originExportFrame,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    markStage("CLIP_SELECTED");
    markStage("SOURCE_RESOLVED");
    markStage("OPEN_PREFERRED_BEGIN");
    const stall = formatStallMessage({
      originTimelineMs: HUMAN.originTimelineMs,
      originExportFrame: HUMAN.originExportFrame,
      originClipLabel: HUMAN.clipName,
      sourceInMs: HUMAN.sourceInMs,
      sourceOutMs: HUMAN.sourceOutMs,
      videoFramesRequested: HUMAN.videoReq,
      videoFramesDecoded: HUMAN.videoDec,
      videoFramesEncoded: HUMAN.videoEnc,
      sourceSampleRequested: null,
      requestedPtsUs: null,
      lastSubmittedSample: null,
      transactionId: 0,
      decodeQueueSize: 0,
      lastDecodedTimestamp: null,
      gopKeyframeStart: null,
      openedRequestedVideoFrames: 0,
      unresolvedRequestedVideoFrames: 0,
      streamPtsPending: 0,
      streamReadySize: 0,
      stalledMs: 3000,
    });
    expect(stall).toContain("firstBlockedStage OPEN_PREFERRED_BEGIN");
    expect(stall).toContain("nextExpectedStage BACKEND_OPEN_BEGIN");
    expect(stall).toContain("stageTrail");
    expect(stall).toContain("CLIP_SELECTED");
    expect(stall).toContain(`timelineMs ${HUMAN.originTimelineMs}`);
    expect(stall).toContain("exportFrame 5062");
    expect(stall).toContain("clipName 1000001827 - Kopie.mp4");
    expect(stall).toContain("stalledMs 3000");
    expect(stall).not.toMatch(/nearest|snap|dup|paintFallback|allowSkip|ffmpeg|WASM|Mediabunny/i);

    beginExportFailSession(job());
    markStage("FRAME_REQUESTED", {
      timelineMs: HUMAN.originTimelineMs,
      exportFrame: HUMAN.originExportFrame,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    markStage("CLIP_SELECTED");
    const captured = {
      kind: "error" as const,
      name: "AfeError",
      message: "AFE_DECODE_STALL",
      stack: "AfeError: AFE_DECODE_STALL",
      typeofValue: "object",
      stringValue: "AfeError: AFE_DECODE_STALL",
    };
    const failDump = formatExportFailDump(captured);
    expect(failDump).toContain(EXPORT_FAIL_DUMP_TITLE);
    expect(failDump).toContain("STRESS-03 STAGE TRAIL");
    expect(failDump).toContain("firstBlockedStage CLIP_SELECTED");
    expect(failDump).toContain("CLIP_SELECTED elapsedMs");

    const result = exportResultFromCaughtThrow(job(), new Error("AFE_DECODE_STALL"));
    const failed = failExportDialog(
      openExportDialog({ fileName: "stress-03.mp4", width: 1920, height: 1080, fps: 30 }),
      result.error ?? "",
    );
    expect(failed.phase).toBe("failed");
    expect(failed.error).toContain("STRESS-03 STAGE TRAIL");
    expect(failed.error).toContain("firstBlockedStage");
  });

  it("F. every recorded stage carries timelineMs exportFrame clipId clipName sourceId elapsedMs", () => {
    markStage("FRAME_REQUESTED", {
      timelineMs: HUMAN.originTimelineMs,
      exportFrame: HUMAN.originExportFrame,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    markStage("CLIP_SELECTED");
    const entry = stageTraceEntries()[1];
    expect(entry).toMatchObject({
      stage: "CLIP_SELECTED",
      timelineMs: HUMAN.originTimelineMs,
      exportFrame: HUMAN.originExportFrame,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    expect(entry?.elapsedMs).toBeGreaterThanOrEqual(0);
    const lines = formatStageTraceLines();
    expect(lines[0]).toBe("STRESS-03 STAGE TRAIL");
    expect(lines.some((l) => l.includes("elapsedMs") && l.includes("timelineMs") && l.includes("exportFrame"))).toBe(
      true,
    );
  });

  it("G. human dump shape is pre-transaction (transactionId 0 / requestedSample n/a) — not STRESS-01 exact-PTS", () => {
    const text = formatStallMessage({
      originTimelineMs: HUMAN.originTimelineMs,
      originExportFrame: HUMAN.originExportFrame,
      originClipLabel: HUMAN.clipName,
      sourceInMs: HUMAN.sourceInMs,
      sourceOutMs: HUMAN.sourceOutMs,
      sourceSampleRequested: null,
      requestedPtsUs: null,
      lastSubmittedSample: null,
      transactionId: 0,
      decodeQueueSize: 0,
      lastDecodedTimestamp: null,
      gopKeyframeStart: null,
      openedRequestedVideoFrames: 0,
      unresolvedRequestedVideoFrames: 0,
      streamPtsPending: 0,
      streamReadySize: 0,
      videoFramesRequested: HUMAN.videoReq,
      videoFramesDecoded: HUMAN.videoDec,
      videoFramesEncoded: HUMAN.videoEnc,
      stalledMs: 3000,
    });
    expect(text).toContain("requested sample null PTS null");
    expect(text).toContain("transactionId 0");
    expect(text).toContain("videoReq 5063");
    expect(text).toContain("sourceInMs 0");
    expect(text).toContain("sourceOutMs 5208");
    expect(text).not.toContain("requested sample 3 PTS 100000");
    expect(AFE_DECODE_STALL_MS).toBe(3000);
  });

  it("H. SAMPLE_SELECT clamps t>=0 before first composition PTS to the first sample (STRESS-03)", () => {
    const movie = {
      timescale: 12288,
      editListOffset: 0,
      presentation: [
        { index: 0, ptsTimescale: 1024 },
        { index: 2, ptsTimescale: 1536 },
        { index: 1, ptsTimescale: 2048 },
      ],
    } as never;
    expect(sampleIndexAtTime(movie, 0.016666666666666666)).toBe(0);
    expect(sampleIndexAtTime(movie, 0)).toBe(0);
    expect(sampleIndexAtTime(movie, 0.083333)).toBe(0);
    expect(sampleIndexAtTime(movie, -0.001)).toBeNull();
    markStage("FRAME_REQUESTED", {
      timelineMs: HUMAN.originTimelineMs,
      exportFrame: HUMAN.originExportFrame,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    markStage("CLIP_SELECTED");
    markStage("SOURCE_RESOLVED");
    markStage("SAMPLE_SELECT");
    expect(firstBlockedStage()).toBe("SAMPLE_SELECT");
    expect(nextExpectedStage()).toBe("OPEN_PREFERRED_BEGIN");
  });
});
