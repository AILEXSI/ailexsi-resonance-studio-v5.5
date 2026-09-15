import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, importFiles } from "../../src/app/session";
import { addAudioTrack } from "../../src/core/audio-tracks";
import {
  allocateAudioTracksForStems,
  inferStemGroupId,
  nameStemTrack,
  stemStartMs,
} from "../../src/core/stem-import";
import { MAX_AUDIO_TRACKS, audioTracksOf } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject } from "../../src/core/project";
import { asset, clip, projectWith } from "../helpers";

function fakeFile(name: string, type = "audio/wav", size = 256): File {
  return new File([new Uint8Array(size)], name, { type });
}

function probeByName(file: File) {
  const m = file.name.match(/(\d+)ms/);
  return Promise.resolve({ durationMs: m ? Number(m[1]) : 1000 });
}

async function importWavs(
  session: ReturnType<typeof createSession>,
  names: string[],
  playheadMs?: number,
) {
  const next =
    playheadMs == null ? session : { ...session, project: { ...session.project, playheadMs } };
  return importFiles(
    next,
    names.map((name) => fakeFile(name)),
    probeByName,
  );
}

describe("stem import helpers", () => {
  it("uses playhead when it is parked, else 0", () => {
    expect(stemStartMs(0)).toBe(0);
    expect(stemStartMs(-12)).toBe(0);
    expect(stemStartMs(Number.NaN)).toBe(0);
    expect(stemStartMs(2500)).toBe(2500);
  });

  it("tags a batch only when filenames share a prefix", () => {
    expect(inferStemGroupId(["vocals.wav", "drums.wav"])).toBeUndefined();
    expect(inferStemGroupId(["01_vocals.wav", "01_drums.wav", "01_bass.wav"])).toBe("01");
  });

  it("reuses empty audio tracks then addAudioTrack, and reports overflow", () => {
    const empty = allocateAudioTracksForStems(createEmptyProject(), 3);
    expect(empty.trackIds).toHaveLength(3);
    expect(empty.trackIds.slice(0, 2)).toEqual(["A1", "A2"]);
    expect(empty.trackIds[2]!.startsWith("a_")).toBe(true);
    expect(audioTracksOf(empty.project)).toHaveLength(3);
    expect(empty.skipped).toBe(0);

    const occupied = projectWith(
      [clip({ id: "old", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 500 })],
      [asset({ id: "aa", kind: "audio", durationMs: 500 })],
    );
    const reuse = allocateAudioTracksForStems(occupied, 2);
    expect(reuse.trackIds[0]).toBe("A2");
    expect(reuse.trackIds[1]!.startsWith("a_")).toBe(true);
    expect(reuse.project.clips).toHaveLength(1);

    let full = createEmptyProject();
    for (let i = 2; i < MAX_AUDIO_TRACKS; i += 1) full = addAudioTrack(full).project;
    full = {
      ...full,
      clips: audioTracksOf(full).map((t, i) =>
        clip({ id: `c${i}`, assetId: "aa", trackId: t.id, startMs: 0, durationMs: 100 }),
      ),
    };
    const overflow = allocateAudioTracksForStems(full, 5);
    expect(overflow.trackIds).toHaveLength(0);
    expect(overflow.skipped).toBe(5);
  });

  it("names a track from the file and keeps a stable id", () => {
    const start = createEmptyProject();
    const named = nameStemTrack(start, "A1", "Suno_Vocals.wav", "01");
    const a1 = named.tracks.find((t) => t.id === "A1")!;
    expect(a1.id).toBe("A1");
    expect(a1.name).toBe("Suno_Vocals");
    expect(a1.groupId).toBe("01");
    expect(named.groups?.some((g) => g.id === "01" && g.name === "01")).toBe(true);
  });
});

describe("multi-stem import alignment + track creation", () => {
  it("places each WAV on its own track at the same start", async () => {
    const session = await importWavs(createSession(createMemoryBlobStore()), [
      "vocals-1200ms.wav",
      "drums-800ms.wav",
      "bass-900ms.wav",
    ], 1500);
    expect(session.project.clips).toHaveLength(3);
    expect(new Set(session.project.clips.map((c) => c.trackId)).size).toBe(3);
    expect(session.project.clips.every((c) => c.startMs === 1500)).toBe(true);
    expect(session.project.playheadMs).toBe(1500);
    expect(session.project.assets).toHaveLength(3);
    expect(session.project.assets.every((a) => a.kind === "audio")).toBe(true);
    const names = session.project.tracks.filter((t) => t.kind === "audio").map((t) => t.name);
    expect(names).toContain("vocals-1200ms");
    expect(names).toContain("drums-800ms");
    expect(names).toContain("bass-900ms");
    expect(audioTracksOf(session.project)).toHaveLength(3);
    expect(session.status).toMatch(/Imported 3 stem/);
    const last = audioTracksOf(session.project).at(-1)!;
    expect(session.targetTrackId).toBe(last.id);
    expect(last.id.startsWith("a_")).toBe(true);
  });

  it("writes a chapter group from a shared stem prefix", async () => {
    const session = await importWavs(createSession(createMemoryBlobStore()), [
      "01_vocals-200ms.wav",
      "01_drums-200ms.wav",
    ]);
    expect(session.project.tracks.find((t) => t.id === "A1")?.groupId).toBe("01");
    expect(session.project.tracks.find((t) => t.id === "A2")?.groupId).toBe("01");
    expect(session.project.groups?.some((g) => g.id === "01" && g.name === "01")).toBe(true);
  });

  it("single-file Import still appends on the preferred audio track", async () => {
    let session = await importWavs(createSession(createMemoryBlobStore()), ["solo-1500ms.wav"]);
    expect(session.project.clips).toHaveLength(1);
    expect(session.project.clips[0]!.trackId).toBe("A1");
    expect(session.project.clips[0]!.startMs).toBe(0);
    expect(session.project.tracks.find((t) => t.id === "A1")?.name).toBe("A1");
    session = await importWavs(session, ["next-800ms.wav"]);
    const onA1 = session.project.clips.filter((c) => c.trackId === "A1");
    expect(onA1).toHaveLength(2);
    expect(onA1.map((c) => c.startMs).sort((a, b) => a - b)).toEqual([0, 1500]);
    expect(audioTracksOf(session.project)).toHaveLength(2);
  });

  it("imports what fits at the 64-track cap and reports the skip", async () => {
    let project = createEmptyProject();
    for (let i = 2; i < MAX_AUDIO_TRACKS; i += 1) project = addAudioTrack(project).project;
    project = {
      ...project,
      clips: audioTracksOf(project).map((t, i) =>
        clip({ id: `busy-${i}`, assetId: "kept", trackId: t.id, startMs: 0, durationMs: 200 }),
      ),
      assets: [asset({ id: "kept", kind: "audio", durationMs: 200 })],
    };
    const session = await importWavs(
      { ...createSession(createMemoryBlobStore()), project },
      ["one-100ms.wav", "two-100ms.wav", "three-100ms.wav"],
    );
    expect(session.project.clips.length).toBe(MAX_AUDIO_TRACKS);
    expect(audioTracksOf(session.project)).toHaveLength(MAX_AUDIO_TRACKS);
    expect(session.status).toMatch(/skipped \(audio track limit 64\)/);
    expect(session.project.assets.filter((a) => a.id !== "kept")).toHaveLength(0);
  });

  it("does not stack stems onto a busy A1 and leaves existing clips", async () => {
    let session = createSession(createMemoryBlobStore());
    session.project = projectWith(
      [clip({ id: "old", assetId: "kept", trackId: "A1", startMs: 0, durationMs: 4000 })],
      [asset({ id: "kept", kind: "audio", durationMs: 4000 })],
    );
    session = await importWavs(session, ["lead-500ms.wav", "pad-500ms.wav"], 0);
    expect(session.project.clips.find((c) => c.id === "old")?.startMs).toBe(0);
    expect(session.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
    expect(session.project.clips.filter((c) => c.id !== "old")).toHaveLength(2);
    expect(session.project.clips.filter((c) => c.id !== "old").every((c) => c.startMs === 0)).toBe(true);
    expect(audioTracksOf(session.project)).toHaveLength(3);
  });

  it("undo of a stem batch restores tracks and clips in one step", async () => {
    let session = await importWavs(createSession(createMemoryBlobStore()), [
      "v-100ms.wav",
      "d-100ms.wav",
    ]);
    expect(audioTracksOf(session.project)).toHaveLength(2);
    expect(session.project.clips).toHaveLength(2);
    session = applyCommand(session, { type: "undo" });
    expect(session.project.clips).toHaveLength(0);
    expect(audioTracksOf(session.project).map((t) => t.id)).toEqual(["A1", "A2"]);
    expect(session.project.tracks.find((t) => t.id === "A1")?.name).toBe("A1");
  });
});
