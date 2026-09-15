import { afterEach, describe, expect, it } from "vitest";
import {
  exportFrameEngineLabel,
  getDecoder,
  getFrameSourceBackend,
  resetFrameSourceBackend,
  setFrameSourceBackend,
  sourceTimeSec,
} from "../../src/core/exporter/frame-source";
import { createFrameSourceBackend, isAfeError } from "../../src/core/frame-engine";
import type { ExportClip } from "../../src/core/exporter/types";

function clip(partial: Partial<ExportClip> = {}): ExportClip {
  return {
    id: "c1",
    trackId: "V1",
    kind: "video",
    startMs: 0,
    endMs: 2000,
    sourceUrl: "https://127.0.0.1/afe.mp4",
    sourceInMs: 0,
    sourceOutMs: 2000,
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    rate: 1,
    missing: false,
    label: "afe",
    ...partial,
  };
}

afterEach(() => {
  resetFrameSourceBackend();
});

describe("AFE frame-source backend (V5.5 AILEXSI only)", () => {
  it("defaults to ailexsi so production export is AILEXSI Frame Engine", () => {
    expect(getFrameSourceBackend()).toBe("ailexsi");
    expect(exportFrameEngineLabel()).toBe("AILEXSI");
  });

  it("htmlvideo backend is not an export path and fails with typed AFE_*", async () => {
    setFrameSourceBackend("htmlvideo");
    expect(getFrameSourceBackend()).toBe("htmlvideo");
    expect(exportFrameEngineLabel()).toBe("HTMLVIDEO");
    await expect(getDecoder("https://127.0.0.1/does-not-need-to-exist.mp4")).rejects.toSatisfy(
      (e) => isAfeError(e) && e.code === "AFE_UNSUPPORTED_CONTAINER",
    );
  });

  it("reset restores the AILEXSI production path", () => {
    setFrameSourceBackend("htmlvideo");
    resetFrameSourceBackend();
    expect(getFrameSourceBackend()).toBe("ailexsi");
    expect(exportFrameEngineLabel()).toBe("AILEXSI");
  });

  it("rejects unknown backend ids by staying on ailexsi", () => {
    setFrameSourceBackend("htmlvideo");
    setFrameSourceBackend("not-a-backend" as "ailexsi");
    expect(getFrameSourceBackend()).toBe("ailexsi");
  });

  it("ailexsi identity does not change sourceTimeSec", () => {
    const c = clip({ sourceInMs: 1000, sourceOutMs: 5000, rate: 2, startMs: 0, endMs: 1000 });
    const a = sourceTimeSec(c, 250, 30);
    setFrameSourceBackend("ailexsi");
    const b = sourceTimeSec(c, 250, 30);
    setFrameSourceBackend("htmlvideo");
    const d = sourceTimeSec(c, 250, 30);
    expect(b).toBe(a);
    expect(d).toBe(a);
    expect(a).toBeCloseTo((1000 + 250 * 2 + 500 / 30) / 1000, 6);
  });

  it("exposes ailexsi and htmlvideo identities; mediabunny is gone", () => {
    expect(createFrameSourceBackend("ailexsi").identity).toBe("ailexsi");
    expect(createFrameSourceBackend("htmlvideo").identity).toBe("htmlvideo");
    expect(createFrameSourceBackend("ailexsi").identity).not.toBe("mediabunny");
  });
});
