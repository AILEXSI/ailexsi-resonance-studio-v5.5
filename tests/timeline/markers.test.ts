import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applyDelete,
  applyDeleteMarker,
  applyMarker,
  applyMoveMarker,
  applySelect,
  applySelectMarker,
  createSession,
  projectJson,
} from "../../src/app/session";
import { dispatchEditorKey } from "../../src/app/keys";
import { deserializeProject } from "../../src/core/project";
import { addMarker, deleteMarker, moveMarker } from "../../src/core/timeline";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function sessionWithMarkers() {
  const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
  const c = clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 2000 });
  let project = projectWith([c], [a]);
  project = addMarker(project, 1000, "M1");
  project = addMarker(project, 2500, "M2");
  const m1 = project.markers[0]!;
  const m2 = project.markers[1]!;
  return {
    session: {
      ...createSession(createMemoryBlobStore()),
      project,
      selectedClipId: null as string | null,
      selectedMarkerId: m1.id,
    },
    m1,
    m2,
  };
}

describe("markers", () => {
  it("selecting a marker seeks the playhead to that mark (P50)", () => {
    const { session, m2 } = sessionWithMarkers();
    expect(session.project.playheadMs).toBe(0);
    const atM2 = applySelectMarker(session, m2.id);
    expect(atM2.selectedMarkerId).toBe(m2.id);
    expect(atM2.project.playheadMs).toBe(m2.timeMs);
    expect(atM2.selectedClipId).toBeNull();
    const cleared = applySelectMarker(atM2, null);
    expect(cleared.selectedMarkerId).toBeNull();
    expect(cleared.project.playheadMs).toBe(m2.timeMs);
  });

  it("drag / moveMarker changes that marker time and keeps the rest", () => {
    const { session, m1, m2 } = sessionWithMarkers();
    const moved = moveMarker(session.project, m1.id, 1800);
    expect(moved.error).toBeUndefined();
    expect(moved.project.markers.find((m) => m.id === m1.id)?.timeMs).toBe(1800);
    expect(moved.project.markers.find((m) => m.id === m2.id)?.timeMs).toBe(2500);

    const live = applyMoveMarker(session, m1.id, 3200);
    expect(live.project.markers.find((m) => m.id === m1.id)?.timeMs).toBe(3200);
    expect(live.selectedMarkerId).toBe(m1.id);
    expect(live.selectedClipId).toBeNull();
  });

  it("snaps marker drag to clip edges, not to itself (P85)", () => {
    const { session, m1, m2 } = sessionWithMarkers();
    expect(session.project.snap).toBe(true);
    expect(m1.timeMs).toBe(1000);
    expect(m2.timeMs).toBe(2500);

    const toClipEnd = applyMoveMarker(session, m1.id, 2070);
    expect(toClipEnd.project.markers.find((m) => m.id === m1.id)?.timeMs).toBe(2000);

    const toOther = applyMoveMarker(session, m1.id, 2550);
    expect(toOther.project.markers.find((m) => m.id === m1.id)?.timeMs).toBe(2500);

    const pastSelf = applyMoveMarker(session, m1.id, 1050);
    expect(pastSelf.project.markers.find((m) => m.id === m1.id)?.timeMs).toBe(1050);

    const off = applyMoveMarker(
      { ...session, project: { ...session.project, snap: false } },
      m1.id,
      2070,
    );
    expect(off.project.markers.find((m) => m.id === m1.id)?.timeMs).toBe(2070);
  });

  it("renameMarker writes label and persists (P68)", () => {
    const { session, m1, m2 } = sessionWithMarkers();
    const next = applyCommand(session, { type: "renameMarker", markerId: m1.id, label: " Chorus " });
    expect(next.project.markers.find((m) => m.id === m1.id)?.label).toBe("Chorus");
    expect(next.project.markers.find((m) => m.id === m2.id)?.label).toBe("M2");
    expect(next.status).toBe("Marker renamed");
    const raw = JSON.parse(projectJson(next)) as { markers: Array<{ id: string; label: string }> };
    expect(raw.markers.find((m) => m.id === m1.id)?.label).toBe("Chorus");
    expect(deserializeProject(projectJson(next)).markers.find((m) => m.id === m1.id)?.label).toBe("Chorus");
    expect(applyCommand(session, { type: "renameMarker", markerId: m1.id, label: "M1" })).toBe(session);
    expect(applyCommand(session, { type: "renameMarker", markerId: "nope", label: "X" }).error).toBe(
      "Marker not found",
    );
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.markers.find((m) => m.id === m1.id)?.label).toBe("M1");
    const redone = applyCommand(undone, { type: "redo" });
    expect(redone.project.markers.find((m) => m.id === m1.id)?.label).toBe("Chorus");
  });

  it("delete already exists; label is stored; no rename required (P66 KEEP)", () => {
    const { session, m1, m2 } = sessionWithMarkers();
    expect(m1.label).toBe("M1");
    expect(m2.label).toBe("M2");
    const gone = applyDeleteMarker(session, m1.id);
    expect(gone.project.markers.map((m) => m.id)).toEqual([m2.id]);
    expect(gone.project.markers[0]!.label).toBe("M2");
    const viaKey = dispatchEditorKey(
      { ...session, selectedMarkerId: m2.id, selectedClipId: null },
      false,
      { key: "Delete" },
    );
    expect(viaKey.type).toBe("session");
    if (viaKey.type !== "session") throw new Error("expected session");
    expect(viaKey.session.project.markers.map((m) => m.id)).toEqual([m1.id]);
  });

  it("delete removes that marker only", () => {
    const { session, m1, m2 } = sessionWithMarkers();
    const next = applyDelete(session);
    expect(next.project.markers.map((m) => m.id)).toEqual([m2.id]);
    expect(next.project.clips).toHaveLength(1);
    expect(next.selectedMarkerId).toBeNull();

    const viaId = applyDeleteMarker(session, m2.id);
    expect(viaId.project.markers.map((m) => m.id)).toEqual([m1.id]);
    expect(viaId.project.clips).toHaveLength(1);
  });

  it("Delete/Backspace does not steal clip-delete when a clip is selected", () => {
    const { session, m1, m2 } = sessionWithMarkers();
    const withClip = applySelect(session, "c1");
    expect(withClip.selectedClipId).toBe("c1");
    expect(withClip.selectedMarkerId).toBeNull();
    const action = dispatchEditorKey({ ...withClip, selectedMarkerId: m1.id }, false, { key: "Delete" });
    expect(action.type).toBe("session");
    if (action.type !== "session") throw new Error("expected session");
    expect(action.session.project.clips).toHaveLength(0);
    expect(action.session.project.markers.map((m) => m.id).sort()).toEqual([m1.id, m2.id].sort());
  });

  it("Delete/Backspace removes the selected marker when no clip is selected", () => {
    const { session, m1, m2 } = sessionWithMarkers();
    const marked = applySelectMarker(session, m1.id);
    const del = dispatchEditorKey(marked, false, { key: "Delete" });
    const back = dispatchEditorKey(marked, false, { key: "Backspace" });
    expect(del.type).toBe("session");
    expect(back.type).toBe("session");
    if (del.type !== "session" || back.type !== "session") throw new Error("expected session");
    expect(del.session.project.markers.map((m) => m.id)).toEqual([m2.id]);
    expect(back.session.project.markers.map((m) => m.id)).toEqual([m2.id]);
    expect(del.session.project.clips).toHaveLength(1);
  });

  it("moved time is stored in project JSON", () => {
    const { session, m1 } = sessionWithMarkers();
    const moved = applyMoveMarker(session, m1.id, 4444);
    const raw = JSON.parse(projectJson(moved)) as { markers: Array<{ id: string; timeMs: number }> };
    expect(raw.markers.find((m) => m.id === m1.id)?.timeMs).toBe(4444);
    const loaded = deserializeProject(projectJson(moved));
    expect(loaded.markers.find((m) => m.id === m1.id)?.timeMs).toBe(4444);
  });

  it("M adds a marker at the playhead (P64 KEEP)", () => {
    const start = sessionWithMarkers().session;
    expect(start.project.markers).toHaveLength(2);
    const action = dispatchEditorKey(
      { ...start, project: { ...start.project, playheadMs: 777 }, selectedMarkerId: null },
      false,
      { key: "m" },
    );
    expect(action.type).toBe("session");
    if (action.type !== "session") throw new Error("expected session");
    expect(action.session.project.markers).toHaveLength(3);
    expect(action.session.project.markers.some((m) => m.timeMs === 777)).toBe(true);
    expect(action.session.status).toBe("Marker added");
  });

  it("M snaps the new mark to nearby edges; playhead stays (P92)", () => {
    const start = sessionWithMarkers().session;
    const parked = {
      ...start,
      project: { ...start.project, playheadMs: 2070, snap: true },
      selectedMarkerId: null,
    };
    expect(parked.project.markers.some((m) => m.timeMs === 2000)).toBe(false);
    const added = applyMarker(parked);
    expect(added.project.markers.filter((m) => m.timeMs === 2000)).toHaveLength(1);
    expect(added.project.playheadMs).toBe(2070);

    const off = applyMarker({ ...parked, project: { ...parked.project, snap: false } });
    expect(off.project.markers.some((m) => m.timeMs === 2070)).toBe(true);
    expect(off.project.playheadMs).toBe(2070);
  });

  it("add marker at playhead then deleteMarker removes only the new one", () => {
    const start = sessionWithMarkers().session;
    const added = applyMarker({ ...start, project: { ...start.project, playheadMs: 900 } });
    expect(added.project.markers).toHaveLength(3);
    expect(added.selectedMarkerId).toBeTruthy();
    expect(added.selectedClipId).toBeNull();
    const gone = deleteMarker(added.project, added.selectedMarkerId!);
    expect(gone.project.markers).toHaveLength(2);
  });
});
