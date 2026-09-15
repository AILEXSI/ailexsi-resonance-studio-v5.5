import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import type { TrackId } from "../../src/core/models";
import { audioClipsForMix, jobFromProject, mixWindowsForClip, presentLinkedAudioMates } from "../../src/core/exporter/job";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { vClipMixesOwnAudio } from "../../src/core/link";
import { moveClip, rippleDeleteClip, rippleTrimClip, rollEdit, setClipFades, setClipRate, slideClip, slipClip, slipClips, splitClipAt, splitAtPlayhead } from "../../src/core/timeline";
import { asset, clip, projectWith } from "../helpers";

function linkedPair(): Session {
  const va = asset({
    id: "va",
    kind: "video",
    durationMs: 2000,
    objectUrl: "blob:v",
    hasAudio: true,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: {
      ...projectWith(
        [
          clip({
            id: "v1",
            assetId: "va",
            trackId: "V1",
            startMs: 0,
            durationMs: 2000,
            sourceInMs: 0,
            sourceOutMs: 2000,
            linkId: "lnk1",
          }),
          clip({
            id: "a1",
            assetId: "va",
            trackId: "A1",
            startMs: 0,
            durationMs: 2000,
            sourceInMs: 0,
            sourceOutMs: 2000,
            linkId: "lnk1",
          }),
        ],
        [va],
      ),
      snap: false,
      playheadMs: 1000,
    },
    selectedClipId: "v1",
    selectedClipIds: ["v1"],
  };
}

describe("linked A/V", () => {
  it("mix skips V audio when a living linked A clip exists; unlinked V stays in the mix", () => {
    const start = linkedPair();
    const mixed = audioClipsForMix(jobFromProject(start.project));
    expect(mixed.map((c) => c.id).sort()).toEqual(["a1"]);

    const unlinked = applyCommand(start, { type: "unlinkClips", clipId: "v1" });
    const after = audioClipsForMix(jobFromProject(unlinked.project));
    expect(after.map((c) => c.id).sort()).toEqual(["a1", "v1"]);
  });

  it("export mix skips V audio when the linked A clip is disabled or its track is muted (P113)", () => {
    const start = linkedPair();
    const disabled = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, enabled: false } : c)),
    };
    expect(audioClipsForMix(jobFromProject(disabled)).map((c) => c.id)).toEqual([]);
    expect(jobFromProject(disabled).tracks.find((t) => t.id === "V1")!.clips[0]!.skipMix).toBe(true);

    const mutedA = {
      ...start.project,
      tracks: start.project.tracks.map((t) => (t.id === "A1" ? { ...t, muted: true } : t)),
    };
    const mutedMix = audioClipsForMix(jobFromProject(mutedA));
    expect(mutedMix.map((c) => c.id)).toEqual([]);
    expect(jobFromProject(mutedA).tracks.find((t) => t.id === "A1")!.clips).toEqual([]);

    const missingAsset = {
      ...start.project,
      assets: [
        start.project.assets[0]!,
        asset({
          id: "aa-miss",
          kind: "audio",
          durationMs: 2000,
          name: "gone.wav",
          missing: true,
        }),
      ],
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, assetId: "aa-miss" } : c)),
    };
    expect(audioClipsForMix(jobFromProject(missingAsset)).map((c) => c.id)).toEqual([]);
  });

  it("V mixes own audio in the tail after a shorter linked A mate (P125)", () => {
    const start = linkedPair();
    const shortA = {
      ...start.project,
      clips: start.project.clips.map((c) =>
        c.id === "a1" ? { ...c, durationMs: 800, sourceOutMs: 800 } : c,
      ),
    };
    expect(vClipMixesOwnAudio(shortA, shortA.clips.find((c) => c.id === "v1")!, 400)).toBe(false);
    expect(vClipMixesOwnAudio(shortA, shortA.clips.find((c) => c.id === "v1")!, 800)).toBe(true);
    expect(vClipMixesOwnAudio(shortA, shortA.clips.find((c) => c.id === "v1")!, 1200)).toBe(true);
    expect(vClipMixesOwnAudio(shortA, shortA.clips.find((c) => c.id === "v1")!)).toBe(false);

    const job = jobFromProject(shortA);
    const v = job.tracks.find((t) => t.id === "V1")!.clips[0]!;
    expect(v.skipMix).toBe(true);
    expect(audioClipsForMix(job).map((c) => c.id).sort()).toEqual(["a1", "v1"]);
    expect(mixWindowsForClip(v, presentLinkedAudioMates(job, v))).toEqual([
      { startMs: 800, endMs: 2000 },
    ]);
  });

  it("split at the same time cuts both and keeps each half-pair linked", () => {
    const start = linkedPair();
    const split = splitClipAt(start.project, "v1", 1000);
    expect(split.error).toBeUndefined();
    const clips = split.project.clips;
    expect(clips).toHaveLength(4);
    const vL = clips.find((c) => c.id === "v1")!;
    const vR = clips.find((c) => c.trackId === "V1" && c.id !== "v1")!;
    const aL = clips.find((c) => c.id === "a1")!;
    const aR = clips.find((c) => c.trackId === "A1" && c.id !== "a1")!;
    expect(vL.durationMs).toBe(1000);
    expect(aL.durationMs).toBe(1000);
    expect(vR.startMs).toBe(1000);
    expect(aR.startMs).toBe(1000);
    expect(vL.linkId).toBe(aL.linkId);
    expect(vR.linkId).toBe(aR.linkId);
    expect(vL.linkId).toBe("lnk1");
    expect(vR.linkId).toBeTruthy();
    expect(vR.linkId).not.toBe(vL.linkId);
  });

  it("split of an unlocked clip skips a locked mate and drops the pair (P115)", () => {
    const start = linkedPair();
    const locked = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const split = splitClipAt(locked, "a1", 1000);
    expect(split.error).toBeUndefined();
    const clips = split.project.clips;
    expect(clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(clips.find((c) => c.id === "v1")!.locked).toBe(true);
    expect(clips.find((c) => c.id === "v1")!.linkId).toBeUndefined();
    const audio = clips.filter((c) => c.trackId === "A1").sort((a, b) => a.startMs - b.startMs);
    expect(audio).toHaveLength(2);
    expect(audio[0]!.durationMs).toBe(1000);
    expect(audio[1]!.startMs).toBe(1000);
    expect(audio.every((c) => !c.linkId)).toBe(true);

    const viaCommand = applyCommand(
      { ...start, project: locked, selectedClipId: "a1", selectedClipIds: ["a1"] },
      { type: "split" },
    );
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(viaCommand.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(2);
  });

  it("split at playhead through applyCommand cuts only the active track", () => {
    const start = linkedPair();
    const next = applyCommand(start, { type: "split" });
    expect(next.project.clips).toHaveLength(3);
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
    expect(next.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(2000);
    expect(splitAtPlayhead(start.project).error).toBeUndefined();
  });

  it("split at playhead cuts a linked pair when both tracks are selected", () => {
    const start = {
      ...linkedPair(),
      selectedClipId: "v1",
      selectedClipIds: ["v1", "a1"],
      selectedTrackIds: ["V1", "A1"] as TrackId[],
    };
    const next = applyCommand(start, { type: "split" });
    expect(next.project.clips).toHaveLength(4);
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(2);
  });

  it("move of one linked clip moves the mate by the same delta", () => {
    const start = linkedPair();
    const moved = moveClip(start.project, "v1", 400);
    expect(moved.error).toBeUndefined();
    expect(moved.project.clips.find((c) => c.id === "v1")!.startMs).toBe(400);
    expect(moved.project.clips.find((c) => c.id === "a1")!.startMs).toBe(400);
    expect(moved.project.clips.find((c) => c.id === "a1")!.trackId).toBe("A1");
  });

  it("move/split of an unlocked clip skips a disabled mate (P141)", () => {
    const start = linkedPair();
    const dimmed = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, enabled: false } : c)),
    };
    const moved = moveClip(dimmed, "v1", 400);
    expect(moved.error).toBeUndefined();
    expect(moved.project.clips.find((c) => c.id === "v1")!.startMs).toBe(400);
    expect(moved.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);
    expect(moved.project.clips.find((c) => c.id === "a1")!.enabled).toBe(false);
    expect(moved.project.clips.find((c) => c.id === "a1")!.linkId).toBe("lnk1");

    const viaMove = applyCommand(
      { ...start, project: dimmed, selectedClipId: "v1", selectedClipIds: ["v1"] },
      { type: "moveClips", clipIds: ["v1"], deltaMs: 400 },
    );
    expect(viaMove.project.clips.find((c) => c.id === "v1")!.startMs).toBe(400);
    expect(viaMove.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);

    const split = splitClipAt(dimmed, "v1", 1000);
    expect(split.error).toBeUndefined();
    const parked = split.project.clips.find((c) => c.id === "a1")!;
    expect(parked.startMs).toBe(0);
    expect(parked.durationMs).toBe(2000);
    expect(parked.enabled).toBe(false);
    expect(parked.linkId).toBeUndefined();
    const video = split.project.clips.filter((c) => c.trackId === "V1");
    expect(video).toHaveLength(2);
    expect(video.every((c) => !c.linkId)).toBe(true);
  });

  it("unlink then move one leaves the other", () => {
    const start = linkedPair();
    const unlinked = applyCommand(start, { type: "unlinkClips", clipId: "v1" });
    expect(unlinked.project.clips.every((c) => !c.linkId)).toBe(true);
    const moved = applyCommand(unlinked, {
      type: "moveClips",
      clipIds: ["v1"],
      deltaMs: 300,
    });
    expect(moved.project.clips.find((c) => c.id === "v1")!.startMs).toBe(300);
    expect(moved.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);
  });

  it("legacy JSON without linkId stays valid and unlinked", () => {
    const raw = JSON.parse(serializeProject(linkedPair().project)) as {
      clips: Array<Record<string, unknown>>;
    };
    delete raw.clips[0]!.linkId;
    delete raw.clips[1]!.linkId;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.clips[0]!.linkId).toBeUndefined();
    expect(loaded.clips[1]!.linkId).toBeUndefined();
  });

  it("lift-delete of one linked clip lifts the mate", () => {
    const start = linkedPair();
    const gone = applyCommand(start, { type: "liftDelete" });
    expect(gone.project.clips).toHaveLength(0);
  });

  it("copy/cut of one linked clip includes the unlocked mate (P131)", () => {
    const start = linkedPair();
    const copied = applyCommand(start, { type: "copy" });
    expect(copied.clipboard.map((c) => c.id).sort()).toEqual(["a1", "v1"]);
    expect(copied.status).toBe("Copied clips");
    expect(copied.project.clips).toHaveLength(2);

    const cut = applyCommand(start, { type: "cut" });
    expect(cut.project.clips).toHaveLength(0);
    expect(cut.clipboard.map((c) => c.id).sort()).toEqual(["a1", "v1"]);
    const pasted = applyCommand(
      { ...cut, project: { ...cut.project, playheadMs: 3000 } },
      { type: "paste" },
    );
    expect(pasted.project.clips).toHaveLength(2);
    const v = pasted.project.clips.find((c) => c.trackId === "V1")!;
    const a = pasted.project.clips.find((c) => c.trackId === "A1")!;
    expect(v.startMs).toBe(3000);
    expect(a.startMs).toBe(3000);
    expect(v.linkId).toBeTruthy();
    expect(v.linkId).toBe(a.linkId);
    expect(v.linkId).not.toBe("lnk1");
  });

  it("copy/cut of an unlocked clip skips a disabled mate (P143)", () => {
    const start = linkedPair();
    const dimmed = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, enabled: false } : c)),
    };
    const session = { ...start, project: dimmed, selectedClipId: "v1", selectedClipIds: ["v1"] };
    const copied = applyCommand(session, { type: "copy" });
    expect(copied.clipboard.map((c) => c.id)).toEqual(["v1"]);
    expect(copied.clipboard[0]!.enabled).not.toBe(false);

    const cut = applyCommand(session, { type: "cut" });
    expect(cut.clipboard.map((c) => c.id)).toEqual(["v1"]);
    expect(cut.project.clips).toHaveLength(1);
    const parked = cut.project.clips.find((c) => c.id === "a1")!;
    expect(parked.enabled).toBe(false);
    expect(parked.startMs).toBe(0);
    expect(parked.linkId).toBeUndefined();
  });

  it("duplicate of an unlocked clip skips a disabled mate (P143)", () => {
    const start = linkedPair();
    start.project = {
      ...start.project,
      playheadMs: 3000,
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, enabled: false } : c)),
    };
    const next = applyCommand(start, { type: "duplicate" });
    expect(next.project.clips).toHaveLength(3);
    const parked = next.project.clips.find((c) => c.id === "a1")!;
    expect(parked.enabled).toBe(false);
    expect(parked.startMs).toBe(0);
    expect(parked.linkId).toBe("lnk1");
    const clone = next.project.clips.find((c) => c.id !== "v1" && c.id !== "a1")!;
    expect(clone.trackId).toBe("V1");
    expect(clone.startMs).toBe(3000);
    expect(clone.enabled).not.toBe(false);
    expect(clone.linkId).toBeUndefined();
  });

  it("copy/cut of an unlocked clip skips a locked mate (P131)", () => {
    const start = linkedPair();
    const locked = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const session = { ...start, project: locked, selectedClipId: "a1", selectedClipIds: ["a1"] };
    const copied = applyCommand(session, { type: "copy" });
    expect(copied.clipboard.map((c) => c.id)).toEqual(["a1"]);

    const cut = applyCommand(session, { type: "cut" });
    expect(cut.clipboard.map((c) => c.id)).toEqual(["a1"]);
    expect(cut.project.clips).toHaveLength(1);
    expect(cut.project.clips.find((c) => c.id === "v1")!.locked).toBe(true);
    expect(cut.project.clips.find((c) => c.id === "v1")!.linkId).toBeUndefined();
  });

  it("duplicate of one linked clip clones the unlocked mate (P131)", () => {
    const start = linkedPair();
    start.project = { ...start.project, playheadMs: 3000 };
    const next = applyCommand(start, { type: "duplicate" });
    expect(next.project.clips).toHaveLength(4);
    const clones = next.project.clips.filter((c) => c.id !== "v1" && c.id !== "a1");
    expect(clones).toHaveLength(2);
    expect(clones.map((c) => c.trackId).sort()).toEqual(["A1", "V1"]);
    expect(clones.every((c) => c.startMs === 3000)).toBe(true);
    expect(clones[0]!.linkId).toBeTruthy();
    expect(clones[0]!.linkId).toBe(clones[1]!.linkId);
    expect(clones[0]!.linkId).not.toBe("lnk1");
    expect(next.project.clips.find((c) => c.id === "v1")!.linkId).toBe("lnk1");
  });

  it("lift-delete of an unlocked clip skips a locked mate and drops the pair (P129)", () => {
    const start = linkedPair();
    const locked = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const gone = applyCommand(
      { ...start, project: locked, selectedClipId: "a1", selectedClipIds: ["a1"] },
      { type: "liftDelete" },
    );
    expect(gone.project.clips).toHaveLength(1);
    const v1 = gone.project.clips.find((c) => c.id === "v1")!;
    expect(v1.locked).toBe(true);
    expect(v1.startMs).toBe(0);
    expect(v1.durationMs).toBe(2000);
    expect(v1.linkId).toBeUndefined();
    expect(gone.project.clips.find((c) => c.id === "a1")).toBeUndefined();
  });

  it("lift-delete of a selected locked clip still lifts the unlocked mate (P129)", () => {
    const start = linkedPair();
    const locked = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const gone = applyCommand(
      { ...start, project: locked, selectedClipId: "v1", selectedClipIds: ["v1"] },
      { type: "liftDelete" },
    );
    expect(gone.project.clips).toHaveLength(0);
  });

  it("move of a disabled clip does not drag a living mate (P151)", () => {
    const start = linkedPair();
    const dimmed = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, enabled: false } : c)),
    };
    const moved = moveClip(dimmed, "v1", 400);
    expect(moved.error).toBeUndefined();
    expect(moved.project.clips.find((c) => c.id === "v1")!.startMs).toBe(400);
    expect(moved.project.clips.find((c) => c.id === "v1")!.enabled).toBe(false);
    expect(moved.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);
    expect(moved.project.clips.find((c) => c.id === "a1")!.linkId).toBe("lnk1");

    const viaMove = applyCommand(
      { ...start, project: dimmed, selectedClipId: "v1", selectedClipIds: ["v1"] },
      { type: "moveClips", clipIds: ["v1"], deltaMs: 400 },
    );
    expect(viaMove.project.clips.find((c) => c.id === "v1")!.startMs).toBe(400);
    expect(viaMove.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);
  });

  it("lift-delete of a disabled clip does not delete a living mate (P151)", () => {
    const start = linkedPair();
    const dimmed = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, enabled: false } : c)),
    };
    const gone = applyCommand(
      { ...start, project: dimmed, selectedClipId: "v1", selectedClipIds: ["v1"] },
      { type: "liftDelete" },
    );
    expect(gone.project.clips.find((c) => c.id === "v1")).toBeUndefined();
    const living = gone.project.clips.find((c) => c.id === "a1")!;
    expect(living.startMs).toBe(0);
    expect(living.durationMs).toBe(2000);
    expect(living.enabled).not.toBe(false);
    expect(living.linkId).toBeUndefined();
  });

  it("lift-delete of an unlocked clip skips a disabled mate (P142)", () => {
    const start = linkedPair();
    const dimmed = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, enabled: false } : c)),
    };
    const gone = applyCommand(
      { ...start, project: dimmed, selectedClipId: "v1", selectedClipIds: ["v1"] },
      { type: "liftDelete" },
    );
    expect(gone.project.clips.find((c) => c.id === "v1")).toBeUndefined();
    const parked = gone.project.clips.find((c) => c.id === "a1")!;
    expect(parked.enabled).toBe(false);
    expect(parked.startMs).toBe(0);
    expect(parked.durationMs).toBe(2000);
    expect(parked.linkId).toBeUndefined();
  });

  it("ripple-delete of an unlocked clip skips a disabled mate (P142)", () => {
    const start = linkedPair();
    const project = {
      ...start.project,
      clips: [
        ...start.project.clips.map((c) => (c.id === "a1" ? { ...c, enabled: false } : c)),
        clip({
          id: "v2",
          assetId: "va",
          trackId: "V1",
          startMs: 2000,
          durationMs: 500,
        }),
      ],
    };
    const next = rippleDeleteClip(project, "v1");
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "v1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "a1")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "a1")!.linkId).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "v2")!.startMs).toBe(0);

    const viaCommand = applyCommand(
      { ...start, project, selectedClipId: "v1", selectedClipIds: ["v1"] },
      { type: "rippleDelete" },
    );
    expect(viaCommand.error).toBeNull();
    expect(viaCommand.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);
    expect(viaCommand.project.clips.find((c) => c.id === "v2")!.startMs).toBe(0);
  });

  it("ripple-delete of an unlocked clip skips a locked mate (P129)", () => {
    const start = linkedPair();
    const project = {
      ...start.project,
      clips: [
        ...start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
        clip({
          id: "a2",
          assetId: "va",
          trackId: "A1",
          startMs: 2000,
          durationMs: 500,
        }),
      ],
    };
    const next = rippleDeleteClip(project, "a1");
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "a1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "v1")!.locked).toBe(true);
    expect(next.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "v1")!.linkId).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "a2")!.startMs).toBe(0);

    const viaCommand = applyCommand(
      { ...start, project, selectedClipId: "a1", selectedClipIds: ["a1"] },
      { type: "rippleDelete" },
    );
    expect(viaCommand.error).toBeNull();
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(viaCommand.project.clips.find((c) => c.id === "a2")!.startMs).toBe(0);
  });

  it("slip of an unlocked clip skips a locked mate (P116)", () => {
    const start = linkedPair();
    start.project.assets = [
      asset({
        id: "va",
        kind: "video",
        durationMs: 4000,
        objectUrl: "blob:v",
        hasAudio: true,
      }),
    ];
    const locked = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const slipped = slipClip(locked, "a1", 200);
    expect(slipped.error).toBeUndefined();
    expect(slipped.project.clips.find((c) => c.id === "a1")!.sourceInMs).toBe(200);
    expect(slipped.project.clips.find((c) => c.id === "v1")!.sourceInMs).toBe(0);
    expect(slipped.project.clips.find((c) => c.id === "v1")!.locked).toBe(true);
  });

  it("slip of one linked clip applies the same source delta to the mate", () => {
    const start = linkedPair();
    start.project.assets = [
      asset({
        id: "va",
        kind: "video",
        durationMs: 4000,
        objectUrl: "blob:v",
        hasAudio: true,
      }),
    ];
    const slipped = slipClip(start.project, "v1", 200);
    expect(slipped.error).toBeUndefined();
    const v = slipped.project.clips.find((c) => c.id === "v1")!;
    const a = slipped.project.clips.find((c) => c.id === "a1")!;
    expect(v.startMs).toBe(0);
    expect(v.durationMs).toBe(2000);
    expect(v.sourceInMs).toBe(200);
    expect(v.sourceOutMs).toBe(2200);
    expect(a.startMs).toBe(0);
    expect(a.durationMs).toBe(2000);
    expect(a.sourceInMs).toBe(200);
    expect(a.sourceOutMs).toBe(2200);
  });

  it("slip blocked by mate source bounds moves neither clip", () => {
    const start = linkedPair();
    start.project.assets = [
      asset({ id: "va", kind: "video", durationMs: 4000, objectUrl: "blob:v", hasAudio: true }),
      asset({ id: "aa", kind: "audio", durationMs: 2000, objectUrl: "blob:a" }),
    ];
    start.project.clips = start.project.clips.map((c) =>
      c.id === "a1" ? { ...c, assetId: "aa" } : c,
    );
    const blocked = slipClip(start.project, "v1", 200);
    expect(blocked.project).toBe(start.project);
    expect(blocked.error).toMatch(/slip/i);
    expect(blocked.project.clips.find((c) => c.id === "v1")!.sourceInMs).toBe(0);
    expect(blocked.project.clips.find((c) => c.id === "a1")!.sourceInMs).toBe(0);
  });

  it("setClipRate on a linked clip sets the same rate and resizes both durations", () => {
    const start = linkedPair();
    const next = setClipRate(start.project, "v1", 2);
    expect(next.error).toBeUndefined();
    const v = next.project.clips.find((c) => c.id === "v1")!;
    const a = next.project.clips.find((c) => c.id === "a1")!;
    expect(v.rate).toBe(2);
    expect(a.rate).toBe(2);
    expect(v.durationMs).toBe(1000);
    expect(a.durationMs).toBe(1000);
    expect(v.sourceInMs).toBe(0);
    expect(v.sourceOutMs).toBe(2000);
    expect(a.sourceInMs).toBe(0);
    expect(a.sourceOutMs).toBe(2000);
    expect(v.startMs).toBe(0);
    expect(a.startMs).toBe(0);
  });

  it("setClipRate no-ops both when the mate would overlap the next clip", () => {
    const start = linkedPair();
    start.project.clips = [
      ...start.project.clips,
      clip({ id: "a2", assetId: "va", trackId: "A1", startMs: 2000, durationMs: 500 }),
    ];
    const rejected = setClipRate(start.project, "v1", 0.5);
    expect(rejected.project).toBe(start.project);
    expect(rejected.error).toMatch(/overlap/i);
    expect(rejected.project.clips.find((c) => c.id === "v1")!.rate).toBe(1);
    expect(rejected.project.clips.find((c) => c.id === "a1")!.rate).toBe(1);
    expect(rejected.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
  });

  it("setClipRate of an unlocked clip skips a locked mate (P117)", () => {
    const start = linkedPair();
    const locked = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const next = setClipRate(locked, "a1", 2);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "a1")!.rate).toBe(2);
    expect(next.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "v1")!.rate).toBe(1);
    expect(next.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "v1")!.locked).toBe(true);

    const viaCommand = applyCommand(
      { ...start, project: locked, selectedClipId: "a1", selectedClipIds: ["a1"] },
      { type: "setClipRate", clipId: "a1", rate: 2 },
    );
    expect(viaCommand.project.clips.find((c) => c.id === "a1")!.rate).toBe(2);
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.rate).toBe(1);
    expect(viaCommand.error).toBeNull();
  });

  it("roll of an unlocked pair skips locked mates (P119)", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 4000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = projectWith(
      [
        clip({
          id: "v1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnk1",
        }),
        clip({
          id: "v2",
          assetId: "va",
          trackId: "V1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 1000,
          sourceOutMs: 2000,
          linkId: "lnk2",
        }),
        clip({
          id: "a1",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnk1",
          locked: true,
        }),
        clip({
          id: "a2",
          assetId: "va",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 1000,
          sourceOutMs: 2000,
          linkId: "lnk2",
          locked: true,
        }),
      ],
      [va],
    );
    const rolled = rollEdit({ ...start, snap: false }, "v1", "v2", 1200);
    expect(rolled.error).toBeUndefined();
    const v1 = rolled.project.clips.find((c) => c.id === "v1")!;
    const v2 = rolled.project.clips.find((c) => c.id === "v2")!;
    const a1 = rolled.project.clips.find((c) => c.id === "a1")!;
    const a2 = rolled.project.clips.find((c) => c.id === "a2")!;
    expect(v1.durationMs).toBe(1200);
    expect(v1.sourceOutMs).toBe(1200);
    expect(v2.startMs).toBe(1200);
    expect(v2.durationMs).toBe(800);
    expect(v2.sourceInMs).toBe(1200);
    expect(a1.startMs).toBe(0);
    expect(a1.durationMs).toBe(1000);
    expect(a1.sourceOutMs).toBe(1000);
    expect(a1.locked).toBe(true);
    expect(a2.startMs).toBe(1000);
    expect(a2.durationMs).toBe(1000);
    expect(a2.sourceInMs).toBe(1000);
    expect(a2.locked).toBe(true);

    const viaCommand = applyCommand(
      {
        ...createSession(createMemoryBlobStore()),
        project: { ...start, snap: false },
        selectedClipId: "v1",
        selectedClipIds: ["v1"],
      },
      { type: "rollEdit", clipId: "v1", edge: "out", nextEdgeMs: 1200 },
    );
    expect(viaCommand.error).toBeNull();
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(1200);
    expect(viaCommand.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(1000);
    expect(viaCommand.project.clips.find((c) => c.id === "a2")!.startMs).toBe(1000);
  });

  it("roll of a linked pair applies the same cut to unlocked mates", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 4000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = projectWith(
      [
        clip({
          id: "v1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnk1",
        }),
        clip({
          id: "v2",
          assetId: "va",
          trackId: "V1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 1000,
          sourceOutMs: 2000,
          linkId: "lnk2",
        }),
        clip({
          id: "a1",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnk1",
        }),
        clip({
          id: "a2",
          assetId: "va",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 1000,
          sourceOutMs: 2000,
          linkId: "lnk2",
        }),
      ],
      [va],
    );
    const rolled = rollEdit({ ...start, snap: false }, "v1", "v2", 1200);
    expect(rolled.error).toBeUndefined();
    expect(rolled.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(1200);
    expect(rolled.project.clips.find((c) => c.id === "a1")!.sourceOutMs).toBe(1200);
    expect(rolled.project.clips.find((c) => c.id === "a2")!.startMs).toBe(1200);
    expect(rolled.project.clips.find((c) => c.id === "a2")!.durationMs).toBe(800);
    expect(rolled.project.clips.find((c) => c.id === "a2")!.sourceInMs).toBe(1200);
  });

  it("slide of an unlocked mid skips locked mates (P120)", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 8000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = projectWith(
      [
        clip({
          id: "vl",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnL",
        }),
        clip({
          id: "vm",
          assetId: "va",
          trackId: "V1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 200,
          sourceOutMs: 1200,
          linkId: "lnM",
        }),
        clip({
          id: "vr",
          assetId: "va",
          trackId: "V1",
          startMs: 2000,
          durationMs: 1000,
          sourceInMs: 400,
          sourceOutMs: 1400,
          linkId: "lnR",
        }),
        clip({
          id: "al",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnL",
          locked: true,
        }),
        clip({
          id: "am",
          assetId: "va",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 200,
          sourceOutMs: 1200,
          linkId: "lnM",
          locked: true,
        }),
        clip({
          id: "ar",
          assetId: "va",
          trackId: "A1",
          startMs: 2000,
          durationMs: 1000,
          sourceInMs: 400,
          sourceOutMs: 1400,
          linkId: "lnR",
          locked: true,
        }),
      ],
      [va],
    );
    const slid = slideClip({ ...start, snap: false }, "vm", 200);
    expect(slid.error).toBeUndefined();
    expect(slid.project.clips.find((c) => c.id === "vm")!.startMs).toBe(1200);
    expect(slid.project.clips.find((c) => c.id === "vl")!.durationMs).toBe(1200);
    expect(slid.project.clips.find((c) => c.id === "vr")!.startMs).toBe(2200);
    expect(slid.project.clips.find((c) => c.id === "al")!.durationMs).toBe(1000);
    expect(slid.project.clips.find((c) => c.id === "al")!.sourceOutMs).toBe(1000);
    expect(slid.project.clips.find((c) => c.id === "am")!.startMs).toBe(1000);
    expect(slid.project.clips.find((c) => c.id === "ar")!.startMs).toBe(2000);
    expect(slid.project.clips.find((c) => c.id === "ar")!.durationMs).toBe(1000);
    expect(slid.project.clips.find((c) => c.id === "ar")!.sourceInMs).toBe(400);

    const viaCommand = applyCommand(
      {
        ...createSession(createMemoryBlobStore()),
        project: { ...start, snap: false },
        selectedClipId: "vm",
        selectedClipIds: ["vm"],
      },
      { type: "slideClip", clipId: "vm", deltaMs: 200 },
    );
    expect(viaCommand.error).toBeNull();
    expect(viaCommand.project.clips.find((c) => c.id === "vm")!.startMs).toBe(1200);
    expect(viaCommand.project.clips.find((c) => c.id === "am")!.startMs).toBe(1000);
  });

  it("slide of a linked mid applies the same delta to unlocked mates", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 8000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = projectWith(
      [
        clip({
          id: "vl",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnL",
        }),
        clip({
          id: "vm",
          assetId: "va",
          trackId: "V1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 200,
          sourceOutMs: 1200,
          linkId: "lnM",
        }),
        clip({
          id: "vr",
          assetId: "va",
          trackId: "V1",
          startMs: 2000,
          durationMs: 1000,
          sourceInMs: 400,
          sourceOutMs: 1400,
          linkId: "lnR",
        }),
        clip({
          id: "al",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          linkId: "lnL",
        }),
        clip({
          id: "am",
          assetId: "va",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 200,
          sourceOutMs: 1200,
          linkId: "lnM",
        }),
        clip({
          id: "ar",
          assetId: "va",
          trackId: "A1",
          startMs: 2000,
          durationMs: 1000,
          sourceInMs: 400,
          sourceOutMs: 1400,
          linkId: "lnR",
        }),
      ],
      [va],
    );
    const slid = slideClip({ ...start, snap: false }, "vm", 200);
    expect(slid.error).toBeUndefined();
    expect(slid.project.clips.find((c) => c.id === "al")!.durationMs).toBe(1200);
    expect(slid.project.clips.find((c) => c.id === "al")!.sourceOutMs).toBe(1200);
    expect(slid.project.clips.find((c) => c.id === "am")!.startMs).toBe(1200);
    expect(slid.project.clips.find((c) => c.id === "am")!.sourceInMs).toBe(200);
    expect(slid.project.clips.find((c) => c.id === "ar")!.startMs).toBe(2200);
    expect(slid.project.clips.find((c) => c.id === "ar")!.durationMs).toBe(800);
    expect(slid.project.clips.find((c) => c.id === "ar")!.sourceInMs).toBe(600);
  });

  it("ripple-trim of an unlocked clip skips a locked mate (P121)", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 4000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = projectWith(
      [
        clip({
          id: "v1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
          locked: true,
        }),
        clip({
          id: "v2",
          assetId: "va",
          trackId: "V1",
          startMs: 2000,
          durationMs: 500,
          sourceInMs: 0,
          sourceOutMs: 500,
        }),
        clip({
          id: "a1",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
        }),
        clip({
          id: "a2",
          assetId: "va",
          trackId: "A1",
          startMs: 2000,
          durationMs: 500,
          sourceInMs: 0,
          sourceOutMs: 500,
        }),
      ],
      [va],
    );
    const out = rippleTrimClip({ ...start, snap: false }, "a1", "out", 800);
    expect(out.error).toBeUndefined();
    expect(out.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(800);
    expect(out.project.clips.find((c) => c.id === "a1")!.sourceOutMs).toBe(800);
    expect(out.project.clips.find((c) => c.id === "a2")!.startMs).toBe(800);
    expect(out.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(out.project.clips.find((c) => c.id === "v1")!.locked).toBe(true);
    expect(out.project.clips.find((c) => c.id === "v2")!.startMs).toBe(2000);

    const inn = rippleTrimClip({ ...start, snap: false }, "a1", "in", 200);
    expect(inn.error).toBeUndefined();
    expect(inn.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);
    expect(inn.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(1800);
    expect(inn.project.clips.find((c) => c.id === "a1")!.sourceInMs).toBe(200);
    expect(inn.project.clips.find((c) => c.id === "a2")!.startMs).toBe(1800);
    expect(inn.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(inn.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(inn.project.clips.find((c) => c.id === "v1")!.sourceInMs).toBe(0);

    const viaCommand = applyCommand(
      {
        ...createSession(createMemoryBlobStore()),
        project: { ...start, snap: false, playheadMs: 800 },
        selectedClipId: "a1",
        selectedClipIds: ["a1"],
      },
      { type: "rippleTrimToPlayhead", edge: "out" },
    );
    expect(viaCommand.error).toBeNull();
    expect(viaCommand.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(800);
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(viaCommand.project.clips.find((c) => c.id === "a2")!.startMs).toBe(800);
  });

  it("ripple-trim of a linked pair still packs both unlocked tracks", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 4000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = projectWith(
      [
        clip({
          id: "v1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
        }),
        clip({
          id: "v2",
          assetId: "va",
          trackId: "V1",
          startMs: 2000,
          durationMs: 500,
        }),
        clip({
          id: "a1",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
        }),
        clip({
          id: "a2",
          assetId: "va",
          trackId: "A1",
          startMs: 2000,
          durationMs: 500,
        }),
      ],
      [va],
    );
    const out = rippleTrimClip({ ...start, snap: false }, "a1", "out", 800);
    expect(out.error).toBeUndefined();
    expect(out.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(800);
    expect(out.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(800);
    expect(out.project.clips.find((c) => c.id === "a2")!.startMs).toBe(800);
    expect(out.project.clips.find((c) => c.id === "v2")!.startMs).toBe(800);
  });

  it("Q/W skip a selected locked clip and ripple-trim the unlocked mate (P122)", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 4000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = projectWith(
      [
        clip({
          id: "v1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
          locked: true,
        }),
        clip({
          id: "a1",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
        }),
        clip({
          id: "a2",
          assetId: "va",
          trackId: "A1",
          startMs: 2000,
          durationMs: 500,
        }),
      ],
      [va],
    );
    const viaCommand = applyCommand(
      {
        ...createSession(createMemoryBlobStore()),
        project: { ...start, snap: false, playheadMs: 800 },
        selectedClipId: "v1",
        selectedClipIds: ["v1"],
      },
      { type: "rippleTrimToPlayhead", edge: "out" },
    );
    expect(viaCommand.error).toBeNull();
    expect(viaCommand.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(800);
    expect(viaCommand.project.clips.find((c) => c.id === "a2")!.startMs).toBe(800);
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.locked).toBe(true);
    expect(viaCommand.selectedClipId).toBe("a1");
  });

  it("ripple-delete of a pair refuses when a later locked clip sits on the mate track (P128)", () => {
    const start = linkedPair();
    const project = {
      ...start.project,
      clips: [
        ...start.project.clips,
        clip({
          id: "a2",
          assetId: "va",
          trackId: "A1",
          startMs: 2000,
          durationMs: 500,
          locked: true,
        }),
      ],
    };
    const blocked = rippleDeleteClip(project, "v1");
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.project).toBe(project);
    expect(blocked.project.clips.find((c) => c.id === "v1")).toBeDefined();
    expect(blocked.project.clips.find((c) => c.id === "a1")).toBeDefined();
    expect(blocked.project.clips.find((c) => c.id === "a2")!.startMs).toBe(2000);
  });

  it("setClipFades on an unlocked clip skips a locked mate (P123)", () => {
    const start = linkedPair();
    const locked = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const next = setClipFades(locked, "a1", 200, 100);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "a1")!.fadeInMs).toBe(200);
    expect(next.project.clips.find((c) => c.id === "a1")!.fadeOutMs).toBe(100);
    expect(next.project.clips.find((c) => c.id === "v1")!.fadeInMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "v1")!.fadeOutMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "v1")!.locked).toBe(true);

    const viaCommand = applyCommand(
      { ...start, project: locked, selectedClipId: "a1", selectedClipIds: ["a1"] },
      { type: "setClipFades", clipId: "a1", fadeInMs: 200, fadeOutMs: 100 },
    );
    expect(viaCommand.error).toBeNull();
    expect(viaCommand.project.clips.find((c) => c.id === "a1")!.fadeInMs).toBe(200);
    expect(viaCommand.project.clips.find((c) => c.id === "v1")!.fadeInMs).toBe(0);
  });

  it("setClipFades on a linked clip copies fades to the unlocked mate", () => {
    const start = linkedPair();
    const next = setClipFades(start.project, "v1", 200, 100);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "v1")!.fadeInMs).toBe(200);
    expect(next.project.clips.find((c) => c.id === "v1")!.fadeOutMs).toBe(100);
    expect(next.project.clips.find((c) => c.id === "a1")!.fadeInMs).toBe(200);
    expect(next.project.clips.find((c) => c.id === "a1")!.fadeOutMs).toBe(100);
  });

  it("group slip follows a living mate of a member, or no-ops all", () => {
    const va = asset({
      id: "va",
      kind: "video",
      durationMs: 4000,
      objectUrl: "blob:v",
      hasAudio: true,
    });
    const start = {
      ...projectWith(
        [
          clip({
            id: "v1",
            assetId: "va",
            trackId: "V1",
            startMs: 0,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
            linkId: "lnk1",
          }),
          clip({
            id: "v2",
            assetId: "va",
            trackId: "V1",
            startMs: 1000,
            durationMs: 1000,
            sourceInMs: 200,
            sourceOutMs: 1200,
          }),
          clip({
            id: "a1",
            assetId: "va",
            trackId: "A1",
            startMs: 0,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
            linkId: "lnk1",
          }),
        ],
        [va],
      ),
      snap: false,
    };
    const slipped = slipClips(start, ["v1", "v2"], 200);
    expect(slipped.error).toBeUndefined();
    expect(slipped.project.clips.find((c) => c.id === "v1")!.sourceInMs).toBe(200);
    expect(slipped.project.clips.find((c) => c.id === "v2")!.sourceInMs).toBe(400);
    expect(slipped.project.clips.find((c) => c.id === "a1")!.sourceInMs).toBe(200);
    expect(slipped.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(slipped.project.clips.find((c) => c.id === "v2")!.startMs).toBe(1000);
    expect(slipped.project.clips.find((c) => c.id === "a1")!.startMs).toBe(0);

    const tight = {
      ...start,
      assets: [
        va,
        asset({ id: "aa", kind: "audio", durationMs: 1000, objectUrl: "blob:a" }),
      ],
      clips: start.clips.map((c) => (c.id === "a1" ? { ...c, assetId: "aa" } : c)),
    };
    const blocked = slipClips(tight, ["v1", "v2"], 200);
    expect(blocked.project).toBe(tight);
    expect(blocked.error).toMatch(/slip/i);
    expect(blocked.project.clips.find((c) => c.id === "v1")!.sourceInMs).toBe(0);
    expect(blocked.project.clips.find((c) => c.id === "v2")!.sourceInMs).toBe(200);
    expect(blocked.project.clips.find((c) => c.id === "a1")!.sourceInMs).toBe(0);
  });

  it("unlink then slip one leaves the other", () => {
    const start = linkedPair();
    start.project.assets = [
      asset({
        id: "va",
        kind: "video",
        durationMs: 4000,
        objectUrl: "blob:v",
        hasAudio: true,
      }),
    ];
    const unlinked = applyCommand(start, { type: "unlinkClips", clipId: "v1" });
    const slipped = applyCommand(unlinked, { type: "slip", clipId: "v1", deltaMs: 200 });
    expect(slipped.project.clips.find((c) => c.id === "v1")!.sourceInMs).toBe(200);
    expect(slipped.project.clips.find((c) => c.id === "a1")!.sourceInMs).toBe(0);
    expect(slipped.project.clips.find((c) => c.id === "a1")!.sourceOutMs).toBe(2000);
  });
});
