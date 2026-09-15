import { describe, expect, it } from "vitest";
import { decodedBufferIsAudible } from "../../src/core/exporter/audio";
import { audioClipsForMix, jobFromProject } from "../../src/core/exporter/job";
import { mixLinearGain } from "../../src/core/volume";
import { asset, clip, projectWith } from "../helpers";

describe("V-track audio in the export mix", () => {
  it("audioClipsForMix includes a present V clip and keeps A clips", () => {
    const p = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 1000, objectUrl: "blob:v", missing: false }),
        asset({ id: "aa", kind: "audio", durationMs: 1000, objectUrl: "blob:a", missing: false }),
      ],
    );
    const mix = audioClipsForMix(jobFromProject(p));
    expect(mix.map((c) => c.id).sort()).toEqual(["a1", "v1"]);
    expect(mix.find((c) => c.id === "v1")!.kind).toBe("video");
    expect(mix.find((c) => c.id === "v1")!.trackId).toBe("V1");
  });

  it("excludes a missing / video-only-unreadable V clip from the mix list", () => {
    const p = projectWith(
      [
        clip({ id: "v-ok", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "v-miss", assetId: "vb", trackId: "V2", startMs: 0, durationMs: 1000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 1000, objectUrl: "blob:v", missing: false }),
        asset({ id: "vb", name: "silent.mp4", kind: "video", durationMs: 1000, missing: true }),
      ],
    );
    const mix = audioClipsForMix(jobFromProject(p));
    expect(mix.map((c) => c.id)).toEqual(["v-ok"]);
    expect(mix.some((c) => c.id === "v-miss")).toBe(false);
  });

  it("mix gain path uses V-track volume and pan (same bake as A)", () => {
    const p = projectWith(
      [
        clip({
          id: "v1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 1000,
          gain: 0.5,
        }),
      ],
      [asset({ id: "va", kind: "video", durationMs: 1000, objectUrl: "blob:v", missing: false })],
    );
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, volume: 0.5, pan: -1 } : t));
    p.masterVolume = 1;
    const job = jobFromProject(p);
    const vTrack = job.tracks.find((t) => t.id === "V1")!;
    expect(vTrack.pan).toBe(-1);
    expect(vTrack.clips[0]!.gain).toBeCloseTo(mixLinearGain(0.5, 0.5, 1, false), 8);
    const mixed = audioClipsForMix(job);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.gain).toBeCloseTo(0.25, 8);
    expect(mixed[0]!.trackId).toBe("V1");
  });

  it("decode with no audio channels is skipped (video-only file)", () => {
    expect(decodedBufferIsAudible({ numberOfChannels: 2, length: 128 })).toBe(true);
    expect(decodedBufferIsAudible({ numberOfChannels: 0, length: 128 })).toBe(false);
    expect(decodedBufferIsAudible({ numberOfChannels: 2, length: 0 })).toBe(false);
  });
});
