import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { applySelectVisEvent, createSession, selectionOf, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function multiTrackSession(): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 4000 });
  const aa = asset({ id: "aa", kind: "audio", durationMs: 4000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: {
      ...projectWith(
        [
          clip({ id: "v1a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 800 }),
          clip({ id: "v1b", assetId: "va", trackId: "V1", startMs: 1000, durationMs: 800 }),
          clip({ id: "v2", assetId: "va", trackId: "V2", startMs: 0, durationMs: 800 }),
          clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 800 }),
        ],
        [va, aa],
      ),
      visualizer: {
        enabled: true,
        muted: false,
        sceneId: "resonance-wave",
        startMs: 0,
        durationMs: 0,
        events: [
          { id: "e1", sceneId: "resonance-wave", startMs: 0, durationMs: 1000 },
          { id: "e2", sceneId: "pulse-orb", startMs: 2000, durationMs: 1000 },
        ],
      },
    },
    selectedClipId: "v1a",
    selectedClipIds: ["v1a"],
  };
}

function sessionOf(action: ReturnType<typeof dispatchEditorKey>): Session {
  expect(action.type).toBe("session");
  if (action.type !== "session") throw new Error("expected session");
  return action.session;
}

describe("select all (P44)", () => {
  it("Ctrl+A selects every clip and does not push history", () => {
    const start = multiTrackSession();
    const past = start.history.past.length;
    const next = applyCommand(start, { type: "selectAll" });
    expect(selectionOf(next).sort()).toEqual(["a1", "v1a", "v1b", "v2"]);
    expect(next.selectedClipId).toBe("v1a");
    expect(next.selectedVis).toBe(false);
    expect(next.selectedVisEventId).toBeNull();
    expect(next.history.past.length).toBe(past);
    const viaKey = sessionOf(dispatchEditorKey(start, false, { key: "a", ctrlKey: true }));
    expect(selectionOf(viaKey).sort()).toEqual(["a1", "v1a", "v1b", "v2"]);
    expect(viaKey.history.past.length).toBe(past);
    const viaMeta = sessionOf(dispatchEditorKey(start, false, { key: "A", metaKey: true }));
    expect(selectionOf(viaMeta)).toHaveLength(4);
  });

  it("does not fire when target is an input", () => {
    const start = multiTrackSession();
    const action = dispatchEditorKey(start, false, { key: "a", ctrlKey: true, formFocus: true });
    expect(action.type).toBe("none");
    expect(selectionOf(start)).toEqual(["v1a"]);
  });

  it("Ctrl+Shift+A selects only the primary clip’s track", () => {
    const start = multiTrackSession();
    const next = applyCommand(start, { type: "selectAllOnTrack" });
    expect(selectionOf(next).sort()).toEqual(["v1a", "v1b"]);
    expect(next.selectedClipId).toBe("v1a");
    expect(next.history.past.length).toBe(start.history.past.length);
    const viaKey = sessionOf(
      dispatchEditorKey(start, false, { key: "a", ctrlKey: true, shiftKey: true }),
    );
    expect(selectionOf(viaKey).sort()).toEqual(["v1a", "v1b"]);
    const a1 = applyCommand(start, { type: "select", clipId: "a1" });
    const onlyA = applyCommand(a1, { type: "selectAllOnTrack" });
    expect(selectionOf(onlyA)).toEqual(["a1"]);
  });

  it("VIS-selected Ctrl+A selects all events not clips", () => {
    const start = applySelectVisEvent(multiTrackSession(), "e1");
    expect(start.selectedVisEventId).toBe("e1");
    expect(selectionOf(start)).toEqual([]);
    const next = applyCommand(start, { type: "selectAll" });
    expect(selectionOf(next)).toEqual([]);
    expect(next.selectedVis).toBe(true);
    expect(next.selectedVisEventIds.sort()).toEqual(["e1", "e2"]);
    expect(next.selectedVisEventId).toBe("e1");
    expect(next.history.past.length).toBe(start.history.past.length);
    const viaKey = sessionOf(dispatchEditorKey(start, false, { key: "a", ctrlKey: true }));
    expect(viaKey.selectedVisEventIds.sort()).toEqual(["e1", "e2"]);
    expect(selectionOf(viaKey)).toEqual([]);
  });

  it("empty project is a no-op; undo policy matches applySelect", () => {
    const empty = createSession(createMemoryBlobStore());
    const again = applyCommand(empty, { type: "selectAll" });
    expect(again).toBe(empty);
    expect(again.history.past.length).toBe(0);
    const start = multiTrackSession();
    const selected = applyCommand(start, { type: "select", clipId: "v2" });
    expect(selected.history.past.length).toBe(start.history.past.length);
    const all = applyCommand(selected, { type: "selectAll" });
    expect(all.history.past.length).toBe(selected.history.past.length);
  });
});
