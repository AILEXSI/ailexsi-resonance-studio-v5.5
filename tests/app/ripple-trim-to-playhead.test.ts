import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { applyPlayhead, createSession, type Session } from "../../src/app/session";
import { snapPlayheadSeek } from "../../src/core/timeline";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function trimSession(overrides: Partial<Session> = {}): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 8000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: {
      ...projectWith(
        [
          clip({
            id: "c1",
            assetId: "va",
            trackId: "V1",
            startMs: 0,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
          }),
          clip({
            id: "c2",
            assetId: "va",
            trackId: "V1",
            startMs: 1000,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
          }),
        ],
        [va],
      ),
      snap: false,
      playheadMs: 200,
    },
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
    ...overrides,
  };
}

describe("rippleTrimToPlayhead", () => {
  it("is registered on applyCommand", () => {
    const start = trimSession();
    const next = applyCommand(start, { type: "rippleTrimToPlayhead", edge: "in" });
    expect(next).not.toBe(start);
    expect(next.status).toBe("Ripple trimmed");
  });

  it("Q shortens the left and packs later same-track clips", () => {
    const start = trimSession({ project: { ...trimSession().project, playheadMs: 200 } });
    const next = applyCommand(start, { type: "rippleTrimToPlayhead", edge: "in" });
    const c1 = next.project.clips.find((c) => c.id === "c1")!;
    const c2 = next.project.clips.find((c) => c.id === "c2")!;
    expect(c1.startMs).toBe(0);
    expect(c1.durationMs).toBe(800);
    expect(c1.sourceInMs).toBe(200);
    expect(c1.sourceOutMs).toBe(1000);
    expect(c2.startMs).toBe(800);
    expect(next.project.playheadMs).toBe(200);
    expect(next.selectedClipId).toBe("c1");
    expect(next.history.past.length).toBe(start.history.past.length + 1);
  });

  it("W shortens the right and packs later same-track clips", () => {
    const start = trimSession({ project: { ...trimSession().project, playheadMs: 800 } });
    const next = applyCommand(start, { type: "rippleTrimToPlayhead", edge: "out" });
    const c1 = next.project.clips.find((c) => c.id === "c1")!;
    const c2 = next.project.clips.find((c) => c.id === "c2")!;
    expect(c1.startMs).toBe(0);
    expect(c1.durationMs).toBe(800);
    expect(c1.sourceInMs).toBe(0);
    expect(c1.sourceOutMs).toBe(800);
    expect(c2.startMs).toBe(800);
    expect(next.project.playheadMs).toBe(800);
    expect(next.selectedClipId).toBe("c1");
  });

  it("playhead in a gap is a no-op with no history", () => {
    const start = trimSession({
      project: {
        ...trimSession().project,
        clips: [
          clip({ id: "c1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
          clip({ id: "c2", assetId: "va", trackId: "V1", startMs: 2000, durationMs: 1000 }),
        ],
        playheadMs: 1500,
      },
    });
    const next = applyCommand(start, { type: "rippleTrimToPlayhead", edge: "in" });
    expect(next).toBe(start);
    expect(next.history.past.length).toBe(start.history.past.length);
  });

  it("playhead on an edge is a no-op", () => {
    const startIn = trimSession({ project: { ...trimSession().project, playheadMs: 0 } });
    expect(applyCommand(startIn, { type: "rippleTrimToPlayhead", edge: "in" })).toBe(startIn);
    const startOut = trimSession({ project: { ...trimSession().project, playheadMs: 1000 } });
    expect(applyCommand(startOut, { type: "rippleTrimToPlayhead", edge: "out" })).toBe(startOut);
  });

  it("rate>1 keeps sourceIn/Out consistent with existing trim math", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const base = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "va",
              trackId: "V1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 2000,
              rate: 2,
            }),
            clip({
              id: "c2",
              assetId: "va",
              trackId: "V1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
          ],
          [va],
        ),
        snap: false,
        playheadMs: 200,
      },
      selectedClipId: "c1",
      selectedClipIds: ["c1"],
    };
    const q = applyCommand(base, { type: "rippleTrimToPlayhead", edge: "in" });
    const q1 = q.project.clips.find((c) => c.id === "c1")!;
    expect(q1.startMs).toBe(0);
    expect(q1.durationMs).toBe(800);
    expect(q1.sourceInMs).toBe(400);
    expect(q1.sourceOutMs).toBe(2000);
    expect(q1.rate).toBe(2);
    expect(q.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);

    const w = applyCommand({ ...base, project: { ...base.project, playheadMs: 800 } }, {
      type: "rippleTrimToPlayhead",
      edge: "out",
    });
    const w1 = w.project.clips.find((c) => c.id === "c1")!;
    expect(w1.durationMs).toBe(800);
    expect(w1.sourceInMs).toBe(0);
    expect(w1.sourceOutMs).toBe(1600);
    expect(w1.rate).toBe(2);
    expect(w.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
  });

  it("menu ripple trim parks at snapped click time then trims (P90)", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [clip({ id: "c1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 4000 })],
          [va],
        ),
        markers: [{ id: "m1", timeMs: 2000, label: "M" }],
        playheadMs: 0,
        snap: true,
      },
      selectedClipId: "c1",
      selectedClipIds: ["c1"],
    };
    const parked = applyPlayhead(start, snapPlayheadSeek(start.project, 2070));
    expect(parked.project.playheadMs).toBe(2000);
    const out = applyCommand(parked, { type: "rippleTrimToPlayhead", edge: "out" });
    expect(out.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(2000);
    expect(out.project.playheadMs).toBe(2000);

    const stale = applyCommand(start, { type: "rippleTrimToPlayhead", edge: "out" });
    expect(stale.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(4000);
  });
});
