import { afterEach, describe, expect, it } from "vitest";
import { jobFromProject, videoClipAt, missingOnlyVideoLabel } from "../../src/core/exporter/job";
import {
  resetFrameSourceBackend,
  setFrameSourceBackend,
  sourceTimeSec,
} from "../../src/core/exporter/frame-source";
import { videoAlphaAtClipTime } from "../../src/core/fades";
import {
  compositeVideoAt,
  contextFromExportClips,
  resolvePictureSource,
} from "../../src/core/transition";
import { exportVisOf } from "../../src/core/exporter/job";
import { asset, clip, projectWith } from "../helpers";
import type { ExportClip } from "../../src/core/exporter/types";
import type { Transition } from "../../src/core/transition";
import type { FrameSourceBackendId } from "../../src/core/frame-engine";

afterEach(() => {
  resetFrameSourceBackend();
});

function exportClip(partial: Partial<ExportClip> = {}): ExportClip {
  return {
    id: "v1",
    trackId: "V1",
    kind: "video",
    startMs: 0,
    endMs: 2000,
    sourceUrl: "blob:afe-v1",
    sourceInMs: 0,
    sourceOutMs: 2000,
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    rate: 1,
    missing: false,
    label: "V1",
    ...partial,
  };
}

function backends(): FrameSourceBackendId[] {
  return ["ailexsi", "htmlvideo"];
}

describe("AFE Resonance export semantics (AILEXSI + htmlvideo identity, no decode)", () => {
  it("hard cut V1→V2 picks the covering clip; timestamps stay identical across backends", () => {
    const p = projectWith(
      [
        clip({ id: "c1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "c2", assetId: "a2", trackId: "V2", startMs: 1000, durationMs: 1000 }),
      ],
      [
        asset({ id: "a1", kind: "video", durationMs: 4000, objectUrl: "blob:a", missing: false }),
        asset({ id: "a2", kind: "video", durationMs: 4000, objectUrl: "blob:b", missing: false }),
      ],
    );
    const job = jobFromProject(p);
    expect(videoClipAt(job, 0)?.id).toBe("c1");
    expect(videoClipAt(job, 999)?.id).toBe("c1");
    expect(videoClipAt(job, 1000)?.id).toBe("c2");
    expect(videoClipAt(job, 1500)?.id).toBe("c2");

    const v1 = job.tracks.find((t) => t.id === "V1")!.clips[0]!;
    const v2 = job.tracks.find((t) => t.id === "V2")!.clips[0]!;
    for (const backend of backends()) {
      setFrameSourceBackend(backend);
      expect(sourceTimeSec(v1, 0, 30)).toBeCloseTo(500 / 30 / 1000, 6);
      expect(sourceTimeSec(v2, 1000, 30)).toBeCloseTo(500 / 30 / 1000, 6);
    }
  });

  it("Source In/Out + shortened clip + clip rate feed the same sourceTimeSec on all backends", () => {
    const c = exportClip({
      startMs: 0,
      endMs: 1000,
      sourceInMs: 2500,
      sourceOutMs: 4500,
      rate: 2,
    });
    const times = [0, 100, 500, 999].map((t) => sourceTimeSec(c, t, 30));
    for (const backend of backends()) {
      setFrameSourceBackend(backend);
      expect([0, 100, 500, 999].map((t) => sourceTimeSec(c, t, 30))).toEqual(times);
    }
    expect(times[0]).toBeGreaterThanOrEqual(2.5);
    expect(times[3]).toBeLessThan(4.5);
    expect(sourceTimeSec(c, 5000, 30)).toBeLessThan(c.sourceOutMs / 1000);
  });

  it("repeated segments of the same source keep independent source windows", () => {
    const p = projectWith(
      [
        clip({
          id: "first",
          assetId: "a1",
          trackId: "V1",
          startMs: 0,
          durationMs: 500,
          sourceInMs: 0,
          sourceOutMs: 500,
        }),
        clip({
          id: "again",
          assetId: "a1",
          trackId: "V1",
          startMs: 800,
          durationMs: 500,
          sourceInMs: 0,
          sourceOutMs: 500,
        }),
      ],
      [asset({ id: "a1", kind: "video", durationMs: 4000, objectUrl: "blob:a", missing: false })],
    );
    const job = jobFromProject(p);
    expect(videoClipAt(job, 100)?.id).toBe("first");
    expect(videoClipAt(job, 600)).toBeUndefined();
    expect(videoClipAt(job, 900)?.id).toBe("again");
    const a = job.tracks.find((t) => t.id === "V1")!.clips.find((c) => c.id === "first")!;
    const b = job.tracks.find((t) => t.id === "V1")!.clips.find((c) => c.id === "again")!;
    expect(sourceTimeSec(a, 0, 30)).toBeCloseTo(sourceTimeSec(b, 800, 30), 6);
  });

  it("fade in/out alphas are compositor-side and do not depend on the frame backend", () => {
    const faded = { durationMs: 1000, gain: 1, fadeInMs: 200, fadeOutMs: 200 };
    expect(videoAlphaAtClipTime(faded, 0)).toBe(0);
    expect(videoAlphaAtClipTime(faded, 100)).toBeGreaterThan(0);
    expect(videoAlphaAtClipTime(faded, 100)).toBeLessThan(1);
    expect(videoAlphaAtClipTime(faded, 500)).toBe(1);
    expect(videoAlphaAtClipTime(faded, 1000)).toBe(0);
  });

  it("crossfade composites both layers; AUTO still prefers video over VIS", () => {
    const clips = [
      exportClip({ id: "a", trackId: "V1", startMs: 0, endMs: 1200, sourceUrl: "blob:a" }),
      exportClip({ id: "b", trackId: "V2", startMs: 800, endMs: 2000, sourceUrl: "blob:b" }),
    ];
    const transition: Transition = {
      id: "xf",
      type: "crossfade",
      startMs: 800,
      durationMs: 400,
      sourceAClipId: "a",
      sourceBClipId: "b",
      audioMode: "crossfade",
      audioDurationMs: 400,
    };
    const ctx = contextFromExportClips(clips, [transition], "V2", {
      enabled: true,
      muted: false,
      events: [],
      startMs: 0,
      durationMs: 0,
    });
    const mid = compositeVideoAt(ctx, 1000);
    expect(mid.layers.some((l) => l.clipId === "a" && l.alpha > 0)).toBe(true);
    expect(mid.layers.some((l) => l.clipId === "b" && l.alpha > 0)).toBe(true);
    expect(resolvePictureSource(ctx, 1000).kind).not.toBe("vis");
  });

  it("VIS fills the gap; black when video is missing; missing-only export still FAILs", () => {
    const visOnly = projectWith([], []);
    visOnly.visualizer = {
      ...visOnly.visualizer,
      enabled: true,
      muted: false,
      startMs: 0,
      durationMs: 2000,
      events: [],
    };
    const visJob = jobFromProject(visOnly);
    const visCtx = contextFromExportClips([], visJob.transitions ?? [], "V2", exportVisOf(visJob));
    expect(resolvePictureSource(visCtx, 100).kind).toBe("vis");

    const missing = projectWith(
      [clip({ id: "gone", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "a1", name: "missing-clip.mp4", kind: "video", durationMs: 1000, missing: true })],
    );
    const missJob = jobFromProject(missing);
    expect(missingOnlyVideoLabel(missJob)).toBe("missing-clip.mp4");
    expect(videoClipAt(missJob, 0)?.missing).toBe(true);
  });

  it("export IN/OUT remaps clip times and source window the same for all backends", () => {
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "a1",
          trackId: "V1",
          startMs: 0,
          durationMs: 4000,
          sourceInMs: 0,
          sourceOutMs: 4000,
        }),
      ],
      [asset({ id: "a1", kind: "video", durationMs: 4000, objectUrl: "blob:a", missing: false })],
    );
    p.inPointMs = 500;
    p.outPointMs = 2500;
    const job = jobFromProject(p);
    expect(job.durationMs).toBe(2000);
    const jc = job.tracks.find((t) => t.id === "V1")!.clips[0]!;
    expect(jc.startMs).toBe(0);
    expect(jc.endMs).toBe(2000);
    expect(jc.sourceInMs).toBe(500);
    expect(jc.sourceOutMs).toBe(2500);
    for (const backend of backends()) {
      setFrameSourceBackend(backend);
      expect(sourceTimeSec(jc, 0, 30)).toBeCloseTo((500 + 500 / 30) / 1000, 6);
    }
  });

  it("Source In on a B-frame center, hard cut, crossfade, clip rate, IN/OUT stay compositor-side", () => {
    const bIn = exportClip({
      startMs: 0,
      endMs: 1000,
      sourceInMs: Math.round((2.5 / 30) * 1000),
      sourceOutMs: 2000,
      rate: 1,
    });
    const t0 = sourceTimeSec(bIn, 0, 30);
    expect(t0).toBeGreaterThan((2 / 30));
    expect(t0).toBeLessThan((4 / 30));
    const cutA = exportClip({ id: "a", trackId: "V1", startMs: 0, endMs: 1000, sourceUrl: "blob:a" });
    const cutB = exportClip({
      id: "b",
      trackId: "V2",
      startMs: 1000,
      endMs: 2000,
      sourceUrl: "blob:b",
      sourceInMs: Math.round((5.5 / 30) * 1000),
      sourceOutMs: 2000,
    });
    expect(sourceTimeSec(cutB, 1000, 30)).toBeGreaterThan(5 / 30);
    const rated = exportClip({ startMs: 0, endMs: 1000, sourceInMs: 0, sourceOutMs: 4000, rate: 2 });
    expect(sourceTimeSec(rated, 500, 30)).toBeGreaterThan(sourceTimeSec(cutA, 500, 30));
    const faded = { durationMs: 1000, gain: 1, fadeInMs: 0, fadeOutMs: 0 };
    expect(videoAlphaAtClipTime(faded, 500)).toBe(1);
  });
});
