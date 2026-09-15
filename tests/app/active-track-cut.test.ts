import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  activeEditTrackIds,
  applySelectTracks,
  applySelectVis,
  applySelectVisEvent,
  createSession,
  type Session,
} from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { visualizerEventsOf } from "../../src/core/visualizer";
import { asset, clip, projectWith } from "../helpers";

function stacked(active: "V1" | "V2" | "A1" | "A2" | "vis", extra?: Partial<Session>): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 2000, objectUrl: "blob:v", hasAudio: true });
  const vb = asset({ id: "vb", kind: "video", durationMs: 2000, objectUrl: "blob:v2" });
  const aa = asset({ id: "aa", kind: "audio", durationMs: 2000, objectUrl: "blob:a" });
  const base = createSession(createMemoryBlobStore());
  const project = {
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
          id: "v2",
          assetId: "vb",
          trackId: "V2",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
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
          assetId: "aa",
          trackId: "A2",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
        }),
      ],
      [va, vb, aa],
    ),
    snap: false,
    playheadMs: 1000,
  };
  if (active === "vis") {
    return {
      ...base,
      project: {
        ...project,
        visualizer: {
          ...project.visualizer,
          events: [
            { id: "ve1", sceneId: "tunnel-spiral", startMs: 0, durationMs: 2000 },
            { id: "ve2", sceneId: "spectrum-bars", startMs: 2000, durationMs: 500 },
          ],
        },
      },
      selectedClipId: null,
      selectedClipIds: [],
      selectedVis: true,
      selectedVisEventId: "ve1",
      selectedVisEventIds: ["ve1"],
      targetTrackId: "V1",
      selectedTrackIds: [],
      ...extra,
    };
  }
  const clipId = active === "V1" ? "v1" : active === "V2" ? "v2" : active === "A1" ? "a1" : "a2";
  return {
    ...base,
    project,
    selectedClipId: clipId,
    selectedClipIds: [clipId],
    targetTrackId: active,
    selectedTrackIds: [active],
    ...extra,
  };
}

describe("active-track split (S)", () => {
  it("S on V1 splits video only and leaves A1 / V2 / A2 whole", () => {
    const next = applyCommand(stacked("V1"), { type: "split" });
    expect(next.error).toBeNull();
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "V2")).toHaveLength(1);
    expect(next.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
    expect(next.project.clips.filter((c) => c.trackId === "A2")).toHaveLength(1);
    expect(next.project.clips.find((c) => c.id === "a1")!.durationMs).toBe(2000);
  });

  it("S on A1 splits audio only and leaves V1 whole (no linked mate cut)", () => {
    const next = applyCommand(stacked("A1"), { type: "split" });
    expect(next.error).toBeNull();
    expect(next.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(1);
    expect(next.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
  });

  it("S with VIS focused splits the VIS block under the playhead and leaves V1–A2 whole", () => {
    const start = stacked("vis");
    const next = applyCommand(start, { type: "split" });
    expect(next.error).toBeNull();
    expect(next.status).toBe("Split at playhead");
    expect(next.project.clips).toHaveLength(4);
    expect(next.project.clips.every((c) => c.durationMs === 2000)).toBe(true);
    const events = visualizerEventsOf(next.project).sort((a, b) => a.startMs - b.startMs);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ id: "ve1", sceneId: "tunnel-spiral", startMs: 0, durationMs: 1000 });
    expect(events[1]).toMatchObject({ sceneId: "tunnel-spiral", startMs: 1000, durationMs: 1000 });
    expect(events[1]!.id).not.toBe("ve1");
    expect(events[2]).toMatchObject({ id: "ve2", sceneId: "spectrum-bars", startMs: 2000, durationMs: 500 });
    expect(next.history.past.length).toBe(start.history.past.length + 1);
  });

  it("S with VIS header selected (no event id) still splits the covering VIS block", () => {
    const start = applySelectVis(stacked("vis"));
    expect(start.selectedVis).toBe(true);
    expect(start.selectedVisEventId).toBeNull();
    expect(activeEditTrackIds(start)).toEqual([]);
    const next = applyCommand(start, { type: "split" });
    expect(next.error).toBeNull();
    const events = visualizerEventsOf(next.project).sort((a, b) => a.startMs - b.startMs);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ startMs: 0, durationMs: 1000, sceneId: "tunnel-spiral" });
    expect(events[1]).toMatchObject({ startMs: 1000, durationMs: 1000, sceneId: "tunnel-spiral" });
    expect(next.project.clips.every((c) => c.durationMs === 2000)).toBe(true);
  });

  it("S with a VIS event selected splits that lane even when leftover V1 track ids exist", () => {
    const start = applySelectVisEvent(
      { ...stacked("vis"), selectedTrackIds: ["V1"], targetTrackId: "V1" },
      "ve1",
    );
    expect(start.selectedTrackIds).toEqual([]);
    const next = applyCommand(start, { type: "split" });
    expect(visualizerEventsOf(next.project).filter((e) => e.sceneId === "tunnel-spiral")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(1);
  });

  it("S with VIS focused splits cue-only / window VIS content (not clip tracks)", () => {
    const cuesOnly = stacked("vis", {
      project: {
        ...stacked("vis").project,
        playheadMs: 3000,
        visualizer: {
          ...stacked("vis").project.visualizer,
          sceneId: "tunnel-spiral",
          events: [],
          cues: [
            { startMs: 0, sceneId: "tunnel-spiral" },
            { startMs: 8000, sceneId: "pulse-orb" },
          ],
        },
      },
      selectedVis: true,
      selectedVisEventId: null,
      selectedVisEventIds: [],
    });
    const cued = applyCommand(cuesOnly, { type: "split" });
    expect(cued.error).toBeNull();
    const cuedEvents = visualizerEventsOf(cued.project).sort((a, b) => a.startMs - b.startMs);
    expect(cuedEvents[0]).toMatchObject({ sceneId: "tunnel-spiral", startMs: 0, durationMs: 3000 });
    expect(cuedEvents[1]).toMatchObject({ sceneId: "tunnel-spiral", startMs: 3000 });
    expect(cuedEvents.some((e) => e.startMs === 8000 && e.sceneId === "pulse-orb")).toBe(true);
    expect(cued.project.visualizer.cues?.some((c) => c.startMs === 3000 && c.sceneId === "tunnel-spiral")).toBe(
      true,
    );
    expect(cued.project.clips.every((c) => c.durationMs === 2000)).toBe(true);

    const windowOnly = stacked("vis", {
      project: {
        ...stacked("vis").project,
        playheadMs: 1000,
        visualizer: {
          ...stacked("vis").project.visualizer,
          sceneId: "tunnel-spiral",
          startMs: 0,
          durationMs: 0,
          events: [],
          cues: [],
        },
      },
      selectedVis: true,
      selectedVisEventId: null,
    });
    const windowed = applyCommand(windowOnly, { type: "split" });
    expect(windowed.error).toBeNull();
    const windowEvents = visualizerEventsOf(windowed.project).sort((a, b) => a.startMs - b.startMs);
    expect(windowEvents).toHaveLength(2);
    expect(windowEvents[0]).toMatchObject({ sceneId: "tunnel-spiral", startMs: 0, durationMs: 1000 });
    expect(windowEvents[1]).toMatchObject({ sceneId: "tunnel-spiral", startMs: 1000 });
    expect(windowed.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(1);
  });

  it("S with no clip uses mixer targetTrackId only", () => {
    const start = stacked("V1", {
      selectedClipId: null,
      selectedClipIds: [],
      targetTrackId: "A2",
      selectedTrackIds: ["A2"],
    });
    const next = applyCommand(start, { type: "split" });
    expect(next.project.clips.filter((c) => c.trackId === "A2")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(1);
    expect(next.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
  });

  it("S with multi-selected tracks cuts only those at the playhead", () => {
    const start = applySelectTracks(
      applySelectTracks(stacked("vis", { selectedVis: false, selectedVisEventId: null }), "V1"),
      "A2",
      { toggle: true },
    );
    expect(activeEditTrackIds(start).sort()).toEqual(["A2", "V1"]);
    const next = applyCommand(start, { type: "split" });
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "A2")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "V2")).toHaveLength(1);
    expect(next.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
  });

  it("S with clips selected on V1 and A2 cuts those tracks only", () => {
    const start = stacked("V1", { selectedClipId: "v1", selectedClipIds: ["v1", "a2"] });
    expect(activeEditTrackIds(start).sort()).toEqual(["A2", "V1"]);
    const next = applyCommand(start, { type: "split" });
    expect(next.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "A2")).toHaveLength(2);
    expect(next.project.clips.filter((c) => c.trackId === "V2")).toHaveLength(1);
    expect(next.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
  });
});
