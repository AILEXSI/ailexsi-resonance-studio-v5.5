import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function gapSession(overrides: Partial<Session> = {}): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 8000 });
  const aa = asset({ id: "aa", kind: "audio", durationMs: 8000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: {
      ...projectWith(
        [
          clip({ id: "v1a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
          clip({ id: "v1b", assetId: "va", trackId: "V1", startMs: 2000, durationMs: 1000 }),
          clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 2000, durationMs: 1000 }),
        ],
        [va, aa],
      ),
      playheadMs: 1500,
    },
    selectedClipId: "v1a",
    selectedClipIds: ["v1a"],
    ...overrides,
  };
}

function starts(session: Session): Record<string, number> {
  return Object.fromEntries(session.project.clips.map((c) => [c.id, c.startMs]));
}

describe("closeGap", () => {
  it("is registered on applyCommand and packs the later V1 clip", () => {
    const start = gapSession();
    const next = applyCommand(start, { type: "closeGap" });
    expect(starts(next)).toEqual({ v1a: 0, v1b: 1000, a1: 2000 });
    expect(next.project.clips.find((c) => c.id === "v1a")!.durationMs).toBe(1000);
    expect(next.project.playheadMs).toBe(1500);
    expect(next.project.inPointMs).toBe(start.project.inPointMs);
    expect(next.status).toBe("Closed gap");
    expect(next.history.past.length).toBe(start.history.past.length + 1);
  });

  it("playhead inside the first clip is a no-op with no history", () => {
    const start = gapSession({
      project: { ...gapSession().project, playheadMs: 500 },
    });
    const next = applyCommand(start, { type: "closeGap" });
    expect(next).toBe(start);
    expect(next.history.past.length).toBe(start.history.past.length);
    expect(starts(next)).toEqual(starts(start));
  });

  it("no later clip is a no-op", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [clip({ id: "v1a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 })],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "v1a",
      selectedClipIds: ["v1a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(next).toBe(start);
  });

  it("empty track is a no-op", () => {
    const start = createSession(createMemoryBlobStore());
    const next = applyCommand(start, { type: "closeGap" });
    expect(next).toBe(start);
    expect(next.history.past.length).toBe(0);
  });

  it("three later clips all shift by the same gap", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({ id: "b", assetId: "va", trackId: "V1", startMs: 2000, durationMs: 500 }),
            clip({ id: "c", assetId: "va", trackId: "V1", startMs: 3000, durationMs: 500 }),
            clip({ id: "d", assetId: "va", trackId: "V1", startMs: 4000, durationMs: 500 }),
          ],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "a",
      selectedClipIds: ["a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(starts(next)).toEqual({ a: 0, b: 1000, c: 2000, d: 3000 });
  });

  it("leaves A1 clips unchanged when closing V1", () => {
    const next = applyCommand(gapSession(), { type: "closeGap" });
    expect(next.project.clips.find((c) => c.id === "a1")!.startMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "a1")!.trackId).toBe("A1");
  });

  it("does not move a linked A1 mate", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const aa = asset({ id: "aa", kind: "audio", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "v1a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({
              id: "v1b",
              assetId: "va",
              trackId: "V1",
              startMs: 2000,
              durationMs: 1000,
              linkId: "pair-1",
            }),
            clip({
              id: "a1",
              assetId: "aa",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              linkId: "pair-1",
            }),
          ],
          [va, aa],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "v1a",
      selectedClipIds: ["v1a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(next.project.clips.find((c) => c.id === "v1b")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "a1")!.startMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "a1")!.linkId).toBe("pair-1");
  });

  it("refuses to pack an unlocked later clip through a locked wall (P124)", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({
              id: "wall",
              assetId: "va",
              trackId: "V1",
              startMs: 2000,
              durationMs: 1000,
              locked: true,
            }),
            clip({ id: "c", assetId: "va", trackId: "V1", startMs: 3000, durationMs: 500 }),
          ],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "a",
      selectedClipIds: ["a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(next.project).toBe(start.project);
    expect(next.error).toBe("Clip is locked");
    expect(starts(next)).toEqual(starts(start));
    expect(next.history.past.length).toBe(start.history.past.length);
  });

  it("refuses when the next clip that would close the gap is locked (P132)", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({
              id: "wall",
              assetId: "va",
              trackId: "V1",
              startMs: 2000,
              durationMs: 500,
              locked: true,
            }),
            clip({ id: "c", assetId: "va", trackId: "V1", startMs: 4000, durationMs: 500 }),
          ],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "a",
      selectedClipIds: ["a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(next.error).toBe("Clip is locked");
    expect(starts(next)).toEqual(starts(start));
    expect(next.project.clips.find((c) => c.id === "c")!.startMs).toBe(4000);
    expect(next.history.past.length).toBe(start.history.past.length);
  });

  it("skips disabled clips when finding and packing the gap (P133)", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({
              id: "off",
              assetId: "va",
              trackId: "V1",
              startMs: 2000,
              durationMs: 1000,
              enabled: false,
            }),
            clip({ id: "c", assetId: "va", trackId: "V1", startMs: 4000, durationMs: 500 }),
          ],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "a",
      selectedClipIds: ["a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(next.error).toBeNull();
    expect(starts(next)).toEqual({ a: 0, off: 2000, c: 1000 });
    expect(next.project.clips.find((c) => c.id === "off")!.enabled).toBe(false);
  });

  it("playhead inside a disabled clip still closes the enabled gap (P133)", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({
              id: "off",
              assetId: "va",
              trackId: "V1",
              startMs: 1200,
              durationMs: 600,
              enabled: false,
            }),
            clip({ id: "c", assetId: "va", trackId: "V1", startMs: 3000, durationMs: 500 }),
          ],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "a",
      selectedClipIds: ["a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(next.error).toBeNull();
    expect(starts(next)).toEqual({ a: 0, off: 1200, c: 1000 });
  });

  it("still packs unlocked later clips that do not hit a locked wall", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({ id: "b", assetId: "va", trackId: "V1", startMs: 2000, durationMs: 500 }),
            clip({
              id: "wall",
              assetId: "va",
              trackId: "V1",
              startMs: 4000,
              durationMs: 500,
              locked: true,
            }),
          ],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "a",
      selectedClipIds: ["a"],
    };
    const next = applyCommand(start, { type: "closeGap" });
    expect(next.error).toBeNull();
    expect(starts(next)).toEqual({ a: 0, b: 1000, wall: 4000 });
  });

  it("undo restores starts", () => {
    const start = gapSession();
    const closed = applyCommand(start, { type: "closeGap" });
    const undone = applyCommand(closed, { type: "undo" });
    expect(starts(undone)).toEqual(starts(start));
    expect(undone.project.playheadMs).toBe(1500);
  });
});
