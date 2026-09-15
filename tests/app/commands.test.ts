import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { applyPlayhead, applySelect, createSession, selectionOf, type Session } from "../../src/app/session";
import { snapPlayheadSeek } from "../../src/core/timeline";
import { FRAME_MS, isTrackId } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { nextShuttleRate } from "../../src/core/playback";
import { asset, clip, projectWith } from "../helpers";

function twoClipSession(): Session {
  const a = asset({ id: "aa", kind: "audio", durationMs: 2000 });
  const first = clip({
    id: "c1",
    assetId: "aa",
    trackId: "A1",
    startMs: 0,
    durationMs: 1000,
  });
  const second = clip({
    id: "c2",
    assetId: "aa",
    trackId: "A1",
    startMs: 1000,
    durationMs: 500,
  });
  const other = clip({
    id: "c3",
    assetId: "aa",
    trackId: "A2",
    startMs: 1000,
    durationMs: 400,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith([first, second, other], [a]),
    selectedClipId: "c1",
  };
}

function clipStarts(session: Session): Record<string, number> {
  return Object.fromEntries(session.project.clips.map((c) => [c.id, c.startMs]));
}

describe("applyCommand determinism", () => {
  it("same session+command yields the same clips, tracks, and shuttleRate", () => {
    const start = twoClipSession();
    const commands = [
      { type: "rippleDelete" } as const,
      { type: "nudgeClip", deltaMs: FRAME_MS } as const,
      { type: "toggleSolo", trackId: "A1" } as const,
      { type: "shuttle", dir: 1 } as const,
      { type: "liftDelete" } as const,
      { type: "rippleTrim", clipId: "c1", edge: "out", nextEdgeMs: 800 } as const,
      { type: "select", clipId: "c2", toggle: true } as const,
      { type: "selectClips", clipIds: ["c2", "c3"], union: true } as const,
      { type: "selectAll" } as const,
      { type: "selectAllOnTrack" } as const,
      { type: "setClipsEnabled", enabled: false } as const,
      { type: "moveClips", clipIds: ["c1", "c3"], deltaMs: 200 } as const,
      { type: "slip", clipId: "c1", deltaMs: 200 } as const,
      { type: "slip", clipId: "c1", clipIds: ["c1", "c2"], deltaMs: 50 } as const,
      { type: "slideClip", clipId: "c2", deltaMs: 100 } as const,
      { type: "slideClip", clipId: "c1", clipIds: ["c1", "c2"], deltaMs: 50 } as const,
      { type: "copy" } as const,
      { type: "liftRange" } as const,
      { type: "extractRange" } as const,
      { type: "setClipFades", clipId: "c1", fadeInMs: 200, fadeOutMs: 100 } as const,
      { type: "setClipRate", clipId: "c1", rate: 2 } as const,
      { type: "setTrackPan", trackId: "A1", pan: -0.5 } as const,
      { type: "unlinkClips", clipId: "c1" } as const,
      { type: "setTransition", transitionType: "crossfade", durationMs: 400 } as const,
      { type: "gotoNextEdit" } as const,
      { type: "gotoPrevEdit" } as const,
      { type: "relinkClips", clipIds: ["c1"], assetId: "aa" } as const,
      { type: "closeGap" } as const,
      { type: "rippleTrimToPlayhead", edge: "in" } as const,
      { type: "rippleTrimToPlayhead", edge: "out" } as const,
      { type: "setFrontVideoTrack", trackId: "V1" } as const,
      { type: "insertVisEvent" } as const,
      { type: "selectVisEvent", eventId: "none" } as const,
    ];
    for (const command of commands) {
      const a = applyCommand(start, command);
      const b = applyCommand(start, command);
      expect(clipStarts(a)).toEqual(clipStarts(b));
      expect(a.project.tracks.map((t) => ({ id: t.id, solo: t.solo, muted: t.muted }))).toEqual(
        b.project.tracks.map((t) => ({ id: t.id, solo: t.solo, muted: t.muted })),
      );
      expect(a.shuttleRate).toBe(b.shuttleRate);
      expect(a.playing).toBe(b.playing);
      expect(a.selectedClipId).toBe(b.selectedClipId);
    }
  });

  it("ripple-deletes A1@0 and shifts the later A1 clip; A2 is unchanged", () => {
    const next = applyCommand(twoClipSession(), { type: "rippleDelete" });
    expect(next.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
    expect(next.selectedClipId).toBeNull();
  });

  it("ripple-delete of a selected disabled clip does not pack later enabled (P149)", () => {
    const start = twoClipSession();
    start.project = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "c1" ? { ...c, enabled: false } : c)),
    };
    const blocked = applyCommand(start, { type: "rippleDelete" });
    expect(blocked.error).toMatch(/disabled/i);
    expect(blocked.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
    expect(blocked.project.clips.find((c) => c.id === "c1")!.enabled).toBe(false);
    expect(blocked.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(blocked.history.past.length).toBe(start.history.past.length);
  });

  it("ripple-delete refuses to pack a later locked clip (P128)", () => {
    const start = twoClipSession();
    start.project = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "c2" ? { ...c, locked: true } : c)),
    };
    const blocked = applyCommand(start, { type: "rippleDelete" });
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
    expect(blocked.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(blocked.history.past.length).toBe(start.history.past.length);
  });

  it("undo restores a ripple delete", () => {
    const start = twoClipSession();
    const deleted = applyCommand(start, { type: "rippleDelete" });
    const undone = applyCommand(deleted, { type: "undo" });
    expect(clipStarts(undone)).toEqual(clipStarts(start));
    expect(undone.project.clips).toHaveLength(3);
  });

  it("ripple-trims first out and pulls the later A1 clip; lift-trim does not", () => {
    const start = twoClipSession();
    start.project = { ...start.project, snap: false };
    const lifted = applyCommand(start, { type: "liftTrim", clipId: "c1", edge: "out", nextEdgeMs: 800 });
    expect(lifted.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    const rippled = applyCommand(start, { type: "rippleTrim", clipId: "c1", edge: "out", nextEdgeMs: 800 });
    expect(rippled.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(800);
    expect(rippled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
    expect(rippled.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
    const undone = applyCommand(rippled, { type: "undo" });
    expect(clipStarts(undone)).toEqual(clipStarts(start));
  });

  it("rolls an abutting cut +200 and undo restores both clips", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 2000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "c2",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "c1",
    };
    const rolled = applyCommand(start, { type: "rollEdit", clipId: "c1", edge: "out", nextEdgeMs: 1200 });
    expect(rolled.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1200);
    expect(rolled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1200);
    expect(rolled.project.clips.find((c) => c.id === "c2")!.durationMs).toBe(800);
    const undone = applyCommand(rolled, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
    expect(undone.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });

  it("rollEdit does not roll a later disabled abutting take (P138)", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 2000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "c2",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
              enabled: false,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "c1",
    };
    const rolled = applyCommand(start, {
      type: "rollEdit",
      clipId: "c1",
      edge: "out",
      nextEdgeMs: 1200,
    });
    expect(rolled.error).toMatch(/abutting/i);
    expect(rolled.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
    expect(rolled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(rolled.project.clips.find((c) => c.id === "c2")!.enabled).toBe(false);
    expect(rolled.history.past).toHaveLength(0);
  });

  it("rollEdit from a disabled clip does not move the living neighbor (P147)", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 2000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "c2",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
              enabled: false,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "c2",
    };
    const rolled = applyCommand(start, {
      type: "rollEdit",
      clipId: "c2",
      edge: "in",
      nextEdgeMs: 800,
    });
    expect(rolled.error).toMatch(/abutting/i);
    expect(rolled.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
    expect(rolled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(rolled.history.past).toHaveLength(0);
  });

  it("slide of a disabled clip does not trim living neighbors (P150)", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "L",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "M",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
              enabled: false,
            }),
            clip({
              id: "R",
              assetId: "aa",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "M",
    };
    const slid = applyCommand(start, { type: "slideClip", clipId: "M", deltaMs: 200 });
    expect(slid.error).toMatch(/disabled/i);
    expect(slid.project.clips.find((c) => c.id === "L")!.durationMs).toBe(1000);
    expect(slid.project.clips.find((c) => c.id === "M")!.startMs).toBe(1000);
    expect(slid.project.clips.find((c) => c.id === "M")!.enabled).toBe(false);
    expect(slid.project.clips.find((c) => c.id === "R")!.startMs).toBe(2000);
    expect(slid.history.past).toHaveLength(0);
  });

  it("nudge moves startMs by FRAME_MS and clamps at 0", () => {
    const start = twoClipSession();
    const right = applyCommand(start, { type: "nudgeClip", deltaMs: FRAME_MS });
    expect(right.project.clips.find((c) => c.id === "c1")!.startMs).toBe(FRAME_MS);
    expect(right.project.clips.find((c) => c.id === "c1")!.trackId).toBe("A1");

    const left = applyCommand(start, { type: "nudgeClip", deltaMs: -FRAME_MS });
    expect(left.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);

    const ten = applyCommand(right, { type: "nudgeClip", deltaMs: -10 * FRAME_MS });
    expect(ten.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
  });

  it("snaps keyboard nudge toward nearby edges, not back onto itself (P87)", () => {
    const start = twoClipSession();
    const near = {
      ...start,
      project: {
        ...start.project,
        markers: [{ id: "m1", timeMs: 2000, label: "M" }],
        clips: start.project.clips.map((c) => (c.id === "c1" ? { ...c, startMs: 1930 } : c)),
      },
    };
    const snapped = applyCommand(near, { type: "nudgeClip", deltaMs: FRAME_MS });
    expect(snapped.project.clips.find((c) => c.id === "c1")!.startMs).toBe(2000);

    const off = applyCommand(
      { ...near, project: { ...near.project, snap: false } },
      { type: "nudgeClip", deltaMs: FRAME_MS },
    );
    expect(off.project.clips.find((c) => c.id === "c1")!.startMs).toBeCloseTo(1930 + FRAME_MS, 5);

    const leave = applyCommand(snapped, { type: "nudgeClip", deltaMs: FRAME_MS });
    expect(leave.project.clips.find((c) => c.id === "c1")!.startMs).toBeCloseTo(2000 + FRAME_MS, 5);
  });

  it("toggles clip ids in one selection source of truth", () => {
    const start = twoClipSession();
    const added = applyCommand(start, { type: "select", clipId: "c2", toggle: true });
    expect(selectionOf(added)).toEqual(["c2", "c1"]);
    expect(added.selectedClipId).toBe("c2");
    expect(added.selectedClipIds).toEqual(["c2", "c1"]);

    const removed = applyCommand(added, { type: "select", clipId: "c1", toggle: true });
    expect(selectionOf(removed)).toEqual(["c2"]);
    expect(removed.selectedClipId).toBe("c2");

    const exclusive = applyCommand(added, { type: "select", clipId: "c3" });
    expect(selectionOf(exclusive)).toEqual(["c3"]);

    const cleared = applyCommand(exclusive, { type: "select", clipId: null });
    expect(selectionOf(cleared)).toEqual([]);
    expect(cleared.selectedClipId).toBeNull();
  });

  it("selectClips replaces or unions; group move still uses the selection", () => {
    const start = twoClipSession();
    const boxed = applyCommand(start, { type: "selectClips", clipIds: ["c2", "c3"] });
    expect(selectionOf(boxed)).toEqual(["c2", "c3"]);
    expect(boxed.history.past.length).toBe(start.history.past.length);
    const unioned = applyCommand(boxed, { type: "selectClips", clipIds: ["c1"], union: true });
    expect(selectionOf(unioned)).toEqual(["c2", "c3", "c1"]);
    const moved = applyCommand(unioned, {
      type: "moveClips",
      clipIds: selectionOf(unioned),
      deltaMs: 50,
    });
    expect(moved.project.clips.find((c) => c.id === "c1")!.startMs).toBe(50);
    expect(moved.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1050);
    expect(moved.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1050);
  });

  it("group-moves selected clips by one delta and clamps at 0; one undo restores all", () => {
    const start = applyCommand(twoClipSession(), { type: "select", clipId: "c3", toggle: true });
    const moved = applyCommand(start, { type: "moveClips", clipIds: selectionOf(start), deltaMs: 200 });
    expect(moved.project.clips.find((c) => c.id === "c1")!.startMs).toBe(200);
    expect(moved.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(moved.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1200);
    expect(moved.history.past).toHaveLength(1);

    const clamped = applyCommand(moved, { type: "moveClips", clipIds: ["c1", "c3"], deltaMs: -500 });
    expect(clamped.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
    expect(clamped.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);

    const undone = applyCommand(moved, { type: "undo" });
    expect(clipStarts(undone)).toEqual(clipStarts(start));
  });

  it("group lift-delete removes all selected and leaves neighbors; one undo restores", () => {
    const start = applyCommand(twoClipSession(), { type: "select", clipId: "c3", toggle: true });
    const deleted = applyCommand(start, { type: "liftDelete" });
    expect(deleted.project.clips.map((c) => c.id)).toEqual(["c2"]);
    expect(deleted.project.clips[0]!.startMs).toBe(1000);
    expect(deleted.selectedClipId).toBeNull();
    expect(deleted.selectedClipIds).toEqual([]);
    const undone = applyCommand(deleted, { type: "undo" });
    expect(undone.project.clips).toHaveLength(3);
    expect(clipStarts(undone)).toEqual(clipStarts(start));
  });

  it("group ripple-delete is later-first per track; one undo restores neighbors", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith(
        [
          clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
          clip({ id: "c2", assetId: "aa", trackId: "A1", startMs: 1000, durationMs: 500 }),
          clip({ id: "c4", assetId: "aa", trackId: "A1", startMs: 2000, durationMs: 400 }),
          clip({ id: "c3", assetId: "aa", trackId: "A2", startMs: 1000, durationMs: 400 }),
        ],
        [a],
      ),
      selectedClipId: "c1",
      selectedClipIds: ["c1", "c2"],
    };
    const deleted = applyCommand(start, { type: "rippleDelete" });
    expect(deleted.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(deleted.project.clips.find((c) => c.id === "c2")).toBeUndefined();
    expect(deleted.project.clips.find((c) => c.id === "c4")!.startMs).toBe(500);
    expect(deleted.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
    const undone = applyCommand(deleted, { type: "undo" });
    expect(clipStarts(undone)).toEqual(clipStarts(start));
  });

  it("ripple-trims first in-edge and packs later clips; undo restores neighbors", () => {
    const start = twoClipSession();
    start.project = { ...start.project, snap: false };
    const lifted = applyCommand(start, { type: "liftTrim", clipId: "c1", edge: "in", nextEdgeMs: 200 });
    expect(lifted.project.clips.find((c) => c.id === "c1")!.startMs).toBe(200);
    expect(lifted.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);

    const rippled = applyCommand(start, { type: "rippleTrim", clipId: "c1", edge: "in", nextEdgeMs: 200 });
    const a = rippled.project.clips.find((c) => c.id === "c1")!;
    expect(a.startMs).toBe(0);
    expect(a.durationMs).toBe(800);
    expect(a.sourceInMs).toBe(200);
    expect(rippled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
    expect(rippled.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
    const undone = applyCommand(rippled, { type: "undo" });
    expect(clipStarts(undone)).toEqual(clipStarts(start));
    expect(undone.project.clips.find((c) => c.id === "c1")!.sourceInMs).toBe(0);
  });

  it("Split here snaps the click then splits at that playhead (P89)", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith([clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 4000 })], [a]),
        markers: [{ id: "m1", timeMs: 2000, label: "M" }],
        playheadMs: 0,
        snap: true,
      },
      selectedClipId: "c1",
    };
    const parked = applyPlayhead(applySelect(start, "c1"), snapPlayheadSeek(start.project, 2070));
    expect(parked.project.playheadMs).toBe(2000);
    const split = applyCommand(parked, { type: "split" });
    expect(split.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(2000);
    expect(split.project.clips.some((c) => c.id !== "c1" && c.startMs === 2000 && c.durationMs === 2000)).toBe(
      true,
    );

    const raw = applyPlayhead(
      applySelect({ ...start, project: { ...start.project, snap: false } }, "c1"),
      snapPlayheadSeek({ ...start.project, snap: false }, 2070),
    );
    expect(raw.project.playheadMs).toBe(2070);
  });

  it("split with many selected only cuts those under the playhead", () => {
    const base = twoClipSession();
    const start = applyCommand(
      { ...base, project: { ...base.project, playheadMs: 500 } },
      { type: "select", clipId: "c2", toggle: true },
    );
    expect(selectionOf(start)).toEqual(["c2", "c1"]);
    const split = applyCommand(start, { type: "split" });
    expect(split.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(3);
    expect(split.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(split.project.clips.find((c) => c.id === "c2")!.durationMs).toBe(500);
    const undone = applyCommand(split, { type: "undo" });
    expect(undone.project.clips).toHaveLength(3);
  });

  it("copy/paste selected group at playhead keeps relative time and tracks", () => {
    const selected = applyCommand(twoClipSession(), { type: "select", clipId: "c3", toggle: true });
    const copied = applyCommand(selected, { type: "copy" });
    expect(copied.clipboard).toHaveLength(2);
    expect(copied.project.clips).toHaveLength(3);
    expect(copied.status).toBe("Copied clips");

    const atHead = applyCommand(
      { ...copied, project: { ...copied.project, playheadMs: 2000 } },
      { type: "paste" },
    );
    expect(atHead.project.clips).toHaveLength(5);
    expect(atHead.status).toBe("Pasted clips");
    const originals = atHead.project.clips.filter((c) => c.id === "c1" || c.id === "c3");
    expect(originals.find((c) => c.id === "c1")!.startMs).toBe(0);
    expect(originals.find((c) => c.id === "c3")!.startMs).toBe(1000);
    const pasted = atHead.project.clips.filter((c) => c.id !== "c1" && c.id !== "c2" && c.id !== "c3");
    expect(pasted).toHaveLength(2);
    const a1 = pasted.find((c) => c.trackId === "A1")!;
    const a2 = pasted.find((c) => c.trackId === "A2")!;
    expect(a1.startMs).toBe(2000);
    expect(a2.startMs).toBe(3000);
    expect(a2.startMs - a1.startMs).toBe(1000);
    expect(selectionOf(atHead).sort()).toEqual([a1.id, a2.id].sort());
    const undone = applyCommand(atHead, { type: "undo" });
    expect(undone.project.clips).toHaveLength(3);
    expect(clipStarts(undone)).toEqual(clipStarts(copied));
  });

  it("cut removes the selected group; one undo restores them", () => {
    const selected = applyCommand(twoClipSession(), { type: "select", clipId: "c3", toggle: true });
    const start = twoClipSession();
    const cut = applyCommand(selected, { type: "cut" });
    expect(cut.project.clips.map((c) => c.id)).toEqual(["c2"]);
    expect(cut.clipboard).toHaveLength(2);
    expect(cut.selectedClipId).toBeNull();
    expect(cut.status).toBe("Cut clips");
    const undone = applyCommand(cut, { type: "undo" });
    expect(undone.project.clips).toHaveLength(3);
    expect(clipStarts(undone)).toEqual(clipStarts(start));
  });

  it("slips sourceIn/sourceOut and leaves start/duration; undo and asset clamp", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 3000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 2000,
              sourceInMs: 0,
              sourceOutMs: 2000,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "c1",
      selectedClipIds: ["c1"],
    };
    const slipped = applyCommand(start, { type: "slip", clipId: "c1", deltaMs: 200 });
    const c = slipped.project.clips.find((x) => x.id === "c1")!;
    expect(c.startMs).toBe(1000);
    expect(c.durationMs).toBe(2000);
    expect(c.sourceInMs).toBe(200);
    expect(c.sourceOutMs).toBe(2200);
    const undone = applyCommand(slipped, { type: "undo" });
    expect(undone.project.clips.find((x) => x.id === "c1")!.sourceInMs).toBe(0);

    const clamped = applyCommand(start, { type: "slip", clipId: "c1", deltaMs: 2000 });
    expect(clamped.project.clips.find((x) => x.id === "c1")!.sourceInMs).toBe(1000);
    expect(clamped.project.clips.find((x) => x.id === "c1")!.sourceOutMs).toBe(3000);
    expect(clamped.project.clips.find((x) => x.id === "c1")!.durationMs).toBe(2000);
    expect(clamped.project.clips.find((x) => x.id === "c1")!.startMs).toBe(1000);
  });

  it("slip with clipIds slips a contiguous block and undoes; neighbors stay", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "L",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "A",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 50,
              sourceOutMs: 1050,
            }),
            clip({
              id: "B",
              assetId: "aa",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              sourceInMs: 80,
              sourceOutMs: 1080,
            }),
            clip({
              id: "R",
              assetId: "aa",
              trackId: "A1",
              startMs: 3000,
              durationMs: 1000,
              sourceInMs: 400,
              sourceOutMs: 1400,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "A",
      selectedClipIds: ["A", "B"],
    };
    const slipped = applyCommand(start, {
      type: "slip",
      clipId: "A",
      clipIds: ["A", "B"],
      deltaMs: 200,
    });
    expect(slipped.status).toBe("Slipped clips");
    expect(slipped.project.clips.find((x) => x.id === "A")!.startMs).toBe(1000);
    expect(slipped.project.clips.find((x) => x.id === "B")!.startMs).toBe(2000);
    expect(slipped.project.clips.find((x) => x.id === "A")!.sourceInMs).toBe(250);
    expect(slipped.project.clips.find((x) => x.id === "B")!.sourceInMs).toBe(280);
    expect(slipped.project.clips.find((x) => x.id === "L")!.durationMs).toBe(1000);
    expect(slipped.project.clips.find((x) => x.id === "L")!.sourceOutMs).toBe(1000);
    expect(slipped.project.clips.find((x) => x.id === "R")!.startMs).toBe(3000);
    expect(slipped.history.past).toHaveLength(start.history.past.length + 1);
    const undone = applyCommand(slipped, { type: "undo" });
    expect(undone.project.clips.find((x) => x.id === "A")!.sourceInMs).toBe(50);
    expect(undone.project.clips.find((x) => x.id === "B")!.sourceInMs).toBe(80);
  });

  it("slideClip moves the middle clip and undoes", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "L",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "M",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 200,
              sourceOutMs: 1200,
            }),
            clip({
              id: "R",
              assetId: "aa",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              sourceInMs: 400,
              sourceOutMs: 1400,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "M",
      selectedClipIds: ["M"],
    };
    const slid = applyCommand(start, { type: "slideClip", clipId: "M", deltaMs: 200 });
    expect(slid.project.clips.find((x) => x.id === "M")!.startMs).toBe(1200);
    expect(slid.project.clips.find((x) => x.id === "M")!.sourceInMs).toBe(200);
    expect(slid.project.clips.find((x) => x.id === "L")!.durationMs).toBe(1200);
    expect(slid.project.clips.find((x) => x.id === "R")!.startMs).toBe(2200);
    const undone = applyCommand(slid, { type: "undo" });
    expect(undone.project.clips.find((x) => x.id === "M")!.startMs).toBe(1000);
    expect(undone.project.clips.find((x) => x.id === "L")!.durationMs).toBe(1000);
  });

  it("slideClip with clipIds slides a contiguous block and undoes", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "L",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "A",
              assetId: "aa",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 50,
              sourceOutMs: 1050,
            }),
            clip({
              id: "B",
              assetId: "aa",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              sourceInMs: 80,
              sourceOutMs: 1080,
            }),
            clip({
              id: "R",
              assetId: "aa",
              trackId: "A1",
              startMs: 3000,
              durationMs: 1000,
              sourceInMs: 400,
              sourceOutMs: 1400,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "A",
      selectedClipIds: ["A", "B"],
    };
    const slid = applyCommand(start, {
      type: "slideClip",
      clipId: "A",
      clipIds: ["A", "B"],
      deltaMs: 200,
    });
    expect(slid.project.clips.find((x) => x.id === "A")!.startMs).toBe(1200);
    expect(slid.project.clips.find((x) => x.id === "B")!.startMs).toBe(2200);
    expect(slid.project.clips.find((x) => x.id === "A")!.sourceInMs).toBe(50);
    expect(slid.project.clips.find((x) => x.id === "L")!.durationMs).toBe(1200);
    expect(slid.project.clips.find((x) => x.id === "R")!.startMs).toBe(3200);
    expect(slid.history.past).toHaveLength(start.history.past.length + 1);
    const undone = applyCommand(slid, { type: "undo" });
    expect(undone.project.clips.find((x) => x.id === "A")!.startMs).toBe(1000);
    expect(undone.project.clips.find((x) => x.id === "B")!.startMs).toBe(2000);
    expect(undone.project.clips.find((x) => x.id === "L")!.durationMs).toBe(1000);
  });

  it("liftRange leaves a gap; extractRange ripples closed; undo restores; video stays put", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const v = asset({ id: "vv", kind: "video", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 3000,
              sourceInMs: 0,
              sourceOutMs: 3000,
            }),
            clip({
              id: "v1",
              assetId: "vv",
              trackId: "V1",
              startMs: 0,
              durationMs: 800,
              sourceInMs: 0,
              sourceOutMs: 800,
            }),
          ],
          [a, v],
        ),
        inPointMs: 1000,
        outPointMs: 2000,
        snap: false,
      },
      selectedClipId: null,
      selectedClipIds: [],
    };
    const lifted = applyCommand(start, { type: "liftRange" });
    const a1 = lifted.project.clips.filter((c) => c.trackId === "A1").sort((x, y) => x.startMs - y.startMs);
    expect(a1).toHaveLength(2);
    expect(a1[0]!.startMs).toBe(0);
    expect(a1[0]!.durationMs).toBe(1000);
    expect(a1[1]!.startMs).toBe(2000);
    expect(lifted.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(lifted.selectedClipId).toBeNull();
    const undoneLift = applyCommand(lifted, { type: "undo" });
    expect(clipStarts(undoneLift)).toEqual(clipStarts(start));
    expect(undoneLift.project.clips).toHaveLength(2);

    const extracted = applyCommand(start, { type: "extractRange" });
    const a1e = extracted.project.clips.filter((c) => c.trackId === "A1").sort((x, y) => x.startMs - y.startMs);
    expect(a1e[1]!.startMs).toBe(1000);
    expect(extracted.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    const undoneEx = applyCommand(extracted, { type: "undo" });
    expect(clipStarts(undoneEx)).toEqual(clipStarts(start));
  });

  it("liftRange / extractRange no-op when IN/OUT is missing or inverted", () => {
    const start = twoClipSession();
    expect(applyCommand(start, { type: "liftRange" }).project.clips).toHaveLength(3);
    expect(applyCommand(start, { type: "extractRange" }).history.past).toHaveLength(0);
    const inverted = {
      ...start,
      project: { ...start.project, inPointMs: 2000, outPointMs: 1000 },
    };
    expect(applyCommand(inverted, { type: "liftRange" }).history.past).toHaveLength(0);
  });
});

describe("shuttle rate table", () => {
  it("L steps 0 → 1 → 2 → 4 and caps; J is the reverse; K is 0", () => {
    expect(nextShuttleRate(0, 1)).toBe(1);
    expect(nextShuttleRate(1, 1)).toBe(2);
    expect(nextShuttleRate(2, 1)).toBe(4);
    expect(nextShuttleRate(4, 1)).toBe(4);
    expect(nextShuttleRate(-2, 1)).toBe(1);

    expect(nextShuttleRate(0, -1)).toBe(-1);
    expect(nextShuttleRate(-1, -1)).toBe(-2);
    expect(nextShuttleRate(-2, -1)).toBe(-4);
    expect(nextShuttleRate(-4, -1)).toBe(-4);
    expect(nextShuttleRate(2, -1)).toBe(-1);

    expect(nextShuttleRate(4, 0)).toBe(0);
    expect(nextShuttleRate(-4, 0)).toBe(0);
  });

  it("applyCommand shuttle matches the rate table and Space resets to 1x", () => {
    let s = twoClipSession();
    s = applyCommand(s, { type: "shuttle", dir: 1 });
    expect(s.shuttleRate).toBe(1);
    expect(s.playing).toBe(true);
    s = applyCommand(s, { type: "shuttle", dir: 1 });
    expect(s.shuttleRate).toBe(2);
    s = applyCommand(s, { type: "shuttle", dir: 1 });
    expect(s.shuttleRate).toBe(4);
    s = applyCommand(s, { type: "shuttle", dir: 0 });
    expect(s.shuttleRate).toBe(0);
    expect(s.playing).toBe(false);
    s = applyCommand(s, { type: "playPause" });
    expect(s.shuttleRate).toBe(1);
    expect(s.playing).toBe(true);
    s = applyCommand(s, { type: "playPause" });
    expect(s.shuttleRate).toBe(0);
    expect(s.playing).toBe(false);
  });

  it("setTransition type/duration is undoable; no pair no-ops", () => {
    const a = asset({ id: "va", kind: "video", durationMs: 4000 });
    const b = asset({ id: "vb", kind: "video", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith(
        [
          clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
          clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
        ],
        [a, b],
      ),
      selectedClipId: "v1",
      selectedClipIds: ["v1"],
    };
    const typed = applyCommand(start, { type: "setTransition", transitionType: "crossfade" });
    expect(typed.project.transitions[0]?.type).toBe("crossfade");
    const dur = applyCommand(typed, { type: "setTransition", durationMs: 400 });
    expect(dur.project.transitions[0]?.durationMs).toBe(400);
    const undoneDur = applyCommand(dur, { type: "undo" });
    expect(undoneDur.project.transitions[0]?.durationMs).not.toBe(400);
    expect(undoneDur.project.transitions[0]?.type).toBe("crossfade");
    const undoneType = applyCommand(undoneDur, { type: "undo" });
    expect(undoneType.project.transitions).toEqual([]);
    const lonely: Session = {
      ...start,
      project: projectWith(
        [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 500 })],
        [a],
      ),
    };
    const noop = applyCommand(lonely, { type: "setTransition", transitionType: "fadeBlack" });
    expect(noop.project.transitions).toEqual([]);
    expect(noop).toBe(lonely);
  });
});

function mixedTrackSession(): Session {
  const v = asset({ id: "va", kind: "video", durationMs: 4000 });
  const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "v2", assetId: "va", trackId: "V2", startMs: 2000, durationMs: 1000 }),
        clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
      ],
      [v, a],
    ),
    selectedClipId: "v1",
    selectedClipIds: ["v1"],
  };
}

describe("applyCommand moveClips across same-kind tracks", () => {
  it("moves a video clip V1→V2", () => {
    const start = mixedTrackSession();
    const moved = applyCommand(start, {
      type: "moveClips",
      clipIds: ["v1"],
      deltaMs: 0,
      trackId: "V2",
    });
    expect(moved.project.clips.find((c) => c.id === "v1")!.trackId).toBe("V2");
    expect(moved.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(moved.error).toBeNull();
    expect(moved.history.past).toHaveLength(start.history.past.length + 1);
  });

  it("moves a video clip V2→V1", () => {
    const start = mixedTrackSession();
    const moved = applyCommand(start, {
      type: "moveClips",
      clipIds: ["v2"],
      deltaMs: 0,
      trackId: "V1",
    });
    expect(moved.project.clips.find((c) => c.id === "v2")!.trackId).toBe("V1");
    expect(moved.error).toBeNull();
  });

  it("moves an audio clip A1→A2", () => {
    const start = mixedTrackSession();
    const moved = applyCommand(start, {
      type: "moveClips",
      clipIds: ["a1"],
      deltaMs: 0,
      trackId: "A2",
    });
    expect(moved.project.clips.find((c) => c.id === "a1")!.trackId).toBe("A2");
    expect(moved.error).toBeNull();
  });

  it("video onto an A-track no-ops", () => {
    const start = mixedTrackSession();
    const next = applyCommand(start, {
      type: "moveClips",
      clipIds: ["v1"],
      deltaMs: 0,
      trackId: "A1",
    });
    expect(next.error).toMatch(/different kind/);
    expect(next.project.clips.find((c) => c.id === "v1")!.trackId).toBe("V1");
    expect(next.history.past).toHaveLength(start.history.past.length);
  });

  it("VIS overlay cannot land on V1", () => {
    expect(isTrackId("VIS")).toBe(false);
    const start = mixedTrackSession();
    const next = applyCommand(start, {
      type: "moveClips",
      clipIds: ["vis"],
      deltaMs: 0,
      trackId: "V1",
    });
    expect(next.error).toMatch(/not found/i);
    expect(next.project.clips).toEqual(start.project.clips);
    expect(next.project.visualizer).toEqual(start.project.visualizer);
    expect(next.history.past).toHaveLength(start.history.past.length);
  });

  it("undo restores trackId after V1→V2", () => {
    const start = mixedTrackSession();
    const moved = applyCommand(start, {
      type: "moveClips",
      clipIds: ["v1"],
      deltaMs: 0,
      trackId: "V2",
    });
    expect(moved.project.clips.find((c) => c.id === "v1")!.trackId).toBe("V2");
    const undone = applyCommand(moved, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "v1")!.trackId).toBe("V1");
    expect(undone.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
  });
});
