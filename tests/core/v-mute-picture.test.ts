import { describe, expect, it } from "vitest";
import { jobFromProject } from "../../src/core/exporter/job";
import { videoAlphaAtClipTime } from "../../src/core/fades";
import { mixLinearGain } from "../../src/core/volume";
import {
  contextFromProject,
  compositeVideoAt,
  resolvePictureSource,
} from "../../src/core/transition";
import { isTrackAudible, mixClipsAt, topVideoClipAt } from "../../src/core/models";
import { shouldShowVisualizer } from "../../src/core/visualizer";
import { asset, clip, projectWith } from "../helpers";

function stacked() {
  return projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 0, durationMs: 2000 }),
      clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 2000 }),
    ],
    [
      asset({ id: "va", kind: "video", durationMs: 4000 }),
      asset({ id: "vb", kind: "video", durationMs: 4000 }),
      asset({ id: "aa", kind: "audio", durationMs: 4000 }),
    ],
  );
}

describe("V mute is audio-only", () => {
  it("muted V1 still covers in resolvePictureSource / compositeVideoAt", () => {
    const p = stacked();
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, muted: true } : t));
    p.frontVideoTrackId = "V1";
    const ctx = contextFromProject(p);
    expect(ctx.mutedTrackIds).not.toContain("V1");
    expect(resolvePictureSource(ctx, 500)).toMatchObject({ kind: "V1", clipId: "v1" });
    expect(compositeVideoAt(ctx, 500).layers).toEqual([{ clipId: "v1", alpha: 1 }]);
    expect(topVideoClipAt(p, 500)?.id).toBe("v1");
  });

  it("export picture alpha keeps muted V clip visible (P114)", () => {
    const p = stacked();
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, muted: true } : t));
    const job = jobFromProject(p);
    const v = job.tracks.find((t) => t.id === "V1")!.clips[0]!;
    expect(v.gain).toBe(0);
    expect(v.videoGain).toBe(1);
    expect(
      videoAlphaAtClipTime(
        {
          durationMs: v.endMs - v.startMs,
          gain: v.videoGain ?? v.gain,
          fadeInMs: v.fadeInMs,
          fadeOutMs: v.fadeOutMs,
        },
        500,
      ),
    ).toBe(1);
  });

  it("muted V1 audio is silent in the mix helper", () => {
    const p = stacked();
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, muted: true } : t));
    expect(isTrackAudible(p, "V1")).toBe(false);
    expect(mixClipsAt(p, 500).map((c) => c.id).sort()).toEqual(["a1", "v2"]);
    expect(mixLinearGain(1, 1, 1, !isTrackAudible(p, "V1"))).toBe(0);
  });

  it("A1 mute still drops A1 from the mix", () => {
    const p = stacked();
    p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, muted: true } : t));
    expect(isTrackAudible(p, "A1")).toBe(false);
    expect(mixClipsAt(p, 500).map((c) => c.id).sort()).toEqual(["v1", "v2"]);
  });

  it("VIS mute still suppresses the overlay", () => {
    const p = stacked();
    p.clips = [];
    p.visualizer = { ...p.visualizer, enabled: true, muted: true };
    expect(shouldShowVisualizer(p, 0)).toBe(false);
  });

  it("solo V1 does not hide V2 picture", () => {
    const p = stacked();
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, solo: true } : t));
    expect(isTrackAudible(p, "V2")).toBe(false);
    expect(resolvePictureSource(contextFromProject(p), 500).kind).toBe("V2");
    expect(compositeVideoAt(contextFromProject(p), 500).layers).toEqual([{ clipId: "v2", alpha: 1 }]);
  });
});
