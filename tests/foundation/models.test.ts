import { describe, expect, it } from "vitest";
import {
  audioClipsAt,
  clipOnTrackAt,
  mixClipsAt,
  projectHasMixAudio,
  clipEndMs,
  defaultTracks,
  formatTimecode,
  parseTimecode,
  isTrackAudible,
  isTrackId,
  kindOfTrack,
  projectDurationMs,
  TRACK_IDS,
  topVideoClipAt,
} from "../../src/core/models";
import { createEmptyProject } from "../../src/core/project";
import { asset, clip, projectWith } from "../helpers";

describe("foundation models", () => {
  it("creates V1 V2 A1 A2 only", () => {
    const p = createEmptyProject();
    expect(p.schemaVersion).toBe(5);
    expect(p.tracks.map((t) => t.id)).toEqual(["V1", "V2", "A1", "A2"]);
    expect(defaultTracks().every((t) => t.kind === kindOfTrack(t.id))).toBe(true);
    expect(defaultTracks().every((t) => t.volume === 1)).toBe(true);
    expect(defaultTracks().every((t) => t.pan === 0)).toBe(true);
    expect(defaultTracks().every((t) => t.solo === false)).toBe(true);
    expect(p.masterVolume).toBe(1);
    expect(p.clips).toEqual([]);
    expect(p.inPointMs).toBeNull();
    expect(p.outPointMs).toBeNull();
    expect(TRACK_IDS).toEqual(["V1", "V2", "A1", "A2"]);
    expect(isTrackId("VIS")).toBe(false);
    expect(p.tracks.some((t) => t.id === ("VIS" as never))).toBe(false);
  });

  it("computes duration from clips and out point", () => {
    const p = projectWith([clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 200, durationMs: 800 })]);
    expect(clipEndMs(p.clips[0]!)).toBe(1000);
    expect(projectDurationMs(p)).toBe(1000);
    expect(projectDurationMs({ ...p, outPointMs: 2500 })).toBe(2500);
  });

  it("picks V2 over V1 under playhead", () => {
    const p = projectWith([
      clip({ id: "v1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "b", trackId: "V2", startMs: 500, durationMs: 500 }),
    ]);
    expect(p.frontVideoTrackId).toBe("V2");
    expect(topVideoClipAt(p, 600)?.id).toBe("v2");
    expect(topVideoClipAt(p, 100)?.id).toBe("v1");
    expect(topVideoClipAt(p, 3000)).toBeUndefined();
    expect(topVideoClipAt({ ...p, frontVideoTrackId: "V1" }, 600)?.id).toBe("v1");
  });

  it("finds up to two audio clips", () => {
    const p = projectWith([
      clip({ id: "a1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
      clip({ id: "a2", assetId: "b", trackId: "A2", startMs: 0, durationMs: 1000 }),
    ]);
    expect(audioClipsAt(p, 100).map((c) => c.id).sort()).toEqual(["a1", "a2"]);
  });

  it("mixClipsAt / clipOnTrackAt only return clips under the playhead (P64)", () => {
    const p = projectWith([
      clip({ id: "v-early", assetId: "v", trackId: "V1", startMs: 0, durationMs: 1000 }),
      clip({ id: "v-late", assetId: "v", trackId: "V1", startMs: 5000, durationMs: 1000 }),
      clip({ id: "a-early", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
      clip({ id: "a-late", assetId: "a", trackId: "A1", startMs: 5000, durationMs: 2000 }),
    ]);
    expect(clipOnTrackAt(p, "V1", 500)?.id).toBe("v-early");
    expect(clipOnTrackAt(p, "V1", 5500)?.id).toBe("v-late");
    expect(clipOnTrackAt(p, "V1", 3000)).toBeUndefined();
    expect(mixClipsAt(p, 500).map((c) => c.id).sort()).toEqual(["a-early", "v-early"]);
    expect(mixClipsAt(p, 5500).map((c) => c.id).sort()).toEqual(["a-late", "v-late"]);
    expect(mixClipsAt(p, 3000)).toEqual([]);
  });

  it("mixClipsAt includes V-track clips; audioClipsAt stays A-only", () => {
    const p = projectWith([
      clip({ id: "v1", assetId: "v", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "a1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
    ]);
    expect(clipOnTrackAt(p, "V1", 100)?.id).toBe("v1");
    expect(mixClipsAt(p, 100).map((c) => c.id).sort()).toEqual(["a1", "v1"]);
    expect(audioClipsAt(p, 100).map((c) => c.id)).toEqual(["a1"]);
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, muted: true } : t));
    expect(mixClipsAt(p, 100).map((c) => c.id)).toEqual(["a1"]);
  });

  it("empty project has zero duration", () => {
    expect(projectDurationMs(createEmptyProject())).toBe(0);
  });

  it("VIS events and a finite VIS window extend project duration (P54)", () => {
    const empty = createEmptyProject();
    expect(projectDurationMs(empty)).toBe(0);
    const withEvent = {
      ...empty,
      visualizer: {
        ...empty.visualizer,
        events: [{ id: "e1", sceneId: empty.visualizer.sceneId, startMs: 500, durationMs: 4000 }],
      },
    };
    expect(projectDurationMs(withEvent)).toBe(4500);
    const withWindow = {
      ...empty,
      visualizer: { ...empty.visualizer, startMs: 1000, durationMs: 2500, events: [] },
    };
    expect(projectDurationMs(withWindow)).toBe(3500);
    const wholeTimeline = {
      ...empty,
      visualizer: { ...empty.visualizer, startMs: 0, durationMs: 0, events: [] },
    };
    expect(projectDurationMs(wholeTimeline)).toBe(0);
  });
});

describe("mute skip", () => {
  it("muted V tracks still cover picture and still prefer V2 over V1", () => {
    const p = projectWith([
      clip({ id: "v1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "b", trackId: "V2", startMs: 0, durationMs: 2000 }),
    ]);
    expect(topVideoClipAt(p, 100)?.id).toBe("v2");
    p.tracks = p.tracks.map((t) => (t.id === "V2" ? { ...t, muted: true } : t));
    expect(topVideoClipAt(p, 100)?.id).toBe("v2");
    p.tracks = p.tracks.map((t) => (t.id === "V1" || t.id === "V2" ? { ...t, muted: true } : t));
    expect(topVideoClipAt(p, 100)?.id).toBe("v2");
  });

  it("solo V1 does not hide V2 picture", () => {
    const p = projectWith([
      clip({ id: "v1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "b", trackId: "V2", startMs: 0, durationMs: 2000 }),
    ]);
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, solo: true } : t));
    expect(topVideoClipAt(p, 100)?.id).toBe("v2");
    expect(isTrackAudible(p, "V2")).toBe(false);
    expect(isTrackAudible(p, "V1")).toBe(true);
  });

  it("skips muted A1/A2", () => {
    const p = projectWith([
      clip({ id: "a1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
      clip({ id: "a2", assetId: "b", trackId: "A2", startMs: 0, durationMs: 1000 }),
    ]);
    expect(audioClipsAt(p, 100)).toHaveLength(2);
    p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, muted: true } : t));
    expect(audioClipsAt(p, 100).map((c) => c.id)).toEqual(["a2"]);
  });

  it("solo A1 silences A2; mute still wins on a soloed track", () => {
    const p = projectWith([
      clip({ id: "a1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
      clip({ id: "a2", assetId: "b", trackId: "A2", startMs: 0, durationMs: 1000 }),
    ]);
    expect(isTrackAudible(p, "A1")).toBe(true);
    expect(isTrackAudible(p, "A2")).toBe(true);
    p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, solo: true } : t));
    expect(isTrackAudible(p, "A1")).toBe(true);
    expect(isTrackAudible(p, "A2")).toBe(false);
    expect(audioClipsAt(p, 100).map((c) => c.id)).toEqual(["a1"]);
    p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, muted: true } : t));
    expect(isTrackAudible(p, "A1")).toBe(false);
    expect(audioClipsAt(p, 100)).toHaveLength(0);
    p.tracks = p.tracks.map((t) =>
      t.id === "A1" ? { ...t, muted: false, solo: false } : t,
    );
    expect(isTrackAudible(p, "A1")).toBe(true);
    expect(isTrackAudible(p, "A2")).toBe(true);
  });

  it("projectHasMixAudio stays true across an A1 gap (playhead has no clip)", () => {
    const p = projectWith(
      [
        clip({ id: "a", assetId: "x", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "b", assetId: "x", trackId: "A1", startMs: 2000, durationMs: 1000 }),
      ],
      [asset({ id: "x", kind: "audio", durationMs: 4000 })],
    );
    expect(projectHasMixAudio(p)).toBe(true);
    expect(mixClipsAt(p, 1500)).toEqual([]);
    expect(projectHasMixAudio(createEmptyProject())).toBe(false);
  });

  it("formats mm:ss.cc", () => {
    expect(formatTimecode(0)).toBe("00:00.00");
    expect(formatTimecode(1500)).toBe("00:01.50");
    expect(formatTimecode(61_230)).toBe("01:01.23");
  });

  it("parseTimecode round-trips the printed form and accepts m:ss / hours / ms", () => {
    for (const ms of [0, 1500, 61_230, 62_000, 3_723_000]) {
      expect(parseTimecode(formatTimecode(ms))).toBe(ms);
    }
    expect(parseTimecode("1:02.00")).toBe(62_000);
    expect(parseTimecode("1:02")).toBe(62_000);
    expect(parseTimecode("1:02:03")).toBe(3_723_000);
    expect(parseTimecode("62000")).toBe(62_000);
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("1:60")).toBeNull();
  });
});
