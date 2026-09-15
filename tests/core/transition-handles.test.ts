import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { durationMsFromHandleDrag } from "../../src/core/transition-handles";
import { upsertTransition } from "../../src/core/transition";
import { asset, clip, projectWith } from "../helpers";

function stacked() {
  const project = projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
    ],
    [
      asset({ id: "va", kind: "video", durationMs: 4000 }),
      asset({ id: "vb", kind: "video", durationMs: 4000 }),
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

describe("durationMsFromHandleDrag", () => {
  it("maps +8px at 80 px/s to +100ms without snap", () => {
    expect(
      durationMsFromHandleDrag({
        originDurationMs: 400,
        startMs: 1000,
        deltaPx: 8,
        zoomPxPerSec: 80,
        snap: false,
      }),
    ).toBe(500);
  });

  it("clamps at 0", () => {
    expect(
      durationMsFromHandleDrag({
        originDurationMs: 50,
        startMs: 1000,
        deltaPx: -80,
        zoomPxPerSec: 80,
        snap: false,
      }),
    ).toBe(0);
  });

  it("snaps the window end when snap is on", () => {
    const snapped = durationMsFromHandleDrag({
      originDurationMs: 400,
      startMs: 1000,
      deltaPx: 7,
      zoomPxPerSec: 80,
      snap: true,
      snapTargets: [{ timeMs: 1500, kind: "clip-end" }],
    });
    expect(snapped).toBe(500);
    const raw = durationMsFromHandleDrag({
      originDurationMs: 400,
      startMs: 1000,
      deltaPx: 7,
      zoomPxPerSec: 80,
      snap: false,
    });
    expect(raw).toBe(488);
  });
});

describe("transition duration commands (same as Inspector)", () => {
  it("setTransition durationMs matches Inspector field and does not mutate audioDurationMs", () => {
    const start = applyCommand(sessionOf(), { type: "setTransitionAudioDuration", audioDurationMs: 250 });
    expect(start.project.transitions[0]?.audioDurationMs).toBe(250);
    const next = applyCommand(start, { type: "setTransition", durationMs: 400 });
    expect(next.project.transitions[0]?.durationMs).toBe(400);
    expect(next.project.transitions[0]?.audioDurationMs).toBe(250);
  });

  it("setTransitionAudioDuration matches Inspector audioDurationMs and does not mutate durationMs", () => {
    const start = applyCommand(sessionOf(), { type: "setTransition", durationMs: 800 });
    const next = applyCommand(start, { type: "setTransitionAudioDuration", audioDurationMs: 120 });
    expect(next.project.transitions[0]?.durationMs).toBe(800);
    expect(next.project.transitions[0]?.audioDurationMs).toBe(120);
  });

  it("undo restores video duration without touching the other field's later value", () => {
    const start = sessionOf();
    const video = applyCommand(start, { type: "setTransition", durationMs: 400 });
    const audio = applyCommand(video, { type: "setTransitionAudioDuration", audioDurationMs: 90 });
    const undoneAudio = applyCommand(audio, { type: "undo" });
    expect(undoneAudio.project.transitions[0]?.durationMs).toBe(400);
    expect(undoneAudio.project.transitions[0]?.audioDurationMs).toBe(0);
    const undoneVideo = applyCommand(undoneAudio, { type: "undo" });
    expect(undoneVideo.project.transitions).toEqual(start.project.transitions);
  });

  it("persists 0 and nonzero video / audio durations", () => {
    const project = stacked();
    const { project: withTr } = upsertTransition(
      project,
      {
        sourceA: project.clips[0]!,
        sourceB: project.clips[1]!,
        overlapStartMs: 1000,
        overlapDurationMs: 1000,
      },
      { type: "cut", durationMs: 0, audioDurationMs: 333 },
    );
    expect(withTr.transitions[0]?.durationMs).toBe(0);
    const loaded = deserializeProject(serializeProject(withTr));
    expect(loaded.transitions[0]?.durationMs).toBe(0);
    expect(loaded.transitions[0]?.audioDurationMs).toBe(333);
    const viaCmd = applyCommand(sessionOf(), { type: "setTransition", durationMs: 0 });
    expect(viaCmd.project.transitions[0]?.durationMs).toBe(0);
    const reloaded = deserializeProject(serializeProject(viaCmd.project));
    expect(reloaded.transitions[0]?.durationMs).toBe(0);
  });
});
