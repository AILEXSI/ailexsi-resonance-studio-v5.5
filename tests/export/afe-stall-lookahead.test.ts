import { describe, expect, it } from "vitest";
import {
  AFE_DECODE_STALL_MS,
  formatStallMessage,
  legacyPumpSubmitEnd,
  pumpSubmitEnd,
  streamLookaheadSamples,
} from "../../src/core/frame-engine";

describe("AFE-05 B-frame submit-ahead (deadlock math)", () => {
  it("lookahead is prefetch-only when there is no reorder", () => {
    expect(streamLookaheadSamples(0, 4)).toBe(4);
    expect(streamLookaheadSamples(0, 1)).toBe(1);
  });

  it("lookahead is more than +1 once CTTS reorder exists", () => {
    expect(streamLookaheadSamples(1, 4)).toBeGreaterThan(1);
    expect(streamLookaheadSamples(2, 4)).toBeGreaterThanOrEqual(6);
    expect(streamLookaheadSamples(8, 4)).toBeGreaterThanOrEqual(9);
    expect(streamLookaheadSamples(16, 4)).toBeLessThanOrEqual(16);
  });

  it("legacy +1 / prefetch-4 pump deadlocks when decoder needs N+k", () => {
    const hold = 8;
    const legacy = legacyPumpSubmitEnd({
      requested: 10,
      last: 80,
      nextDecode: 10,
      sampleCount: 120,
      prefetch: 4,
      maxReorderSamples: 8,
      pendingOutputCount: 0,
    });
    expect(legacy).toBeLessThan(10 + hold);
  });

  it("new pump submits enough future decode-order samples before waiting", () => {
    const hold = 8;
    const end = pumpSubmitEnd({
      requested: 10,
      last: 80,
      nextDecode: 10,
      sampleCount: 120,
      prefetch: 4,
      maxReorderSamples: 8,
      pendingOutputCount: 0,
    });
    expect(end).toBeGreaterThanOrEqual(10 + hold);
  });

  it("end-of-window submits past last requested sample (not just +1)", () => {
    const legacy = legacyPumpSubmitEnd({
      requested: 20,
      last: 20,
      nextDecode: 20,
      sampleCount: 60,
      prefetch: 4,
      maxReorderSamples: 8,
      pendingOutputCount: 0,
    });
    const next = pumpSubmitEnd({
      requested: 20,
      last: 20,
      nextDecode: 20,
      sampleCount: 60,
      prefetch: 4,
      maxReorderSamples: 8,
      pendingOutputCount: 0,
    });
    expect(legacy).toBe(20);
    expect(next).toBeGreaterThan(21);
  });

  it("pendingOutputCount cannot block the required lookahead window", () => {
    const end = pumpSubmitEnd({
      requested: 4,
      last: 50,
      nextDecode: 4,
      sampleCount: 60,
      prefetch: 4,
      maxReorderSamples: 8,
      pendingOutputCount: 4,
    });
    expect(end).toBeGreaterThanOrEqual(4 + streamLookaheadSamples(8, 4));
  });

  it("B-request at Source Out / export OUT still looks past last", () => {
    const end = pumpSubmitEnd({
      requested: 17,
      last: 17,
      nextDecode: 12,
      sampleCount: 30,
      prefetch: 4,
      maxReorderSamples: 3,
      pendingOutputCount: 3,
    });
    expect(end).toBeGreaterThan(17);
    expect(end).toBeLessThan(30);
  });

  it("PTS≠decode across prefetch boundary still requires requested+lookahead", () => {
    // Requested presentation frame has decode index 2; refs already submitted.
    const end = pumpSubmitEnd({
      requested: 2,
      last: 29,
      nextDecode: 5,
      sampleCount: 60,
      prefetch: 4,
      maxReorderSamples: 2,
      pendingOutputCount: 4,
    });
    expect(end).toBeGreaterThanOrEqual(2 + streamLookaheadSamples(2, 4));
  });

  it("stall message carries the human-brief diagnostic fields", () => {
    const text = formatStallMessage({
      exportFrameIndex: 42,
      exportTimestampSec: 1.4,
      sourceClipId: "c1",
      sourceClipLabel: "V1-stills.mp4",
      sourceUrlName: "V1-stills.mp4",
      sourceInMs: 0,
      sourceOutMs: 120000,
      timelineMs: 70000,
      pictureKind: "video",
      fps: 30,
      visFrames: 12,
      afeFrames: 36,
      blackFrames: 0,
      sourceSampleRequested: 17,
      requestedPtsUs: 566667,
      decodeStartSample: 0,
      lastSubmittedSample: 21,
      decodeQueueSize: 2,
      streamPtsPending: 3,
      streamReadySize: 1,
      streamWaiterIndex: 17,
      reorderCap: 16,
      lastVideoFrameTimestamp: 500000,
      lastSampleResolved: 14,
      decoderFlushCount: 0,
      decoderResetCount: 1,
      encoderEncodeQueueSize: 0,
      lastProgressUpdateMs: 12,
      pendingPts: [600000, 633333],
      readyIndexes: [18],
      lastDecodedTimestamp: 500000,
      gopKeyframeStart: 0,
      stalledMs: AFE_DECODE_STALL_MS,
      lookahead: 8,
      maxReorderSamples: 4,
    });
    expect(text).toContain("requested sample 17 PTS 566667");
    expect(text).toContain("pending PTS [600000,633333]");
    expect(text).toContain("ready [18]");
    expect(text).toContain("decodeQueue 2");
    expect(text).toContain("gopStart 0");
    expect(text).toContain("exportFrame 42");
    expect(text).toContain("clip V1-stills.mp4");
    expect(text).toContain("clipId c1");
    expect(text).toContain("source V1-stills.mp4");
    expect(text).toContain("sourceInMs 0");
    expect(text).toContain("sourceOutMs 120000");
    expect(text).toContain("timelineMs 70000");
    expect(text).toContain("picture video");
    expect(text).toContain("fps 30");
    expect(text).toContain("visFrames 12");
    expect(text).toContain("afeFrames 36");
    expect(text).toContain("blackFrames 0");
  });
});
