import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_TRACKS,
  addAudioTrack,
  canAddAudioTrack,
  canRemoveAudioTrack,
  removeAudioTrack,
} from "../../src/core/audio-tracks";
import {
  analysisAudioClipAt,
  audioTracksOf,
  defaultTracks,
  isTrackId,
  mixClipsAt,
  projectHasMixAudio,
  trackIdsOf,
} from "../../src/core/models";
import { createEmptyProject, deserializeProject, serializeProject } from "../../src/core/project";
import { applyCommand } from "../../src/app/commands";
import { createSession } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { jobFromProject } from "../../src/core/exporter";
import { firstFreeAudioTrack } from "../../src/core/link";
import { asset, clip, projectWith } from "../helpers";

describe("dynamic audio tracks", () => {
  it("new projects still start with V1 V2 A1 A2 only", () => {
    const p = createEmptyProject();
    expect(p.tracks.map((t) => t.id)).toEqual(["V1", "V2", "A1", "A2"]);
    expect(audioTracksOf(p)).toHaveLength(2);
    expect(defaultTracks().every((t) => typeof t.order === "number")).toBe(true);
    expect(isTrackId("A1")).toBe(true);
    expect(isTrackId("A2")).toBe(true);
    expect(isTrackId("A3")).toBe(true);
    expect(isTrackId("a_abc-def")).toBe(true);
    expect(isTrackId("VIS")).toBe(false);
  });

  it("adds a stable-id audio track as A3 without pre-creating 64", () => {
    const start = createEmptyProject();
    const added = addAudioTrack(start);
    expect(added.error).toBeUndefined();
    expect(added.track?.kind).toBe("audio");
    expect(added.track?.name).toBe("A3");
    expect(added.track?.id).not.toBe("A3");
    expect(added.track?.id.startsWith("a_")).toBe(true);
    expect(isTrackId(added.track!.id)).toBe(true);
    expect(audioTracksOf(added.project)).toHaveLength(3);
    expect(added.project.tracks).toHaveLength(5);
    expect(canAddAudioTrack(start)).toBe(true);
    expect(canRemoveAudioTrack(start)).toBe(false);
    expect(canRemoveAudioTrack(added.project)).toBe(true);
  });

  it("caps at 64 audio tracks and refuses a 65th", () => {
    let project = createEmptyProject();
    for (let i = 2; i < MAX_AUDIO_TRACKS; i += 1) {
      const next = addAudioTrack(project);
      expect(next.error).toBeUndefined();
      project = next.project;
    }
    expect(audioTracksOf(project)).toHaveLength(MAX_AUDIO_TRACKS);
    expect(canAddAudioTrack(project)).toBe(false);
    const overflow = addAudioTrack(project);
    expect(overflow.error).toMatch(/64/);
    expect(audioTracksOf(overflow.project)).toHaveLength(MAX_AUDIO_TRACKS);
  });

  it("removes an extra track and its clips; keeps A1/A2", () => {
    const withThird = addAudioTrack(createEmptyProject());
    const id = withThird.track!.id;
    const project = {
      ...withThird.project,
      clips: [
        clip({ id: "keep", assetId: "a", trackId: "A1", startMs: 0, durationMs: 500 }),
        clip({ id: "gone", assetId: "a", trackId: id, startMs: 0, durationMs: 500 }),
      ],
    };
    const removed = removeAudioTrack(project, id);
    expect(removed.error).toBeUndefined();
    expect(audioTracksOf(removed.project).map((t) => t.id)).toEqual(["A1", "A2"]);
    expect(removed.project.clips.map((c) => c.id)).toEqual(["keep"]);
    expect(removeAudioTrack(removed.project).error).toMatch(/two audio/);
  });

  it("round-trips extra tracks and loads legacy A1/A2 JSON", () => {
    const added = addAudioTrack(createEmptyProject("Stems"));
    added.project.clips = [
      clip({ id: "c1", assetId: "x", trackId: "A1", startMs: 0, durationMs: 800 }),
      clip({ id: "c3", assetId: "x", trackId: added.track!.id, startMs: 100, durationMs: 400 }),
    ];
    added.project.assets = [asset({ id: "x", kind: "audio", durationMs: 2000 })];
    const extra = added.project.tracks.find((t) => t.id === added.track!.id)!;
    extra.muted = true;
    extra.volume = 0.5;
    extra.groupId = "ch-01";
    extra.automationLanes = [{ id: "vol", kind: "volume", points: [{ timeMs: 0, value: 1 }] }];

    const loaded = deserializeProject(serializeProject(added.project));
    expect(loaded.tracks.map((t) => t.id)).toEqual(added.project.tracks.map((t) => t.id));
    expect(loaded.tracks.find((t) => t.id === extra.id)?.name).toBe("A3");
    expect(loaded.tracks.find((t) => t.id === extra.id)?.muted).toBe(true);
    expect(loaded.tracks.find((t) => t.id === extra.id)?.volume).toBeCloseTo(0.5);
    expect(loaded.tracks.find((t) => t.id === extra.id)?.groupId).toBe("ch-01");
    expect(loaded.groups?.some((g) => g.id === "ch-01")).toBe(true);
    expect(loaded.tracks.find((t) => t.id === extra.id)?.automationLanes?.[0]?.kind).toBe("volume");
    expect(loaded.clips.map((c) => c.trackId).sort()).toEqual(["A1", extra.id].sort());

    const legacy = createEmptyProject("Old");
    const raw = JSON.parse(serializeProject(legacy)) as {
      tracks: Array<Record<string, unknown>>;
    };
    for (const t of raw.tracks) {
      delete t.order;
      delete t.groupId;
      delete t.automationLanes;
    }
    const fromLegacy = deserializeProject(JSON.stringify(raw));
    expect(fromLegacy.tracks.map((t) => t.id)).toEqual(["V1", "V2", "A1", "A2"]);
    expect(fromLegacy.tracks.every((t) => t.volume === 1 && t.solo === false)).toBe(true);
  });

  it("mix / VIS analysis / export / free-lane use the collection, not A1/A2 only", () => {
    const added = addAudioTrack(createEmptyProject());
    const a3 = added.track!.id;
    const p = {
      ...added.project,
      assets: [
        asset({ id: "aa", kind: "audio", durationMs: 2000 }),
        asset({ id: "vv", kind: "video", durationMs: 2000, hasAudio: true }),
      ],
      clips: [
        clip({ id: "v1", assetId: "vv", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "a3", assetId: "aa", trackId: a3, startMs: 0, durationMs: 1500 }),
      ],
      inPointMs: 0,
      outPointMs: 2000,
    };
    expect(projectHasMixAudio(p)).toBe(true);
    expect(mixClipsAt(p, 100).map((c) => c.id).sort()).toEqual(["a1", "a3", "v1"]);
    expect(analysisAudioClipAt(p, 100)?.id).toBe("a1");
    p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, muted: true } : t));
    expect(analysisAudioClipAt(p, 100)?.id).toBe("a3");
    expect(firstFreeAudioTrack(p, 0, 500)).toBe("A2");
    const job = jobFromProject(p);
    expect(job.tracks.map((t) => t.id)).toEqual(trackIdsOf(p));
    expect(job.tracks.find((t) => t.id === a3)!.clips).toHaveLength(1);
    expect(job.tracks.find((t) => t.id === "A1")!.clips).toHaveLength(0);
  });

  it("keeps filename stem labels when +/− reindexes default A-names", () => {
    const named = {
      ...addAudioTrack(createEmptyProject()).project,
    };
    named.tracks = named.tracks.map((t) => (t.id === "A1" ? { ...t, name: "vocals" } : t));
    const extra = addAudioTrack(named);
    expect(extra.project.tracks.find((t) => t.id === "A1")?.name).toBe("vocals");
    expect(extra.project.tracks.find((t) => t.kind === "audio" && t.id !== "A1" && t.id !== "A2")?.name).toBe(
      "A3",
    );
    const removed = removeAudioTrack(extra.project, extra.track!.id);
    expect(removed.project.tracks.find((t) => t.id === "A1")?.name).toBe("vocals");
    expect(removed.project.tracks.find((t) => t.id === "A2")?.name).toBe("A2");
  });

  it("add/remove commands are undoable and address tracks by stable id", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyCommand(session, { type: "addAudioTrack" });
    const third = session.project.tracks.find((t) => t.kind === "audio" && t.id !== "A1" && t.id !== "A2");
    expect(third).toBeTruthy();
    expect(session.targetTrackId).toBe(third!.id);
    session = applyCommand(session, { type: "toggleMute", trackId: third!.id });
    expect(session.project.tracks.find((t) => t.id === third!.id)?.muted).toBe(true);
    session = applyCommand(session, { type: "removeAudioTrack", trackId: third!.id });
    expect(session.project.tracks.some((t) => t.id === third!.id)).toBe(false);
    session = applyCommand(session, { type: "undo" });
    expect(session.project.tracks.some((t) => t.id === third!.id)).toBe(true);
  });
});

describe("legacy A1/A2 fixtures still attach", () => {
  it("projectWith clips on A1/A2 mix as before", () => {
    const p = projectWith([
      clip({ id: "a1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
      clip({ id: "a2", assetId: "a", trackId: "A2", startMs: 0, durationMs: 1000 }),
    ]);
    expect(mixClipsAt(p, 100).map((c) => c.id).sort()).toEqual(["a1", "a2"]);
  });
});
