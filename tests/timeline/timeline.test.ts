import { describe, expect, it } from "vitest";
import { applyInAt, applyOutAt, createSession } from "../../src/app/session";
import {
  SNAP_THRESHOLD_MS,
  SPLIT_EDGE_GUARD_MS,
  type Project,
} from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject } from "../../src/core/project";
import {
  clearInOut,
  createHistory,
  moveClip,
  moveInOut,
  pushHistory,
  redo,
  setInPoint,
  setOutPoint,
  collectSnapTargets,
  snapPlayheadSeek,
  snapTime,
  splitClipAt,
  rippleDeleteClip,
  rippleDeleteClips,
  rippleTrimClip,
  moveClipsByDelta,
  deleteClips,
  pasteClips,
  slipClip,
  slipClips,
  slideClip,
  slideClips,
  liftRange,
  extractRange,
  rollEdit,
  abuttingNeighbor,
  toggleTrackMute,
  toggleTrackSolo,
  trimClip,
  undo,
} from "../../src/core/timeline";
import { asset, clip, projectWith } from "../helpers";

function base(): Project {
  return projectWith([
    clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 1000, durationMs: 2000, sourceInMs: 0, sourceOutMs: 2000 }),
  ]);
}

describe("timeline move/split/snap/undo", () => {
  it("moves a clip and clamps before 0", () => {
    const moved = moveClip(base(), "c1", 2500);
    expect(moved.project.clips[0]!.startMs).toBe(2500);
    const clamped = moveClip(base(), "c1", -400);
    expect(clamped.project.clips[0]!.startMs).toBe(0);
    expect(clamped.error).toBeUndefined();
  });

  it("rejects move to a different kind", () => {
    const result = moveClip(base(), "c1", 0, "A1");
    expect(result.error).toMatch(/different kind/);
    expect(result.project.clips[0]!.trackId).toBe("V1");
  });

  it("allows V1 to V2", () => {
    const result = moveClip(base(), "c1", 1000, "V2");
    expect(result.error).toBeUndefined();
    expect(result.project.clips[0]!.trackId).toBe("V2");
  });

  it("rejects VIS as a destination track", () => {
    const result = moveClip(base(), "c1", 1000, "VIS" as never);
    expect(result.error).toMatch(/different kind/);
    expect(result.project.clips[0]!.trackId).toBe("V1");
  });

  it("splits a clip and keeps source ranges", () => {
    const result = splitClipAt(base(), "c1", 1800);
    expect(result.error).toBeUndefined();
    expect(result.project.clips).toHaveLength(2);
    const [left, right] = result.project.clips;
    expect(left!.durationMs).toBe(800);
    expect(left!.sourceOutMs).toBe(800);
    expect(right!.startMs).toBe(1800);
    expect(right!.sourceInMs).toBe(800);
    expect(right!.durationMs).toBe(1200);
  });

  it("rejects split near edges", () => {
    const nearStart = splitClipAt(base(), "c1", 1000 + SPLIT_EDGE_GUARD_MS - 1);
    expect(nearStart.error).toMatch(/edge/);
    const nearEnd = splitClipAt(base(), "c1", 3000 - SPLIT_EDGE_GUARD_MS + 1);
    expect(nearEnd.error).toMatch(/edge/);
    expect(nearStart.project.clips).toHaveLength(1);
  });

  it("snaps to nearby targets", () => {
    const snapped = snapTime(97, [{ timeMs: 100, kind: "clip-start" }], 20);
    expect(snapped.snapped).toBe(true);
    expect(snapped.timeMs).toBe(100);
    const not = snapTime(200, [{ timeMs: 100, kind: "zero" }], 20);
    expect(not.snapped).toBe(false);
  });

  it("snaps a clip start to a marker inside the threshold", () => {
    const p: Project = {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 100 })],
        [asset({ id: "a", kind: "video", durationMs: 4000 })],
      ),
      snap: true,
      playheadMs: 0,
      markers: [{ id: "m1", timeMs: 2000, label: "M1" }],
    };
    const targets = collectSnapTargets(p, "c1");
    expect(targets.some((t) => t.kind === "marker" && t.timeMs === 2000)).toBe(true);
    const near = snapTime(2000 + SNAP_THRESHOLD_MS - 10, targets);
    expect(near.snapped).toBe(true);
    expect(near.timeMs).toBe(2000);
    expect(near.target?.kind).toBe("marker");
  });

  it("does not snap to a marker outside the threshold", () => {
    const p: Project = {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 100 })],
        [asset({ id: "a", kind: "video", durationMs: 4000 })],
      ),
      snap: true,
      playheadMs: 0,
      markers: [{ id: "m1", timeMs: 2000, label: "M1" }],
    };
    const far = snapTime(2000 + SNAP_THRESHOLD_MS + 10, collectSnapTargets(p, "c1"));
    expect(far.snapped).toBe(false);
    expect(far.timeMs).toBe(2000 + SNAP_THRESHOLD_MS + 10);
  });

  it("ignores markers when snap is off (only zero)", () => {
    const p: Project = {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 100 })],
        [asset({ id: "a", kind: "video", durationMs: 4000 })],
      ),
      snap: false,
      playheadMs: 500,
      inPointMs: 100,
      outPointMs: 300,
      markers: [{ id: "m1", timeMs: 2000, label: "M1" }],
    };
    expect(collectSnapTargets(p)).toEqual([{ timeMs: 0, kind: "zero" }]);
    const atMarker = snapTime(2000, collectSnapTargets(p));
    expect(atMarker.snapped).toBe(false);
    expect(atMarker.timeMs).toBe(2000);
  });

  it("ignoreClipId drops that clip's edges but keeps markers", () => {
    const p: Project = {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 1000, durationMs: 500 })],
        [asset({ id: "a", kind: "video", durationMs: 4000 })],
      ),
      snap: true,
      playheadMs: 0,
      markers: [{ id: "m1", timeMs: 1500, label: "M1" }],
    };
    const targets = collectSnapTargets(p, "c1");
    expect(targets.some((t) => t.kind === "clip-start" && t.timeMs === 1000)).toBe(false);
    expect(targets.some((t) => t.kind === "clip-end" && t.timeMs === 1500)).toBe(false);
    expect(targets.some((t) => t.kind === "marker" && t.timeMs === 1500)).toBe(true);
    const nearEdge = snapTime(1000 + 20, targets);
    expect(nearEdge.snapped).toBe(false);
    const nearMarker = snapTime(1500 + 20, targets);
    expect(nearMarker.snapped).toBe(true);
    expect(nearMarker.timeMs).toBe(1500);
    expect(nearMarker.target?.kind).toBe("marker");
  });

  it("skips disabled clip edges in snap targets (P126)", () => {
    const p: Project = {
      ...projectWith(
        [
          clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 1000 }),
          clip({
            id: "off",
            assetId: "a",
            trackId: "V2",
            startMs: 2000,
            durationMs: 1000,
            enabled: false,
          }),
        ],
        [asset({ id: "a", kind: "video", durationMs: 4000 })],
      ),
      snap: true,
      playheadMs: 0,
    };
    const targets = collectSnapTargets(p, "c1");
    expect(targets.some((t) => t.kind === "clip-start" && t.timeMs === 2000)).toBe(false);
    expect(targets.some((t) => t.kind === "clip-end" && t.timeMs === 3000)).toBe(false);
    expect(snapTime(2000 + 20, targets).snapped).toBe(false);
  });

  it("ruler/lane seek snaps to clip edges, not to the current playhead (P86)", () => {
    const p: Project = {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 0, durationMs: 2000 })],
        [asset({ id: "a", kind: "video", durationMs: 4000 })],
      ),
      snap: true,
      playheadMs: 5000,
    };
    expect(snapPlayheadSeek(p, 2070)).toBe(2000);
    expect(snapPlayheadSeek(p, 5050)).toBe(5050);
    expect(snapPlayheadSeek({ ...p, snap: false }, 2070)).toBe(2070);
  });

  it("undo/redo restores clip position", () => {
    const start = base();
    let history = createHistory();
    history = pushHistory(history, start);
    const moved = moveClip(start, "c1", 4000).project;
    const undone = undo(history, moved);
    expect(undone?.project.clips[0]!.startMs).toBe(1000);
    const redone = redo(undone!.history, undone!.project);
    expect(redone?.project.clips[0]!.startMs).toBe(4000);
  });

  it("rejects IN after OUT", () => {
    const p = { ...createEmptyProject(), outPointMs: 1000 };
    expect(setInPoint(p, 1500).error).toMatch(/IN cannot/);
    expect(setOutPoint({ ...createEmptyProject(), inPointMs: 2000 }, 500).error).toMatch(/OUT cannot/);
  });
});

describe("timeline trim", () => {
  it("trims in by 500ms on a 2000ms clip", () => {
    const result = trimClip(base(), "c1", "in", 1500);
    expect(result.error).toBeUndefined();
    const c = result.project.clips[0]!;
    expect(c.startMs).toBe(1500);
    expect(c.durationMs).toBe(1500);
    expect(c.sourceInMs).toBe(500);
    expect(c.sourceOutMs).toBe(2000);
  });

  it("trims out by 500ms and shrinks sourceOut", () => {
    const result = trimClip(base(), "c1", "out", 2500);
    expect(result.error).toBeUndefined();
    const c = result.project.clips[0]!;
    expect(c.startMs).toBe(1000);
    expect(c.durationMs).toBe(1500);
    expect(c.sourceInMs).toBe(0);
    expect(c.sourceOutMs).toBe(1500);
  });

  it("rejects trim that would leave less than 50ms", () => {
    const tooShortIn = trimClip(base(), "c1", "in", 2960);
    expect(tooShortIn.error).toMatch(/50ms/);
    expect(tooShortIn.project.clips[0]!.durationMs).toBe(2000);
    const tooShortOut = trimClip(base(), "c1", "out", 1040);
    expect(tooShortOut.error).toMatch(/50ms/);
    expect(tooShortOut.project.clips[0]!.durationMs).toBe(2000);
  });

  it("rejects sourceIn below 0", () => {
    const result = trimClip(base(), "c1", "in", 500);
    expect(result.error).toMatch(/sourceIn/);
    expect(result.project.clips[0]!.sourceInMs).toBe(0);
    expect(result.project.clips[0]!.startMs).toBe(1000);
  });

  it("rejects sourceOut past asset duration", () => {
    const p = projectWith(
      [clip({ id: "c1", assetId: "a", trackId: "V1", startMs: 1000, durationMs: 2000, sourceInMs: 0, sourceOutMs: 2000 })],
      [asset({ id: "a", kind: "video", durationMs: 2000 })],
    );
    const result = trimClip(p, "c1", "out", 3500);
    expect(result.error).toMatch(/asset duration/);
    expect(result.project.clips[0]!.sourceOutMs).toBe(2000);
    expect(result.project.clips[0]!.durationMs).toBe(2000);
  });

  it("clears IN/OUT points", () => {
    const p = { ...base(), inPointMs: 200, outPointMs: 800 };
    const cleared = clearInOut(p);
    expect(cleared.inPointMs).toBeNull();
    expect(cleared.outPointMs).toBeNull();
  });
});

describe("timeline mute", () => {
  it("toggles track muted flag", () => {
    const p = base();
    expect(p.tracks.find((t) => t.id === "V1")!.muted).toBe(false);
    const muted = toggleTrackMute(p, "V1");
    expect(muted.tracks.find((t) => t.id === "V1")!.muted).toBe(true);
    const unmuted = toggleTrackMute(muted, "V1");
    expect(unmuted.tracks.find((t) => t.id === "V1")!.muted).toBe(false);
  });
});

describe("ripple delete", () => {
  it("removes the clip and shifts later clips on the same track only", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 2000 });
    const p = projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 1000, durationMs: 500 }),
        clip({ id: "c3", assetId: "a", trackId: "A2", startMs: 1000, durationMs: 400 }),
      ],
      [a],
    );
    const next = rippleDeleteClip(p, "c1");
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
  });

  it("refuses to pack a later locked clip (P128)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 2000 });
    const p = projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({
          id: "wall",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 500,
          locked: true,
        }),
      ],
      [a],
    );
    const blocked = rippleDeleteClip(p, "c1");
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.project).toBe(p);
    expect(blocked.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
    expect(blocked.project.clips.find((c) => c.id === "wall")!.startMs).toBe(1000);
  });

  it("still ripple-deletes when a locked clip is earlier on the track", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 3000 });
    const p = projectWith(
      [
        clip({
          id: "parked",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: 500,
          locked: true,
        }),
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 800, durationMs: 400 }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 1200, durationMs: 400 }),
      ],
      [a],
    );
    const next = rippleDeleteClip(p, "c1");
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "parked")!.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
  });

  it("does not slide a later disabled clip (P135)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({
          id: "off",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 500,
          enabled: false,
        }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 2000, durationMs: 500 }),
        clip({ id: "c3", assetId: "a", trackId: "A2", startMs: 2000, durationMs: 400 }),
      ],
      [a],
    );
    const next = rippleDeleteClip(p, "c1");
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "off")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "c3")!.startMs).toBe(2000);
  });

  it("does not ripple-delete a disabled clip or pack later enabled (P149)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "off",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          enabled: false,
        }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 2000, durationMs: 500 }),
        clip({ id: "c3", assetId: "a", trackId: "A2", startMs: 2000, durationMs: 400 }),
      ],
      [a],
    );
    const next = rippleDeleteClip(p, "off");
    expect(next.error).toMatch(/disabled/i);
    expect(next.project).toBe(p);
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "off")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "c3")!.startMs).toBe(2000);
  });

  it("group ripple-delete skips a disabled member; later enabled still pack (P149)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({
          id: "off",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 500,
          enabled: false,
        }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 2000, durationMs: 500 }),
      ],
      [a],
    );
    const next = rippleDeleteClips(p, ["c1", "off"]);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "off")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });

  it("later disabled locked is not a ripple-delete wall (P135)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({
          id: "off",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 500,
          enabled: false,
          locked: true,
        }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 2000, durationMs: 500 }),
      ],
      [a],
    );
    const next = rippleDeleteClip(p, "c1");
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });
});

function abuttingA1(): ReturnType<typeof projectWith> {
  const a = asset({ id: "a", kind: "audio", durationMs: 2000 });
  return {
    ...projectWith(
      [
        clip({
          id: "c1",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "c2",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "c3",
          assetId: "a",
          trackId: "A2",
          startMs: 1000,
          durationMs: 800,
        }),
      ],
      [a],
    ),
    snap: false,
  };
}

describe("ripple trim", () => {
  it("ripple-trims first out to 800 and pulls the later A1 clip; lift-trim does not", () => {
    const p = abuttingA1();
    const lifted = trimClip(p, "c1", "out", 800);
    expect(lifted.error).toBeUndefined();
    expect(lifted.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(800);
    expect(lifted.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);

    const rippled = rippleTrimClip(p, "c1", "out", 800);
    expect(rippled.error).toBeUndefined();
    expect(rippled.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(800);
    expect(rippled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
    expect(rippled.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
  });

  it("keeps the 50ms edge guard", () => {
    const p = abuttingA1();
    const rejected = rippleTrimClip(p, "c1", "out", 40);
    expect(rejected.error).toMatch(/50ms/);
    expect(rejected.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });

  it("ripple-trims first in-edge and packs the track; lift-trim leaves a hole", () => {
    const p = abuttingA1();
    const lifted = trimClip(p, "c1", "in", 200);
    expect(lifted.error).toBeUndefined();
    expect(lifted.project.clips.find((c) => c.id === "c1")!.startMs).toBe(200);
    expect(lifted.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(800);
    expect(lifted.project.clips.find((c) => c.id === "c1")!.sourceInMs).toBe(200);
    expect(lifted.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);

    const rippled = rippleTrimClip(p, "c1", "in", 200);
    expect(rippled.error).toBeUndefined();
    const a = rippled.project.clips.find((c) => c.id === "c1")!;
    expect(a.startMs).toBe(0);
    expect(a.durationMs).toBe(800);
    expect(a.sourceInMs).toBe(200);
    expect(a.sourceOutMs).toBe(1000);
    expect(rippled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
    expect(rippled.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
  });

  it("does not pack a later disabled clip (P134)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "off",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 500,
          enabled: false,
        }),
        clip({
          id: "c2",
          assetId: "a",
          trackId: "A1",
          startMs: 2000,
          durationMs: 500,
        }),
      ],
      [a],
    );
    const next = rippleTrimClip({ ...p, snap: false }, "c1", "out", 800);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(800);
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1800);
  });

  it("does not ripple-trim a disabled clip or pack later enabled (P148)", () => {
    const p = {
      ...abuttingA1(),
      clips: abuttingA1().clips.map((c) => (c.id === "c1" ? { ...c, enabled: false } : c)),
    };
    const next = rippleTrimClip(p, "c1", "out", 800);
    expect(next.error).toMatch(/disabled/i);
    expect(next.project).toBe(p);
    expect(next.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });
});

describe("group move / delete", () => {
  it("moves many clips by the same delta and clamps so none start below 0", () => {
    const p = abuttingA1();
    const moved = moveClipsByDelta(p, ["c1", "c3"], 200);
    expect(moved.error).toBeUndefined();
    expect(moved.project.clips.find((c) => c.id === "c1")!.startMs).toBe(200);
    expect(moved.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(moved.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1200);

    const offset = moveClipsByDelta(p, ["c1", "c2"], 200);
    expect(offset.project.clips.find((c) => c.id === "c1")!.startMs).toBe(200);
    const clamped = moveClipsByDelta(offset.project, ["c1", "c2"], -500);
    expect(clamped.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
    expect(clamped.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });

  it("group move skips a disabled member; single disabled still moves (P146)", () => {
    const p = {
      ...abuttingA1(),
      clips: abuttingA1().clips.map((c) => (c.id === "c2" ? { ...c, enabled: false } : c)),
    };
    const group = moveClipsByDelta(p, ["c1", "c2"], 200);
    expect(group.error).toBeUndefined();
    expect(group.project.clips.find((c) => c.id === "c1")!.startMs).toBe(200);
    expect(group.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(group.project.clips.find((c) => c.id === "c2")!.enabled).toBe(false);

    const one = moveClipsByDelta(p, ["c2"], 200);
    expect(one.error).toBeUndefined();
    expect(one.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1200);
    expect(one.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
  });

  it("lift-deletes many clips and leaves later neighbors in place", () => {
    const p = abuttingA1();
    const next = deleteClips(p, ["c1", "c3"]);
    expect(next.clips.map((c) => c.id)).toEqual(["c2"]);
    expect(next.clips[0]!.startMs).toBe(1000);
  });

  it("pastes a group at atMs with relative starts and same-kind tracks", () => {
    const p = abuttingA1();
    const group = [
      p.clips.find((c) => c.id === "c1")!,
      p.clips.find((c) => c.id === "c3")!,
    ];
    const next = pasteClips(p, group, 2000);
    expect(next.error).toBeUndefined();
    expect(next.clipIds).toHaveLength(2);
    const a1 = next.project.clips.find((c) => c.id === next.clipIds[0])!;
    const a2 = next.project.clips.find((c) => c.id === next.clipIds[1])!;
    expect(a1.startMs).toBe(2000);
    expect(a1.trackId).toBe("A1");
    expect(a2.startMs).toBe(3000);
    expect(a2.trackId).toBe("A2");
    expect(next.project.clips.find((c) => c.id === "c1")!.startMs).toBe(0);
  });

  it("ripple-deletes later clips first per track", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 1000, durationMs: 500 }),
        clip({ id: "c4", assetId: "a", trackId: "A1", startMs: 2000, durationMs: 400 }),
        clip({ id: "c3", assetId: "a", trackId: "A2", startMs: 1000, durationMs: 400 }),
      ],
      [a],
    );
    const next = rippleDeleteClips(p, ["c1", "c2"]);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c2")).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c4")!.startMs).toBe(500);
    expect(next.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
  });
});

function threeAbuttingA1(): ReturnType<typeof projectWith> {
  const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
  return {
    ...projectWith(
      [
        clip({
          id: "L",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "M",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 200,
          sourceOutMs: 1200,
        }),
        clip({
          id: "R",
          assetId: "a",
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
  };
}

function spanOf(clips: { startMs: number; durationMs: number }[]): number {
  const start = Math.min(...clips.map((c) => c.startMs));
  const end = Math.max(...clips.map((c) => c.startMs + c.durationMs));
  return end - start;
}

describe("slide", () => {
  it("slides +N and -N; span is invariant; middle source stays; neighbors shift", () => {
    const p = threeAbuttingA1();
    const before = p.clips.filter((c) => c.trackId === "A1");
    const span0 = spanOf(before);

    const right = slideClip(p, "M", 200);
    expect(right.error).toBeUndefined();
    const Lr = right.project.clips.find((c) => c.id === "L")!;
    const Mr = right.project.clips.find((c) => c.id === "M")!;
    const Rr = right.project.clips.find((c) => c.id === "R")!;
    expect(Mr.startMs).toBe(1200);
    expect(Mr.durationMs).toBe(1000);
    expect(Mr.sourceInMs).toBe(200);
    expect(Mr.sourceOutMs).toBe(1200);
    expect(Lr.startMs).toBe(0);
    expect(Lr.durationMs).toBe(1200);
    expect(Lr.sourceOutMs).toBe(1200);
    expect(Rr.startMs).toBe(2200);
    expect(Rr.durationMs).toBe(800);
    expect(Rr.sourceInMs).toBe(600);
    expect(Rr.sourceOutMs).toBe(1400);
    expect(spanOf([Lr, Mr, Rr])).toBe(span0);

    const left = slideClip(p, "M", -200);
    expect(left.error).toBeUndefined();
    const Ll = left.project.clips.find((c) => c.id === "L")!;
    const Ml = left.project.clips.find((c) => c.id === "M")!;
    const Rl = left.project.clips.find((c) => c.id === "R")!;
    expect(Ml.startMs).toBe(800);
    expect(Ml.sourceInMs).toBe(200);
    expect(Ml.sourceOutMs).toBe(1200);
    expect(Ll.durationMs).toBe(800);
    expect(Ll.sourceOutMs).toBe(800);
    expect(Rl.startMs).toBe(1800);
    expect(Rl.durationMs).toBe(1200);
    expect(Rl.sourceInMs).toBe(200);
    expect(spanOf([Ll, Ml, Rl])).toBe(span0);
  });

  it("hard-stops at min neighbor duration and does not change the project past the clamp", () => {
    const p = threeAbuttingA1();
    const huge = slideClip(p, "M", 10_000);
    const L = huge.project.clips.find((c) => c.id === "L")!;
    const M = huge.project.clips.find((c) => c.id === "M")!;
    const R = huge.project.clips.find((c) => c.id === "R")!;
    expect(R.durationMs).toBe(SPLIT_EDGE_GUARD_MS);
    expect(L.durationMs + M.durationMs + R.durationMs).toBe(3000);
    expect(M.sourceInMs).toBe(200);
    expect(M.sourceOutMs).toBe(1200);

    const already = slideClip(huge.project, "M", 100);
    expect(already.project).toBe(huge.project);
    expect(already.error).toMatch(/slide/i);
  });

  it("no-neighbor and a gap are no-ops", () => {
    const lone = projectWith(
      [clip({ id: "M", assetId: "a", trackId: "A1", startMs: 1000, durationMs: 1000 })],
      [asset({ id: "a", kind: "audio", durationMs: 4000 })],
    );
    const none = slideClip(lone, "M", 100);
    expect(none.project).toBe(lone);
    expect(none.error).toMatch(/abutting/i);

    const gapped = {
      ...projectWith(
        [
          clip({ id: "L", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
          clip({ id: "M", assetId: "a", trackId: "A1", startMs: 1100, durationMs: 1000 }),
          clip({ id: "R", assetId: "a", trackId: "A1", startMs: 2100, durationMs: 1000 }),
        ],
        [asset({ id: "a", kind: "audio", durationMs: 4000 })],
      ),
      snap: false,
    };
    const gap = slideClip(gapped, "M", 50);
    expect(gap.project).toBe(gapped);
    expect(gap.error).toMatch(/abutting/i);
  });

  it("does not slide a disabled clip or trim living neighbors (P150)", () => {
    const p = threeAbuttingA1();
    const dimmed = {
      ...p,
      clips: p.clips.map((c) => (c.id === "M" ? { ...c, enabled: false } : c)),
    };
    const next = slideClip(dimmed, "M", 200);
    expect(next.error).toMatch(/disabled/i);
    expect(next.project).toBe(dimmed);
    expect(next.project.clips.find((c) => c.id === "L")!.durationMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "M")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "M")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "R")!.startMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "R")!.durationMs).toBe(1000);
  });

  it("does not treat a disabled abutting take as a slide neighbor (P138)", () => {
    const p = threeAbuttingA1();
    const dimmed = {
      ...p,
      clips: p.clips.map((c) => (c.id === "R" ? { ...c, enabled: false } : c)),
    };
    expect(abuttingNeighbor(dimmed, "M", "out")).toBeUndefined();
    expect(abuttingNeighbor(dimmed, "M", "in")?.id).toBe("L");
    const againstDim = slideClip(dimmed, "M", 200);
    expect(againstDim.project).toBe(dimmed);
    expect(againstDim.error).toMatch(/abutting/i);
    expect(againstDim.project.clips.find((c) => c.id === "R")!.startMs).toBe(2000);
    expect(againstDim.project.clips.find((c) => c.id === "R")!.durationMs).toBe(1000);
    expect(againstDim.project.clips.find((c) => c.id === "M")!.startMs).toBe(1000);

    const lockedDim = {
      ...p,
      clips: p.clips.map((c) =>
        c.id === "R" ? { ...c, enabled: false, locked: true } : c,
      ),
    };
    expect(abuttingNeighbor(lockedDim, "M", "out")).toBeUndefined();
    const againstLockedDim = slideClip(lockedDim, "M", 200);
    expect(againstLockedDim.project).toBe(lockedDim);
    expect(againstLockedDim.error).toMatch(/abutting/i);
    expect(againstLockedDim.project.clips.find((c) => c.id === "R")!.startMs).toBe(2000);
  });
});

function fiveAbuttingA1(): ReturnType<typeof projectWith> {
  const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
  return {
    ...projectWith(
      [
        clip({
          id: "L",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "A",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 100,
          sourceOutMs: 1100,
        }),
        clip({
          id: "B",
          assetId: "a",
          trackId: "A1",
          startMs: 2000,
          durationMs: 1000,
          sourceInMs: 200,
          sourceOutMs: 1200,
        }),
        clip({
          id: "C",
          assetId: "a",
          trackId: "A1",
          startMs: 3000,
          durationMs: 1000,
          sourceInMs: 300,
          sourceOutMs: 1300,
        }),
        clip({
          id: "R",
          assetId: "a",
          trackId: "A1",
          startMs: 4000,
          durationMs: 1000,
          sourceInMs: 400,
          sourceOutMs: 1400,
        }),
      ],
      [a],
    ),
    snap: false,
  };
}

describe("group slide", () => {
  it("slides a two-clip block; relative starts and inner source stay; span is invariant", () => {
    const p = fiveAbuttingA1();
    const span0 = spanOf(p.clips.filter((c) => ["L", "A", "B", "C"].includes(c.id)));
    const block0 = spanOf(p.clips.filter((c) => c.id === "A" || c.id === "B"));
    const next = slideClips(p, ["B", "A"], 200);
    expect(next.error).toBeUndefined();
    const L = next.project.clips.find((c) => c.id === "L")!;
    const A = next.project.clips.find((c) => c.id === "A")!;
    const B = next.project.clips.find((c) => c.id === "B")!;
    const C = next.project.clips.find((c) => c.id === "C")!;
    const R = next.project.clips.find((c) => c.id === "R")!;
    expect(A.startMs).toBe(1200);
    expect(B.startMs).toBe(2200);
    expect(B.startMs - A.startMs).toBe(1000);
    expect(A.durationMs).toBe(1000);
    expect(B.durationMs).toBe(1000);
    expect(A.sourceInMs).toBe(100);
    expect(A.sourceOutMs).toBe(1100);
    expect(B.sourceInMs).toBe(200);
    expect(B.sourceOutMs).toBe(1200);
    expect(L.durationMs).toBe(1200);
    expect(L.sourceOutMs).toBe(1200);
    expect(C.startMs).toBe(3200);
    expect(C.durationMs).toBe(800);
    expect(C.sourceInMs).toBe(500);
    expect(R.startMs).toBe(4000);
    expect(R.durationMs).toBe(1000);
    expect(spanOf([L, A, B, C])).toBe(span0);
    expect(spanOf([A, B])).toBe(block0);
  });

  it("slides a three-clip block as one middle", () => {
    const p = fiveAbuttingA1();
    const span0 = spanOf(p.clips);
    const next = slideClips(p, ["A", "B", "C"], -200);
    expect(next.error).toBeUndefined();
    const L = next.project.clips.find((c) => c.id === "L")!;
    const A = next.project.clips.find((c) => c.id === "A")!;
    const B = next.project.clips.find((c) => c.id === "B")!;
    const C = next.project.clips.find((c) => c.id === "C")!;
    const R = next.project.clips.find((c) => c.id === "R")!;
    expect(A.startMs).toBe(800);
    expect(B.startMs).toBe(1800);
    expect(C.startMs).toBe(2800);
    expect(A.sourceInMs).toBe(100);
    expect(B.sourceInMs).toBe(200);
    expect(C.sourceInMs).toBe(300);
    expect(L.durationMs).toBe(800);
    expect(L.sourceOutMs).toBe(800);
    expect(R.startMs).toBe(3800);
    expect(R.durationMs).toBe(1200);
    expect(R.sourceInMs).toBe(200);
    expect(spanOf([L, A, B, C, R])).toBe(span0);
  });

  it("no-ops when the selection has an internal gap", () => {
    const p = fiveAbuttingA1();
    const next = slideClips(p, ["A", "C"], 200);
    expect(next.project).toBe(p);
    expect(next.error).toMatch(/contiguous|gap/i);
  });

  it("no-ops when an outer neighbor is missing", () => {
    const p = fiveAbuttingA1();
    const next = slideClips(p, ["L", "A"], 200);
    expect(next.project).toBe(p);
    expect(next.error).toMatch(/abutting/i);
  });

  it("no-ops when the selection spans tracks", () => {
    const p = {
      ...fiveAbuttingA1(),
      clips: [
        ...fiveAbuttingA1().clips,
        clip({
          id: "X",
          assetId: "a",
          trackId: "A2",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
      ],
    };
    const next = slideClips(p, ["A", "X"], 200);
    expect(next.project).toBe(p);
    expect(next.error).toMatch(/track/i);
  });

  it("group slide skips a disabled member (P145)", () => {
    const p = fiveAbuttingA1();
    const dimmed = {
      ...p,
      clips: p.clips.map((c) => (c.id === "B" ? { ...c, enabled: false } : c)),
    };
    const next = slideClips(dimmed, ["A", "B"], 200);
    expect(next.project.clips.find((c) => c.id === "B")!.startMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "B")!.durationMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "B")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "A")!.startMs).toBe(1000);
  });

  it("single selection still matches slideClip", () => {
    const p = threeAbuttingA1();
    const one = slideClip(p, "M", 200);
    const via = slideClips(p, ["M"], 200);
    expect(via.error).toBeUndefined();
    expect(via.project.clips.map((c) => [c.id, c.startMs, c.durationMs, c.sourceInMs, c.sourceOutMs])).toEqual(
      one.project.clips.map((c) => [c.id, c.startMs, c.durationMs, c.sourceInMs, c.sourceOutMs]),
    );
  });
});

describe("slip", () => {
  it("slides source window and leaves start/duration; clamps at asset end", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 3000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
        }),
      ],
      [a],
    );
    const slipped = slipClip(p, "c1", 200);
    expect(slipped.error).toBeUndefined();
    expect(slipped.project.clips[0]!.startMs).toBe(1000);
    expect(slipped.project.clips[0]!.durationMs).toBe(2000);
    expect(slipped.project.clips[0]!.sourceInMs).toBe(200);
    expect(slipped.project.clips[0]!.sourceOutMs).toBe(2200);

    const clamped = slipClip(p, "c1", 2000);
    expect(clamped.project.clips[0]!.sourceInMs).toBe(1000);
    expect(clamped.project.clips[0]!.sourceOutMs).toBe(3000);
    expect(clamped.project.clips[0]!.durationMs).toBe(2000);
    expect(clamped.project.clips[0]!.startMs).toBe(1000);
  });
});

describe("group slip", () => {
  it("slips a contiguous same-track pair; starts and neighbors stay", () => {
    const p = fiveAbuttingA1();
    const next = slipClips(p, ["B", "A"], 200);
    expect(next.error).toBeUndefined();
    const L = next.project.clips.find((c) => c.id === "L")!;
    const A = next.project.clips.find((c) => c.id === "A")!;
    const B = next.project.clips.find((c) => c.id === "B")!;
    const C = next.project.clips.find((c) => c.id === "C")!;
    expect(A.startMs).toBe(1000);
    expect(B.startMs).toBe(2000);
    expect(A.durationMs).toBe(1000);
    expect(B.durationMs).toBe(1000);
    expect(A.sourceInMs).toBe(300);
    expect(A.sourceOutMs).toBe(1300);
    expect(B.sourceInMs).toBe(400);
    expect(B.sourceOutMs).toBe(1400);
    expect(L.startMs).toBe(0);
    expect(L.durationMs).toBe(1000);
    expect(L.sourceInMs).toBe(0);
    expect(L.sourceOutMs).toBe(1000);
    expect(C.startMs).toBe(3000);
    expect(C.sourceInMs).toBe(300);
  });

  it("no-ops a gapped selection and a mixed-track selection", () => {
    const p = fiveAbuttingA1();
    const gapped = slipClips(p, ["A", "C"], 200);
    expect(gapped.project).toBe(p);
    expect(gapped.error).toMatch(/contiguous|gap/i);

    const mixed = {
      ...p,
      clips: [
        ...p.clips,
        clip({
          id: "X",
          assetId: "a",
          trackId: "A2",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
      ],
    };
    const across = slipClips(mixed, ["A", "X"], 200);
    expect(across.project).toBe(mixed);
    expect(across.error).toMatch(/track/i);
  });

  it("source bound on one member no-ops the whole block", () => {
    const p = fiveAbuttingA1();
    p.clips = p.clips.map((c) =>
      c.id === "A" ? { ...c, sourceInMs: 6900, sourceOutMs: 7900 } : c,
    );
    const blocked = slipClips(p, ["A", "B"], 200);
    expect(blocked.project).toBe(p);
    expect(blocked.error).toMatch(/slip/i);
    expect(blocked.project.clips.find((c) => c.id === "A")!.sourceInMs).toBe(6900);
    expect(blocked.project.clips.find((c) => c.id === "B")!.sourceInMs).toBe(200);
  });

  it("single selection still matches slipClip including clamp", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 3000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
        }),
      ],
      [a],
    );
    const one = slipClip(p, "c1", 200);
    const via = slipClips(p, ["c1"], 200);
    expect(via.project.clips[0]!.sourceInMs).toBe(one.project.clips[0]!.sourceInMs);
    expect(via.project.clips[0]!.startMs).toBe(1000);
    const clamped = slipClips(p, ["c1"], 2000);
    expect(clamped.project.clips[0]!.sourceInMs).toBe(1000);
    expect(clamped.project.clips[0]!.sourceOutMs).toBe(3000);
  });

  it("group slip skips a disabled member (P145)", () => {
    const p = fiveAbuttingA1();
    const dimmed = {
      ...p,
      clips: p.clips.map((c) => (c.id === "B" ? { ...c, enabled: false } : c)),
    };
    const next = slipClips(dimmed, ["A", "B"], 200);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "A")!.sourceInMs).toBe(300);
    expect(next.project.clips.find((c) => c.id === "B")!.sourceInMs).toBe(200);
    expect(next.project.clips.find((c) => c.id === "B")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "B")!.startMs).toBe(2000);
  });
});

function rangeA1(): ReturnType<typeof projectWith> {
  const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
  const v = asset({ id: "v", kind: "video", durationMs: 4000 });
  return {
    ...projectWith(
      [
        clip({
          id: "c1",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: 3000,
          sourceInMs: 0,
          sourceOutMs: 3000,
        }),
        clip({
          id: "v1",
          assetId: "v",
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
  };
}

describe("range lift / extract", () => {
  it("liftRange splits at IN/OUT and leaves a gap; extract closes it", () => {
    const p = rangeA1();
    const lifted = liftRange(p).project;
    const a1 = lifted.clips.filter((c) => c.trackId === "A1").sort((x, y) => x.startMs - y.startMs);
    expect(a1).toHaveLength(2);
    expect(a1[0]!.startMs).toBe(0);
    expect(a1[0]!.durationMs).toBe(1000);
    expect(a1[0]!.sourceInMs).toBe(0);
    expect(a1[0]!.sourceOutMs).toBe(1000);
    expect(a1[1]!.startMs).toBe(2000);
    expect(a1[1]!.durationMs).toBe(1000);
    expect(a1[1]!.sourceInMs).toBe(2000);
    expect(a1[1]!.sourceOutMs).toBe(3000);
    expect(lifted.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(lifted.clips.find((c) => c.id === "v1")!.durationMs).toBe(800);

    const extracted = extractRange(p).project;
    const a1e = extracted.clips.filter((c) => c.trackId === "A1").sort((x, y) => x.startMs - y.startMs);
    expect(a1e).toHaveLength(2);
    expect(a1e[1]!.startMs).toBe(1000);
    expect(extracted.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
  });

  it("missing or inverted IN/OUT is a no-op", () => {
    const p = rangeA1();
    expect(liftRange({ ...p, outPointMs: null }).project.clips).toHaveLength(2);
    expect(extractRange({ ...p, inPointMs: null }).project.clips).toHaveLength(2);
    expect(liftRange({ ...p, inPointMs: 2000, outPointMs: 1000 }).project.clips).toHaveLength(2);
  });

  it("extractRange does not slide a later disabled clip (P137)", () => {
    const base = rangeA1();
    const p = {
      ...base,
      clips: [
        ...base.clips,
        clip({
          id: "off",
          assetId: "a",
          trackId: "A1",
          startMs: 3500,
          durationMs: 400,
          enabled: false,
        }),
        clip({
          id: "later",
          assetId: "a",
          trackId: "A1",
          startMs: 4000,
          durationMs: 400,
        }),
      ],
    };
    const next = extractRange(p);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(3500);
    expect(next.project.clips.find((c) => c.id === "off")!.enabled).toBe(false);
    expect(next.project.clips.find((c) => c.id === "later")!.startMs).toBe(3000);
    const a1 = next.project.clips
      .filter((c) => c.trackId === "A1" && c.enabled !== false && c.id !== "off")
      .sort((x, y) => x.startMs - y.startMs);
    expect(a1.find((c) => c.id === "later")!.startMs).toBe(3000);
  });

  it("liftRange does not delete a disabled unlocked mid inside IN/OUT (P139)", () => {
    const base = rangeA1();
    const p = {
      ...base,
      clips: [
        ...base.clips,
        clip({
          id: "off",
          assetId: "a",
          trackId: "A2",
          startMs: 1200,
          durationMs: 600,
          enabled: false,
        }),
      ],
    };
    const lifted = liftRange(p).project;
    expect(lifted.clips.find((c) => c.id === "off")).toBeTruthy();
    expect(lifted.clips.find((c) => c.id === "off")!.startMs).toBe(1200);
    expect(lifted.clips.find((c) => c.id === "off")!.enabled).toBe(false);
    const a1 = lifted.clips.filter((c) => c.trackId === "A1").sort((x, y) => x.startMs - y.startMs);
    expect(a1).toHaveLength(2);
    expect(a1[0]!.durationMs).toBe(1000);
    expect(a1[1]!.startMs).toBe(2000);

    const extracted = extractRange(p);
    expect(extracted.error).toBeUndefined();
    expect(extracted.project.clips.find((c) => c.id === "off")).toBeTruthy();
    expect(extracted.project.clips.find((c) => c.id === "off")!.startMs).toBe(1200);
    const a1e = extracted.project.clips
      .filter((c) => c.trackId === "A1")
      .sort((x, y) => x.startMs - y.startMs);
    expect(a1e[1]!.startMs).toBe(1000);
  });

  it("liftRange does not delete a disabled unlocked mate of an enabled mid (P139)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
    const v = asset({ id: "v", kind: "video", durationMs: 4000 });
    const p = {
      ...projectWith(
        [
          clip({
            id: "v-mid",
            assetId: "v",
            trackId: "V1",
            startMs: 1000,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
            linkId: "pair",
          }),
          clip({
            id: "a-off",
            assetId: "a",
            trackId: "A1",
            startMs: 1000,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
            linkId: "pair",
            enabled: false,
          }),
        ],
        [a, v],
      ),
      inPointMs: 1000,
      outPointMs: 2000,
      snap: false,
    };
    const lifted = liftRange(p).project;
    expect(lifted.clips.find((c) => c.id === "v-mid")).toBeUndefined();
    const parked = lifted.clips.find((c) => c.id === "a-off");
    expect(parked).toBeTruthy();
    expect(parked!.startMs).toBe(1000);
    expect(parked!.enabled).toBe(false);
    expect(parked!.linkId).toBeUndefined();
  });

  it("later disabled locked is not an extract wall (P137)", () => {
    const base = rangeA1();
    const p = {
      ...base,
      clips: [
        ...base.clips,
        clip({
          id: "off",
          assetId: "a",
          trackId: "A1",
          startMs: 4000,
          durationMs: 400,
          enabled: false,
          locked: true,
        }),
        clip({
          id: "later",
          assetId: "a",
          trackId: "A1",
          startMs: 4500,
          durationMs: 400,
        }),
      ],
    };
    const next = extractRange(p);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(4000);
    expect(next.project.clips.find((c) => c.id === "later")!.startMs).toBe(3500);
  });

  it("liftRange does not delete a locked clip inside IN/OUT, nor its locked mate (P110)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
    const v = asset({ id: "v", kind: "video", durationMs: 4000 });
    const inside = {
      ...projectWith(
        [
          clip({
            id: "c1",
            assetId: "a",
            trackId: "A1",
            startMs: 0,
            durationMs: 3000,
            sourceInMs: 0,
            sourceOutMs: 3000,
          }),
          clip({
            id: "parked",
            assetId: "a",
            trackId: "A2",
            startMs: 1200,
            durationMs: 600,
            sourceInMs: 0,
            sourceOutMs: 600,
            locked: true,
          }),
        ],
        [a],
      ),
      inPointMs: 1000,
      outPointMs: 2000,
      snap: false,
    };
    const liftedInside = liftRange(inside).project;
    expect(liftedInside.clips.find((c) => c.id === "parked")).toBeTruthy();
    expect(liftedInside.clips.find((c) => c.id === "parked")!.startMs).toBe(1200);
    const a1 = liftedInside.clips.filter((c) => c.trackId === "A1").sort((x, y) => x.startMs - y.startMs);
    expect(a1).toHaveLength(2);
    expect(a1[0]!.durationMs).toBe(1000);
    expect(a1[1]!.startMs).toBe(2000);

    const linked = {
      ...projectWith(
        [
          clip({
            id: "v1",
            assetId: "v",
            trackId: "V1",
            startMs: 0,
            durationMs: 800,
            sourceInMs: 0,
            sourceOutMs: 800,
            locked: true,
            linkId: "pair",
          }),
          clip({
            id: "a-mid",
            assetId: "a",
            trackId: "A1",
            startMs: 5000,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
            linkId: "pair",
          }),
        ],
        [a, v],
      ),
      inPointMs: 5000,
      outPointMs: 6000,
      snap: false,
    };
    const liftedMate = liftRange(linked).project;
    expect(liftedMate.clips.find((c) => c.id === "v1")).toBeTruthy();
    expect(liftedMate.clips.find((c) => c.id === "a-mid")).toBeUndefined();
  });

  it("extractRange does not slide a locked clip that starts at/after OUT (P109)", () => {
    const base = rangeA1();
    const p = {
      ...base,
      clips: [
        ...base.clips,
        clip({
          id: "parked",
          assetId: "a",
          trackId: "A1",
          startMs: 4000,
          durationMs: 500,
          sourceInMs: 0,
          sourceOutMs: 500,
          locked: true,
        }),
      ],
    };
    const blocked = extractRange(p);
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.project).toBe(p);
    expect(blocked.project.clips.find((c) => c.id === "parked")!.startMs).toBe(4000);
    expect(blocked.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(3000);

    const free = {
      ...p,
      clips: p.clips.map((c) => (c.id === "parked" ? { ...c, locked: undefined } : c)),
    };
    const extracted = extractRange(free);
    expect(extracted.error).toBeUndefined();
    expect(extracted.project.clips.find((c) => c.id === "parked")!.startMs).toBe(3000);
  });

  it("extractRange does not slide later clips into a locked clip that straddles IN/OUT (P111)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
    const p = {
      ...projectWith(
        [
          clip({
            id: "locked",
            assetId: "a",
            trackId: "A1",
            startMs: 500,
            durationMs: 2500,
            sourceInMs: 0,
            sourceOutMs: 2500,
            locked: true,
          }),
          clip({
            id: "later",
            assetId: "a",
            trackId: "A1",
            startMs: 4000,
            durationMs: 500,
            sourceInMs: 0,
            sourceOutMs: 500,
          }),
        ],
        [a],
      ),
      inPointMs: 1000,
      outPointMs: 2000,
      snap: false,
    };
    const blocked = extractRange(p);
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.project).toBe(p);
    expect(blocked.project.clips.find((c) => c.id === "later")!.startMs).toBe(4000);
    expect(blocked.project.clips.find((c) => c.id === "locked")!.startMs).toBe(500);
    expect(blocked.project.clips.find((c) => c.id === "locked")!.durationMs).toBe(2500);

    const free = {
      ...p,
      clips: p.clips.map((c) => (c.id === "locked" ? { ...c, locked: undefined } : c)),
    };
    const extracted = extractRange(free);
    expect(extracted.error).toBeUndefined();
    expect(extracted.project.clips.find((c) => c.id === "later")!.startMs).toBe(3000);
  });

  it("extractRange does not slide later clips into a locked clip fully inside IN/OUT (P112)", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
    const p = {
      ...projectWith(
        [
          clip({
            id: "c1",
            assetId: "a",
            trackId: "A1",
            startMs: 0,
            durationMs: 3000,
            sourceInMs: 0,
            sourceOutMs: 3000,
          }),
          clip({
            id: "parked",
            assetId: "a",
            trackId: "A2",
            startMs: 1200,
            durationMs: 600,
            sourceInMs: 0,
            sourceOutMs: 600,
            locked: true,
          }),
          clip({
            id: "later",
            assetId: "a",
            trackId: "A2",
            startMs: 3000,
            durationMs: 500,
            sourceInMs: 0,
            sourceOutMs: 500,
          }),
        ],
        [a],
      ),
      inPointMs: 1000,
      outPointMs: 2000,
      snap: false,
    };
    const blocked = extractRange(p);
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.project).toBe(p);
    expect(blocked.project.clips.find((c) => c.id === "later")!.startMs).toBe(3000);
    expect(blocked.project.clips.find((c) => c.id === "parked")!.startMs).toBe(1200);
    expect(blocked.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(3000);

    const free = {
      ...p,
      clips: p.clips.map((c) => (c.id === "parked" ? { ...c, locked: undefined } : c)),
    };
    const extracted = extractRange(free);
    expect(extracted.error).toBeUndefined();
    expect(extracted.project.clips.find((c) => c.id === "later")!.startMs).toBe(2000);
    expect(extracted.project.clips.find((c) => c.id === "parked")).toBeUndefined();
  });
});

describe("roll edit", () => {
  it("rolls the shared cut +200 and keeps the A+B span", () => {
    const p = abuttingA1();
    expect(abuttingNeighbor(p, "c1", "out")?.id).toBe("c2");
    const rolled = rollEdit(p, "c1", "c2", 1200);
    expect(rolled.error).toBeUndefined();
    const a = rolled.project.clips.find((c) => c.id === "c1")!;
    const b = rolled.project.clips.find((c) => c.id === "c2")!;
    expect(a.startMs).toBe(0);
    expect(a.durationMs).toBe(1200);
    expect(a.sourceOutMs).toBe(1200);
    expect(b.startMs).toBe(1200);
    expect(b.durationMs).toBe(800);
    expect(b.sourceInMs).toBe(200);
    expect(a.startMs + a.durationMs + b.durationMs).toBe(2000);
    expect(rolled.project.clips.find((c) => c.id === "c3")!.startMs).toBe(1000);
  });

  it("rejects a roll that would leave less than 50ms", () => {
    const p = abuttingA1();
    const rejected = rollEdit(p, "c1", "c2", 40);
    expect(rejected.error).toMatch(/50ms/);
    expect(rejected.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
    expect(rejected.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });

  it("does not treat a disabled abutting take as a roll neighbor (P138)", () => {
    const p = {
      ...abuttingA1(),
      clips: abuttingA1().clips.map((c) =>
        c.id === "c2" ? { ...c, enabled: false } : c,
      ),
    };
    expect(abuttingNeighbor(p, "c1", "out")).toBeUndefined();
    expect(abuttingNeighbor(p, "c2", "in")?.id).toBe("c1");
    const fromDim = rollEdit(p, "c1", "c2", 1200);
    expect(fromDim.error).toMatch(/abutting/i);
    expect(fromDim.project).toBe(p);
  });
});

describe("track solo", () => {
  it("toggles solo independently of mute", () => {
    const p = base();
    expect(p.tracks.find((t) => t.id === "A1")!.solo).toBe(false);
    const soloed = toggleTrackSolo(p, "A1");
    expect(soloed.tracks.find((t) => t.id === "A1")!.solo).toBe(true);
    expect(soloed.tracks.find((t) => t.id === "A1")!.muted).toBe(false);
    const unsoloed = toggleTrackSolo(soloed, "A1");
    expect(unsoloed.tracks.find((t) => t.id === "A1")!.solo).toBe(false);
  });
});

function rightClickSequence(t1: number, t2: number) {
  const session = createSession(createMemoryBlobStore());
  return applyOutAt(applyInAt(session, t1), t2);
}

describe("loop range", () => {
  it("sets IN then OUT via rightClickSequence; second < first swaps", () => {
    const ordered = rightClickSequence(1000, 3000);
    expect(ordered.project.inPointMs).toBe(1000);
    expect(ordered.project.outPointMs).toBe(3000);
    expect(ordered.project.loop).toBe(true);
    expect(ordered.error).toBeNull();

    const swapped = rightClickSequence(3000, 1000);
    expect(swapped.project.inPointMs).toBe(1000);
    expect(swapped.project.outPointMs).toBe(3000);
    expect(swapped.project.loop).toBe(true);
    expect(swapped.error).toBeNull();
  });

  it("moveInOut +200ms keeps duration", () => {
    const ranged = rightClickSequence(200, 800);
    const moved = moveInOut(ranged.project, 200);
    expect(moved.error).toBeUndefined();
    expect(moved.project.inPointMs).toBe(400);
    expect(moved.project.outPointMs).toBe(1000);
  });

  it("IN cannot go below 0 when dragging", () => {
    const ranged = rightClickSequence(100, 500);
    const moved = moveInOut(ranged.project, -400);
    expect(moved.error).toBeUndefined();
    expect(moved.project.inPointMs).toBe(0);
    expect(moved.project.outPointMs).toBe(400);
  });
});
