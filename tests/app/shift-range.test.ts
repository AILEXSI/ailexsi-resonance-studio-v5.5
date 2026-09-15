import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applySelectVis,
  clipsInShiftRange,
  createSession,
  selectionOf,
  type Session,
} from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function videoRangeSession(): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 8000 });
  const aa = asset({ id: "aa", kind: "audio", durationMs: 8000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 800 }),
        clip({ id: "v2", assetId: "va", trackId: "V1", startMs: 1000, durationMs: 800 }),
        clip({ id: "v3", assetId: "va", trackId: "V1", startMs: 2000, durationMs: 800 }),
        clip({ id: "w1", assetId: "va", trackId: "V2", startMs: 0, durationMs: 800 }),
        clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 800 }),
      ],
      [va, aa],
    ),
  };
}

describe("Shift+click range select", () => {
  it("selects an inclusive same-track range from the plain-click anchor", () => {
    const start = applyCommand(videoRangeSession(), { type: "select", clipId: "v1" });
    expect(start.selectionAnchorClipId).toBe("v1");
    const ranged = applyCommand(start, { type: "select", clipId: "v3", range: true });
    expect(selectionOf(ranged)).toEqual(["v1", "v2", "v3"]);
    expect(ranged.selectedClipId).toBe("v1");
    expect(ranged.selectionAnchorClipId).toBe("v1");
    expect(ranged.history.past.length).toBe(start.history.past.length);
  });

  it("works in reverse startMs order", () => {
    const start = applyCommand(videoRangeSession(), { type: "select", clipId: "v3" });
    const ranged = applyCommand(start, { type: "select", clipId: "v1", range: true });
    expect(selectionOf(ranged)).toEqual(["v1", "v2", "v3"]);
    expect(ranged.selectionAnchorClipId).toBe("v3");
  });

  it("does not cross video and audio", () => {
    const start = applyCommand(videoRangeSession(), { type: "select", clipId: "v1" });
    const next = applyCommand(start, { type: "select", clipId: "a1", range: true });
    expect(selectionOf(next)).toEqual(["v1"]);
    expect(clipsInShiftRange(start.project, "v1", "a1")).toEqual([]);
  });

  it("does not range across V1 and V2", () => {
    const start = applyCommand(videoRangeSession(), { type: "select", clipId: "v1" });
    const next = applyCommand(start, { type: "select", clipId: "w1", range: true });
    expect(selectionOf(next)).toEqual(["v1"]);
    expect(clipsInShiftRange(start.project, "v1", "w1")).toEqual([]);
  });

  it("uses the earliest selected clip when there is no anchor", () => {
    const boxed = applyCommand(videoRangeSession(), {
      type: "selectClips",
      clipIds: ["v3", "v2"],
    });
    expect(boxed.selectionAnchorClipId).toBeNull();
    const ranged = applyCommand(boxed, { type: "select", clipId: "v1", range: true });
    expect(selectionOf(ranged)).toEqual(["v1", "v2"]);
    expect(ranged.selectionAnchorClipId).toBe("v2");
  });

  it("Ctrl/Cmd toggle does not move the anchor unless the selection was empty", () => {
    const start = applyCommand(videoRangeSession(), { type: "select", clipId: "v1" });
    const toggled = applyCommand(start, { type: "select", clipId: "v2", toggle: true });
    expect(selectionOf(toggled)).toEqual(["v2", "v1"]);
    expect(toggled.selectionAnchorClipId).toBe("v1");
    const ranged = applyCommand(toggled, { type: "select", clipId: "v3", range: true });
    expect(selectionOf(ranged)).toEqual(["v1", "v2", "v3"]);

    const empty = videoRangeSession();
    const firstToggle = applyCommand(empty, { type: "select", clipId: "v2", toggle: true });
    expect(selectionOf(firstToggle)).toEqual(["v2"]);
    expect(firstToggle.selectionAnchorClipId).toBe("v2");
  });

  it("Shift+click with an empty selection selects the clicked clip and sets the anchor", () => {
    const empty = videoRangeSession();
    const next = applyCommand(empty, { type: "select", clipId: "v2", range: true });
    expect(selectionOf(next)).toEqual(["v2"]);
    expect(next.selectionAnchorClipId).toBe("v2");
  });

  it("does not treat the VIS overlay as a clip in the range", () => {
    const start = applyCommand(videoRangeSession(), { type: "select", clipId: "v1" });
    const vis = applySelectVis(start);
    expect(vis.selectionAnchorClipId).toBeNull();
    expect(clipsInShiftRange(start.project, "v1", "visualizer")).toEqual([]);
    const next = applyCommand(vis, { type: "select", clipId: "v3", range: true });
    expect(selectionOf(next)).toEqual(["v3"]);
    expect(next.selectionAnchorClipId).toBe("v3");
    expect(next.selectedVis).toBe(false);
  });
});
