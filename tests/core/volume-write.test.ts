import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applyCommitVolumeWrite,
  applyMixerVolume,
  applyPlayhead,
  applyToggleVolumeWriteArm,
  applyVolumeWriteSample,
  createSession,
  openSerialized,
  volumeWriteCanCapture,
} from "../../src/app/session";
import { addAudioTrack } from "../../src/core/audio-tracks";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject, deserializeProject, serializeProject } from "../../src/core/project";
import { assignTracksToGroup, createTrackGroup } from "../../src/core/track-groups";
import { dbToLinear } from "../../src/core/volume";
import {
  addVolumeAutomationPoint,
  automationValueAt,
  volumeAutomationOf,
} from "../../src/core/volume-automation";
import {
  coalesceWriteSamples,
  isMeaningfulWriteMove,
  punchVolumeWrite,
  simplifyWriteSamples,
  WRITE_IDENTITY_HOLD_MS,
  WRITE_MEANINGFUL_DB,
} from "../../src/core/volume-write";
import { asset, clip } from "../helpers";

function armedPlaying(trackId = "A1") {
  let session = createSession(createMemoryBlobStore());
  session = applyToggleVolumeWriteArm(session, trackId);
  session = applyCommand(session, { type: "play" });
  return session;
}

function writeMoves(
  session: ReturnType<typeof createSession>,
  trackId: string,
  moves: Array<{ timeMs: number; value: number }>,
) {
  let next = session;
  for (const move of moves) {
    next = { ...next, project: { ...next.project, playheadMs: move.timeMs } };
    next = applyVolumeWriteSample(next, trackId, move.timeMs, move.value, 1_000 + move.timeMs);
  }
  return next;
}

describe("H write arm / no accidental points", () => {
  it("1 W off: fader writes static only", () => {
    let session = createSession(createMemoryBlobStore());
    const staticVol = dbToLinear(-6);
    session = applyMixerVolume(session, "A1", staticVol);
    const track = session.project.tracks.find((t) => t.id === "A1")!;
    expect(track.volume).toBeCloseTo(staticVol, 5);
    expect(volumeAutomationOf(track).points).toEqual([]);
  });

  it("2 W on + no play: fader still static, no write", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyToggleVolumeWriteArm(session, "A1");
    expect(session.volumeWriteArmedIds).toEqual(["A1"]);
    expect(volumeWriteCanCapture(session, "A1")).toBe(false);
    session = applyMixerVolume(session, "A1", dbToLinear(-3));
    const track = session.project.tracks.find((t) => t.id === "A1")!;
    expect(track.volume).toBeCloseTo(dbToLinear(-3), 5);
    expect(volumeAutomationOf(track).points).toEqual([]);
  });

  it("3 play + W + no move: no points", () => {
    let session = armedPlaying();
    session = applyPlayhead(session, 400, "transport");
    session = applyPlayhead(session, 800, "transport");
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual([]);
    expect(session.volumeWriteGesture).toBeNull();
  });

  it("enabling W / selecting the track / playback alone do not write", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyCommand(session, { type: "select", clipId: null });
    session = applyToggleVolumeWriteArm(session, "A1");
    session = applyCommand(session, { type: "play" });
    session = applyPlayhead(session, 1200, "transport");
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual([]);
  });
});

describe("H write into G", () => {
  it("4–6 play + W + move writes G { enabled, points: [{ timeMs, value }] } at project time", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 200, value: 0.5 },
      { timeMs: 400, value: 0.35 },
      { timeMs: 600, value: 0.2 },
    ]);
    session = applyCommitVolumeWrite(session);
    const env = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1"));
    expect(env.enabled).toBe(true);
    expect(env.points.length).toBeGreaterThanOrEqual(2);
    expect(env.points.every((p) => p.timeMs >= 0 && Number.isFinite(p.value))).toBe(true);
    expect(env.points[0]!.timeMs).toBe(0);
    expect(env.points.some((p) => p.timeMs === 200 || p.timeMs === 600)).toBe(true);
    expect(automationValueAt(env, 600)).toBeCloseTo(0.2, 5);
    expect(automationValueAt(env, 1200)).toBeCloseTo(1, 5);
    expect(session.project.tracks.find((t) => t.id === "A1")!.volume).toBe(1);
  });

  it("20 static stays separate from written automation", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyMixerVolume(session, "A1", dbToLinear(2.3));
    const staticVol = session.project.tracks.find((t) => t.id === "A1")!.volume;
    session = applyToggleVolumeWriteArm(session, "A1");
    session = applyCommand(session, { type: "play" });
    session = writeMoves(session, "A1", [
      { timeMs: 0, value: 0.4 },
      { timeMs: 250, value: 0.25 },
    ]);
    session = applyCommitVolumeWrite(session);
    expect(session.project.tracks.find((t) => t.id === "A1")!.volume).toBeCloseTo(staticVol, 8);
    const env = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1"));
    expect(env.enabled).toBe(true);
    expect(env.points.some((p) => p.value <= 0.4 + 1e-6)).toBe(true);
  });
});

describe("H punch / preserve / transport", () => {
  it("7–8 punch replaces only the write region and keeps before/after", () => {
    let project = addVolumeAutomationPoint(createEmptyProject(), "A1", 0, 1).project;
    project = addVolumeAutomationPoint(project, "A1", 1000, 0.5).project;
    project = addVolumeAutomationPoint(project, "A1", 2000, 1).project;
    project = addVolumeAutomationPoint(project, "A1", 3000, 0.25).project;
    const punched = punchVolumeWrite(project.tracks.find((t) => t.id === "A1")!.volumeAutomation, [
      { timeMs: 1200, value: 0.1 },
      { timeMs: 1400, value: 0.12 },
      { timeMs: 1600, value: 0.08 },
    ]);
    expect(punched.points.some((p) => p.timeMs === 0 && p.value === 1)).toBe(true);
    expect(punched.points.some((p) => p.timeMs === 1000)).toBe(true);
    expect(punched.points.some((p) => p.timeMs === 2000)).toBe(true);
    expect(punched.points.some((p) => p.timeMs === 3000 && p.value === 0.25)).toBe(true);
    expect(punched.points.filter((p) => p.timeMs > 1000 && p.timeMs < 2000 && p.timeMs <= 1600).every((p) => p.value <= 0.12 + 1e-9)).toBe(
      true,
    );
    expect(automationValueAt(punched, 2500)).toBeCloseTo(0.625, 2);
    expect(punched.points).toHaveLength(punched.points.filter((p, i, all) => all.findIndex((q) => q.timeMs === p.timeMs) === i).length);
  });

  it("9 STOP commits the gesture and leaves written points", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 100, value: 0.4 },
      { timeMs: 300, value: 0.2 },
    ]);
    expect(session.volumeWriteGesture).not.toBeNull();
    session = applyCommand(session, { type: "stop" });
    expect(session.playing).toBe(false);
    expect(session.volumeWriteGesture).toBeNull();
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.length).toBeGreaterThan(0);
  });

  it("10 PAUSE commits and does not write while time is stationary", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 100, value: 0.45 },
      { timeMs: 200, value: 0.3 },
    ]);
    session = applyCommand(session, { type: "pause" });
    expect(session.playing).toBe(false);
    expect(session.volumeWriteGesture).toBeNull();
    const afterPause = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.length;
    session = applyMixerVolume(session, "A1", 0.1);
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toHaveLength(afterPause);
    expect(session.project.tracks.find((t) => t.id === "A1")!.volume).toBeCloseTo(0.1, 5);
  });

  it("11 SEEK alone does not invent a point at the seek destination", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 200, value: 0.4 },
      { timeMs: 400, value: 0.2 },
    ]);
    session = applyPlayhead(session, 5000, "seek");
    expect(session.volumeWriteGesture).toBeNull();
    const times = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.map((p) => p.timeMs);
    expect(times).not.toContain(5000);
    expect(times.some((t) => t === 200 || t === 400)).toBe(true);
  });

  it("12 loop wrap follows project time — no hidden monotonic clock", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 800, value: 0.6 },
      { timeMs: 900, value: 0.5 },
    ]);
    session = applyPlayhead(session, 80, "transport");
    session = applyVolumeWriteSample(session, "A1", 80, 0.25, 50_000);
    session = applyVolumeWriteSample(session, "A1", 160, 0.2, 50_080);
    session = applyCommitVolumeWrite(session);
    const times = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.map((p) => p.timeMs);
    expect(times.some((t) => t >= 800)).toBe(true);
    expect(times.some((t) => t <= 160)).toBe(true);
    const lateToEarly = times.slice(1).filter((cur, i) => cur < times[i]!);
    expect(lateToEarly).toEqual([]);
  });
});

describe("H density / undo / persist", () => {
  it("13–14 coalesces duplicate timestamps and simplifies dense captures", () => {
    const dense: { timeMs: number; value: number }[] = [];
    for (let i = 0; i <= 200; i += 1) {
      dense.push({ timeMs: i * 10, value: 0.8 - i * 0.002 });
    }
    dense.push({ timeMs: 1000, value: 0.8 });
    dense.push({ timeMs: 1000, value: 0.15 });
    const unique = coalesceWriteSamples(dense);
    expect(unique.filter((p) => p.timeMs === 1000)).toHaveLength(1);
    expect(unique.find((p) => p.timeMs === 1000)?.value).toBeCloseTo(0.15, 8);
    const simple = simplifyWriteSamples(dense);
    expect(simple.length).toBeLessThan(40);
    expect(simple.length).toBeGreaterThanOrEqual(2);
    expect(simple[0]?.timeMs).toBe(0);
    expect(simple.some((p) => p.value <= 0.16)).toBe(true);
    const times = simple.map((p) => p.timeMs);
    expect(new Set(times).size).toBe(times.length);
  });

  it("meaningful-move threshold ignores tiny rest jitter", () => {
    expect(isMeaningfulWriteMove(1, 1)).toBe(false);
    expect(isMeaningfulWriteMove(1, dbToLinear(-WRITE_MEANINGFUL_DB * 0.2))).toBe(false);
    expect(isMeaningfulWriteMove(1, 0.5)).toBe(true);
  });

  it("15 one completed gesture is one undo / redo", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 0, value: 0.7 },
      { timeMs: 120, value: 0.4 },
      { timeMs: 240, value: 0.2 },
    ]);
    session = applyCommitVolumeWrite(session);
    const written = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.length;
    expect(written).toBeGreaterThan(0);
    session = applyCommand(session, { type: "undo" });
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual([]);
    session = applyCommand(session, { type: "redo" });
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toHaveLength(written);
  });

  it("16–17 written G data survives save/load; W defaults OFF on reopen", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 0, value: 0.9 },
      { timeMs: 500, value: 0.3 },
    ]);
    session = applyCommitVolumeWrite(session);
    expect(session.volumeWriteArmedIds).toEqual(["A1"]);
    const text = serializeProject(session.project);
    const reopened = openSerialized(createSession(createMemoryBlobStore()), text);
    expect(reopened.volumeWriteArmedIds).toEqual([]);
    expect(reopened.volumeWriteGesture).toBeNull();
    const env = volumeAutomationOf(reopened.project.tracks.find((t) => t.id === "A1"));
    expect(env.enabled).toBe(true);
    expect(env.points.length).toBeGreaterThanOrEqual(2);
    expect(deserializeProject(text).schemaVersion).toBe(5);
  });
});

describe("H tracks / chapters / G still works / regression", () => {
  it("18 write works on a dynamic track beyond A1/A2", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyCommand(session, { type: "addAudioTrack" });
    const a3 = session.targetTrackId;
    session = applyToggleVolumeWriteArm(session, a3);
    session = applyCommand(session, { type: "play" });
    session = writeMoves(session, a3, [
      { timeMs: 0, value: 0.5 },
      { timeMs: 300, value: 0.2 },
    ]);
    session = applyCommitVolumeWrite(session);
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === a3)).enabled).toBe(true);
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual([]);
  });

  it("19 chapter collapse does not change written playback values", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 0, value: 0.4 },
      { timeMs: 200, value: 0.4 },
    ]);
    session = applyCommitVolumeWrite(session);
    const before = automationValueAt(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")), 100);
    const grouped = createTrackGroup(session.project, { name: "Chapter I", trackIds: ["A1", "A2"] });
    const assigned = assignTracksToGroup(grouped.project, ["A1"], grouped.group!.id);
    const after = automationValueAt(volumeAutomationOf(assigned.tracks.find((t) => t.id === "A1")), 100);
    expect(after).toBeCloseTo(before, 8);
  });

  it("21 manual G point edit still works after a write", () => {
    let session = armedPlaying();
    session = writeMoves(session, "A1", [
      { timeMs: 0, value: 0.8 },
      { timeMs: 400, value: 0.4 },
    ]);
    session = applyCommitVolumeWrite(session);
    session = applyCommand(session, { type: "addVolumeAutomationPoint", trackId: "A1", timeMs: 800, value: 0.15 });
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.some((p) => p.timeMs === 800)).toBe(
      true,
    );
  });

  it("22–25 D/E/F/G still compose: add track, groups, G model, identity seed", () => {
    const added = addAudioTrack(createEmptyProject());
    expect(added.track).toBeTruthy();
    const seeded = punchVolumeWrite(undefined, [
      { timeMs: 2000, value: 0.3 },
      { timeMs: 2200, value: 0.25 },
    ]);
    expect(seeded.points[0]).toEqual({ timeMs: 0, value: 1 });
    expect(seeded.points.some((p) => p.timeMs === 2000 - WRITE_IDENTITY_HOLD_MS && p.value === 1)).toBe(true);
    expect(automationValueAt(seeded, 100)).toBeCloseTo(1, 8);
    expect(automationValueAt(seeded, 2100)).toBeCloseTo(0.275, 5);
    expect(automationValueAt(seeded, 4000)).toBeCloseTo(1, 8);

    let session = createSession(createMemoryBlobStore());
    session.project = {
      ...session.project,
      assets: [asset({ id: "aa", kind: "audio", durationMs: 2000 })],
      clips: [clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 })],
    };
    session = applyCommand(session, { type: "addVolumeAutomationPoint", trackId: "A1", timeMs: 0, value: 0.5 });
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points[0]?.value).toBeCloseTo(0.5, 8);
    session = applyCommand(session, { type: "createTrackGroup", name: "Ch", trackIds: ["A1"] });
    expect(session.project.groups?.length).toBeGreaterThan(0);
  });

  it("punch does not hold written gain across the rest of the track", () => {
    const punched = punchVolumeWrite(undefined, [
      { timeMs: 2000, value: 0 },
      { timeMs: 2300, value: 0 },
    ]);
    expect(automationValueAt(punched, 500)).toBeCloseTo(1, 8);
    expect(automationValueAt(punched, 2000)).toBeCloseTo(0, 8);
    expect(automationValueAt(punched, 5000)).toBeCloseTo(1, 8);
  });

  it("W ON without a fader move does not mute, truncate clips, or write", () => {
    let session = createSession(createMemoryBlobStore());
    session.project = {
      ...session.project,
      assets: [asset({ id: "aa", kind: "audio", durationMs: 8000 })],
      clips: [clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 8000 })],
    };
    session = applyToggleVolumeWriteArm(session, "A1");
    session = applyCommand(session, { type: "play" });
    session = applyPlayhead(session, 1500, "transport");
    expect(session.project.clips[0]?.durationMs).toBe(8000);
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual([]);
    expect(session.project.tracks.find((t) => t.id === "A1")!.volume).toBe(1);
    expect(session.project.tracks.find((t) => t.id === "A1")!.name).not.toBe("W");
  });

  it("invalid samples do not erase an existing envelope", () => {
    const existing = {
      enabled: true,
      points: [
        { timeMs: 0, value: 1 },
        { timeMs: 1000, value: 0.5 },
      ],
    };
    const same = punchVolumeWrite(existing, [
      { timeMs: Number.NaN, value: 0.1 },
      { timeMs: 100, value: Number.POSITIVE_INFINITY },
      { timeMs: -20, value: Number.NaN },
    ]);
    expect(same.points).toEqual(existing.points);
    expect(same.enabled).toBe(true);
  });
});
