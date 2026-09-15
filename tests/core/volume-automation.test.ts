import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession } from "../../src/app/session";
import { addAudioTrack } from "../../src/core/audio-tracks";
import { jobFromProject } from "../../src/core/exporter";
import { dbToLinear } from "../../src/core/volume";
import {
  addVolumeAutomationPoint,
  automationValueAt,
  deleteVolumeAutomationPoint,
  moveVolumeAutomationPoint,
  sanitizeVolumeAutomation,
  setTrackVolumeAutomation,
  setVolumeAutomationEnabled,
} from "../../src/core/volume-automation";
import { mixLinearGain } from "../../src/core/volume";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject, deserializeProject, serializeProject } from "../../src/core/project";
import { assignTracksToGroup, createTrackGroup } from "../../src/core/track-groups";
import { relinkClipsOnProject } from "../../src/core/relink";
import { asset, clip } from "../helpers";

function auto(points: { timeMs: number; value: number }[], enabled = true) {
  return { enabled, points };
}

describe("volume automation model", () => {
  it("empty and disabled envelopes are unity (prior behavior)", () => {
    expect(automationValueAt(undefined, 0)).toBe(1);
    expect(automationValueAt(auto([], true), 500)).toBe(1);
    expect(automationValueAt(auto([{ timeMs: 0, value: 0.5 }], false), 500)).toBe(1);
  });

  it("one point is constant for all time", () => {
    const env = auto([{ timeMs: 1000, value: 0.5 }]);
    expect(automationValueAt(env, 0)).toBeCloseTo(0.5, 8);
    expect(automationValueAt(env, 1000)).toBeCloseTo(0.5, 8);
    expect(automationValueAt(env, 8000)).toBeCloseTo(0.5, 8);
  });

  it("two points interpolate linearly and hold outside", () => {
    const env = auto([
      { timeMs: 0, value: 1 },
      { timeMs: 1000, value: 0 },
    ]);
    expect(automationValueAt(env, 0)).toBeCloseTo(1, 8);
    expect(automationValueAt(env, 500)).toBeCloseTo(0.5, 8);
    expect(automationValueAt(env, 1000)).toBeCloseTo(0, 8);
    expect(automationValueAt(env, 2000)).toBeCloseTo(0, 8);
  });

  it("orders points by time and drops invalid / duplicate times", () => {
    const cleaned = sanitizeVolumeAutomation({
      enabled: true,
      points: [
        { timeMs: 800, value: 0.25 },
        { timeMs: 200, value: 0.75 },
        { timeMs: 200, value: 0.5 },
        { timeMs: Number.NaN, value: 1 },
        { timeMs: 400, value: Number.POSITIVE_INFINITY },
        { timeMs: -12, value: 2 },
      ],
    });
    expect(cleaned?.points.map((p) => p.timeMs)).toEqual([0, 200, 800]);
    expect(cleaned?.points[1]?.value).toBeCloseTo(0.5, 8);
    expect(cleaned?.points.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  it("clamps values to the mixer linear range and rejects NaN", () => {
    const added = addVolumeAutomationPoint(createEmptyProject(), "A1", 0, 99);
    expect(added.point?.value).toBeLessThanOrEqual(dbToLinear(6) + 1e-9);
    expect(addVolumeAutomationPoint(createEmptyProject(), "A1", 0, Number.NaN).point).toBeUndefined();
    expect(sanitizeVolumeAutomation({ enabled: true, points: "nope" })?.points).toEqual([]);
  });

  it("enable/disable keeps points; disabled has no effect", () => {
    let project = setTrackVolumeAutomation(createEmptyProject(), "A1", {
      enabled: true,
      points: [
        { timeMs: 0, value: 0.25 },
        { timeMs: 1000, value: 0.25 },
      ],
    });
    expect(automationValueAt(project.tracks.find((t) => t.id === "A1")!.volumeAutomation, 100)).toBeCloseTo(0.25, 8);
    project = setVolumeAutomationEnabled(project, "A1", false);
    const env = project.tracks.find((t) => t.id === "A1")!.volumeAutomation!;
    expect(env.enabled).toBe(false);
    expect(env.points).toHaveLength(2);
    expect(automationValueAt(env, 100)).toBe(1);
  });

  it("multiplies clip gain × static track volume × automation", () => {
    expect(mixLinearGain(2, 0.5, 1, false, 0.5)).toBeCloseTo(0.5, 8);
    expect(mixLinearGain(1, 1, 1, false, 1)).toBeCloseTo(1, 8);
    expect(mixLinearGain(1, 1, 1, false)).toBeCloseTo(1, 8);
    expect(mixLinearGain(1, 1, 1, true, 0.25)).toBe(0);
  });
});

describe("volume automation persist / identity", () => {
  it("survives Save/Load on schemaVersion 5; missing field defaults to identity", () => {
    let project = createEmptyProject("Auto");
    project = addVolumeAutomationPoint(project, "A1", 0, 1).project;
    project = addVolumeAutomationPoint(project, "A1", 2000, 0.25).project;
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.schemaVersion).toBe(5);
    const env = loaded.tracks.find((t) => t.id === "A1")!.volumeAutomation!;
    expect(env.enabled).toBe(true);
    expect(env.points).toHaveLength(2);
    expect(automationValueAt(env, 1000)).toBeCloseTo(0.625, 5);

    const raw = JSON.parse(serializeProject(createEmptyProject())) as {
      tracks: Array<{ volumeAutomation?: unknown }>;
    };
    for (const t of raw.tracks) delete t.volumeAutomation;
    const legacy = deserializeProject(JSON.stringify(raw));
    expect(legacy.tracks.every((t) => t.volumeAutomation == null || t.volumeAutomation.points.length === 0)).toBe(true);
    expect(automationValueAt(legacy.tracks.find((t) => t.id === "A1")?.volumeAutomation, 0)).toBe(1);
  });

  it("hydrates from legacy automationLanes stub", () => {
    const project = createEmptyProject();
    const raw = JSON.parse(serializeProject(project)) as {
      tracks: Array<Record<string, unknown>>;
    };
    const a1 = raw.tracks.find((t) => t.id === "A1")!;
    delete a1.volumeAutomation;
    a1.automationLanes = [{ id: "vol", kind: "volume", points: [{ timeMs: 0, value: 0.4 }] }];
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points[0]?.value).toBeCloseTo(0.4, 8);
  });

  it("rename keeps automation (stable track id)", () => {
    let project = addVolumeAutomationPoint(createEmptyProject(), "A2", 250, 0.8).project;
    project = {
      ...project,
      tracks: project.tracks.map((t) => (t.id === "A2" ? { ...t, name: "Lead Vocals" } : t)),
    };
    const loaded = deserializeProject(serializeProject(project));
    const a2 = loaded.tracks.find((t) => t.id === "A2")!;
    expect(a2.name).toBe("Lead Vocals");
    expect(a2.volumeAutomation?.points[0]).toEqual({ timeMs: 250, value: 0.8 });
  });

  it("chapter assign/collapse does not change playback values", () => {
    let project = addVolumeAutomationPoint(createEmptyProject(), "A1", 0, 0.3).project;
    project = addVolumeAutomationPoint(project, "A1", 1000, 0.3).project;
    const before = automationValueAt(project.tracks.find((t) => t.id === "A1")!.volumeAutomation, 400);
    const grouped = createTrackGroup(project, { name: "Chapter I", trackIds: ["A1", "A2"] });
    const assigned = assignTracksToGroup(grouped.project, ["A1"], grouped.group!.id);
    const after = automationValueAt(assigned.tracks.find((t) => t.id === "A1")!.volumeAutomation, 400);
    expect(after).toBe(before);
    expect(mixLinearGain(1, 1, 1, false, after)).toBeCloseTo(0.3, 8);
  });

  it("missing media / relink keeps the track envelope", () => {
    let project = createEmptyProject();
    project = {
      ...project,
      assets: [asset({ id: "aa", kind: "audio", durationMs: 2000, missing: true })],
      clips: [clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 })],
    };
    project = addVolumeAutomationPoint(project, "A1", 0, 0.6).project;
    const withNew = {
      ...project,
      assets: [
        ...project.assets,
        asset({ id: "bb", kind: "audio", durationMs: 2000, missing: false }),
      ],
    };
    const relinked = relinkClipsOnProject(withNew, ["c1"], "bb");
    expect("project" in relinked).toBe(true);
    if (!("project" in relinked)) return;
    expect(relinked.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points[0]?.value).toBeCloseTo(0.6, 8);
    expect(relinked.project.clips[0]?.assetId).toBe("bb");
  });

  it("lives on dynamic tracks beyond A1/A2", () => {
    const added = addAudioTrack(createEmptyProject());
    const a3 = added.track!.id;
    const next = addVolumeAutomationPoint(added.project, a3, 0, 0.2).project;
    const moved = addVolumeAutomationPoint(next, a3, 1000, 1).project;
    expect(automationValueAt(moved.tracks.find((t) => t.id === a3)!.volumeAutomation, 500)).toBeCloseTo(0.6, 8);
    const loaded = deserializeProject(serializeProject(moved));
    expect(loaded.tracks.find((t) => t.id === a3)!.volumeAutomation?.points).toHaveLength(2);
  });
});

describe("volume automation undo / session", () => {
  it("create, delete, and completed move are one undo each", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyCommand(session, { type: "addVolumeAutomationPoint", trackId: "A1", timeMs: 0, value: 1 });
    session = applyCommand(session, { type: "addVolumeAutomationPoint", trackId: "A1", timeMs: 1000, value: 0.25 });
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points).toHaveLength(2);
    session = applyCommand(session, {
      type: "moveVolumeAutomationPoint",
      trackId: "A1",
      fromTimeMs: 1000,
      timeMs: 1500,
      value: 0.25,
    });
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points[1]?.timeMs).toBe(1500);
    session = applyCommand(session, { type: "undo" });
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points[1]?.timeMs).toBe(1000);
    session = applyCommand(session, { type: "deleteVolumeAutomationPoint", trackId: "A1", timeMs: 1000 });
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points).toHaveLength(1);
    session = applyCommand(session, { type: "undo" });
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points).toHaveLength(2);
    session = applyCommand(session, { type: "setVolumeAutomationEnabled", trackId: "A1", enabled: false });
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.enabled).toBe(false);
    session = applyCommand(session, { type: "undo" });
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.enabled).toBe(true);
  });

  it("Delete with a selected point removes the point, not a clip", () => {
    let session = createSession(createMemoryBlobStore());
    session.project = {
      ...session.project,
      assets: [asset({ id: "aa", kind: "audio", durationMs: 2000 })],
      clips: [clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 })],
    };
    session = applyCommand(session, { type: "addVolumeAutomationPoint", trackId: "A1", timeMs: 400, value: 0.5 });
    session = applyCommand(session, { type: "select", clipId: "c1" });
    session = applyCommand(session, { type: "selectVolumeAutomationPoint", trackId: "A1", timeMs: 400 });
    session = applyCommand(session, { type: "liftDelete" });
    expect(session.project.clips.map((c) => c.id)).toEqual(["c1"]);
    expect(session.project.tracks.find((t) => t.id === "A1")!.volumeAutomation?.points).toEqual([]);
  });
});

describe("volume automation export / move helpers", () => {
  it("job keeps static clip gain and attaches the remapped envelope", () => {
    let project = createEmptyProject();
    project = {
      ...project,
      assets: [asset({ id: "aa", kind: "audio", durationMs: 2000, objectUrl: "blob:t", missing: false })],
      clips: [clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 })],
      inPointMs: 0,
      outPointMs: 1000,
    };
    project = addVolumeAutomationPoint(project, "A1", 0, 1).project;
    project = addVolumeAutomationPoint(project, "A1", 1000, 0.5).project;
    const job = jobFromProject(project);
    const a1 = job.tracks.find((t) => t.id === "A1")!;
    expect(a1.clips[0]!.gain).toBeCloseTo(1, 8);
    expect(a1.volumeAutomation?.enabled).toBe(true);
    expect(a1.volumeAutomation?.points).toHaveLength(2);
  });

  it("delete / move no-op on unknown points", () => {
    const p = createEmptyProject();
    expect(deleteVolumeAutomationPoint(p, "A1", 99)).toBe(p);
    expect(moveVolumeAutomationPoint(p, "A1", 0, 10, 1).project).toBe(p);
  });
});
