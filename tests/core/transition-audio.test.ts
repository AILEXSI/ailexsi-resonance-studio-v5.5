import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import {
  contextFromProject,
  resolvePictureSource,
  transitionAudioGain,
  upsertTransition,
} from "../../src/core/transition";
import { asset, clip, projectWith } from "../helpers";

function stacked() {
  const project = projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 4000 }),
    ],
    [
      asset({ id: "va", kind: "video", durationMs: 4000 }),
      asset({ id: "vb", kind: "video", durationMs: 4000 }),
      asset({ id: "aa", kind: "audio", durationMs: 4000 }),
    ],
  );
  project.playheadMs = 1500;
  return project;
}

function sessionOf(project = stacked()): Session {
  return {
    ...createSession(createMemoryBlobStore()),
    project,
    selectedClipId: "v1",
    selectedClipIds: ["v1", "v2"],
  };
}

describe("independent transition audio", () => {
  it("default missing fields = today's mix", () => {
    const project = stacked();
    const { project: withTr } = upsertTransition(project, {
      sourceA: project.clips[0]!,
      sourceB: project.clips[1]!,
      overlapStartMs: 1000,
      overlapDurationMs: 1000,
    }, { type: "cut" });
    expect(withTr.transitions[0]?.audio).toBe("cut");
    expect(withTr.transitions[0]?.audioDurationMs).toBe(0);
    expect(transitionAudioGain(withTr.transitions, "v1", 1500, withTr)).toBe(1);
    expect(transitionAudioGain(withTr.transitions, "v2", 1500, withTr)).toBe(1);
    expect(transitionAudioGain(withTr.transitions, "a1", 1500, withTr)).toBe(1);
  });

  it("cut: leaving V-audio stops and entering starts at the video edit", () => {
    const start = sessionOf();
    const next = applyCommand(start, { type: "setTransitionAudio", audio: "cut" });
    expect(next.project.transitions[0]?.audio).toBe("cut");
    expect(next.project.transitions[0]?.audioDurationMs).toBeGreaterThan(0);
    const tr = next.project.transitions;
    const at = next.project.transitions[0]!.startMs;
    expect(transitionAudioGain(tr, "v1", at - 1, next.project)).toBe(1);
    expect(transitionAudioGain(tr, "v2", at - 1, next.project)).toBe(0);
    expect(transitionAudioGain(tr, "v1", at, next.project)).toBe(0);
    expect(transitionAudioGain(tr, "v2", at, next.project)).toBe(1);
    expect(transitionAudioGain(tr, "a1", at, next.project)).toBe(1);
  });

  it("crossfade uses audioDurationMs not video duration", () => {
    const start = sessionOf();
    const xf = applyCommand(
      applyCommand(start, { type: "setTransition", durationMs: 1000 }),
      { type: "setTransitionAudio", audio: "crossfade" },
    );
    const withDur = applyCommand(xf, { type: "setTransitionAudioDuration", audioDurationMs: 400 });
    expect(withDur.project.transitions[0]?.durationMs).toBe(1000);
    expect(withDur.project.transitions[0]?.audioDurationMs).toBe(400);
    const tr = withDur.project.transitions;
    const t0 = tr[0]!.startMs;
    const midAudio = t0 + 200;
    const midVideo = t0 + 500;
    expect(transitionAudioGain(tr, "v1", midAudio, withDur.project)).toBeCloseTo(Math.cos((0.5 * Math.PI) / 2));
    expect(transitionAudioGain(tr, "v2", midAudio, withDur.project)).toBeCloseTo(Math.sin((0.5 * Math.PI) / 2));
    expect(transitionAudioGain(tr, "v1", midVideo, withDur.project)).toBe(0);
    expect(transitionAudioGain(tr, "v2", midVideo, withDur.project)).toBe(1);
    expect(transitionAudioGain(tr, "a1", midAudio, withDur.project)).toBe(1);
  });

  it("keepA vs keepB in the video window", () => {
    const start = sessionOf();
    const keepA = applyCommand(start, { type: "setTransitionAudio", audio: "keepA" });
    expect(transitionAudioGain(keepA.project.transitions, "v1", 1500, keepA.project)).toBe(1);
    expect(transitionAudioGain(keepA.project.transitions, "v2", 1500, keepA.project)).toBe(0);
    expect(transitionAudioGain(keepA.project.transitions, "a1", 1500, keepA.project)).toBe(1);
    const keepB = applyCommand(start, { type: "setTransitionAudio", audio: "keepB" });
    expect(transitionAudioGain(keepB.project.transitions, "v1", 1500, keepB.project)).toBe(0);
    expect(transitionAudioGain(keepB.project.transitions, "v2", 1500, keepB.project)).toBe(1);
    expect(transitionAudioGain(keepB.project.transitions, "a1", 1500, keepB.project)).toBe(1);
  });

  it("setTransitionSource vis does not mute A1", () => {
    const project = stacked();
    project.visualizer = {
      ...project.visualizer,
      events: [{ id: "ve1", sceneId: "pulse-orb", startMs: 1000, durationMs: 800 }],
    };
    const vis = applyCommand(sessionOf(project), { type: "setTransitionSource", source: "vis" });
    expect(resolvePictureSource(contextFromProject(vis.project), 1500).kind).toBe("vis");
    expect(vis.project.transitions[0]?.audioDurationMs).toBe(0);
    expect(transitionAudioOfSafe(vis.project)).toBe("cut");
    expect(transitionAudioGain(vis.project.transitions, "a1", 1500, vis.project)).toBe(1);
    expect(transitionAudioGain(vis.project.transitions, "v1", 1500, vis.project)).toBe(1);
    expect(transitionAudioGain(vis.project.transitions, "v2", 1500, vis.project)).toBe(1);
  });

  it("undo/redo of setTransitionAudio", () => {
    const start = sessionOf();
    const set = applyCommand(start, { type: "setTransitionAudio", audio: "keepB" });
    expect(set.project.transitions[0]?.audio).toBe("keepB");
    expect(set.history.past.length).toBe(start.history.past.length + 1);
    const undone = applyCommand(set, { type: "undo" });
    expect(undone.project.transitions).toEqual(start.project.transitions);
    const redone = applyCommand(undone, { type: "redo" });
    expect(redone.project.transitions[0]?.audio).toBe("keepB");
  });

  it("persist reload of missing audio fields is today's mix", () => {
    const project = stacked();
    const { project: withTr } = upsertTransition(project, {
      sourceA: project.clips[0]!,
      sourceB: project.clips[1]!,
      overlapStartMs: 1000,
      overlapDurationMs: 1000,
    }, { type: "crossfade", durationMs: 800 });
    const raw = JSON.parse(serializeProject(withTr)) as { transitions: Array<Record<string, unknown>> };
    delete raw.transitions[0]!.audio;
    delete raw.transitions[0]!.audioMode;
    delete raw.transitions[0]!.audioDurationMs;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.transitions[0]?.audio).toBe("cut");
    expect(loaded.transitions[0]?.audioMode).toBe("cut");
    expect(loaded.transitions[0]?.audioDurationMs).toBe(0);
    expect(transitionAudioGain(loaded.transitions, "v1", 1400, loaded)).toBe(1);
    expect(transitionAudioGain(loaded.transitions, "v2", 1400, loaded)).toBe(1);
    expect(transitionAudioGain(loaded.transitions, "a1", 1400, loaded)).toBe(1);
  });
});

function transitionAudioOfSafe(project: { transitions: { audio?: string; audioMode?: string }[] }) {
  return project.transitions[0]?.audio ?? project.transitions[0]?.audioMode ?? "cut";
}
