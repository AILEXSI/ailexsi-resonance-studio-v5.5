import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { collectEditPoints } from "../../src/core/timeline";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function editFixture(overrides: { abut?: boolean; empty?: boolean } = {}): Session {
  if (overrides.empty) {
    return createSession(createMemoryBlobStore());
  }
  const va = asset({ id: "va", kind: "video", durationMs: 8000 });
  const first = clip({
    id: "c1",
    assetId: "va",
    trackId: "V1",
    startMs: 0,
    durationMs: 1000,
  });
  const second = clip({
    id: "c2",
    assetId: "va",
    trackId: "V1",
    startMs: overrides.abut ? 1000 : 3000,
    durationMs: overrides.abut ? 1000 : 1500,
  });
  const mate = clip({
    id: "a1",
    assetId: "aa",
    trackId: "A1",
    startMs: 0,
    durationMs: 1000,
    linkId: "pair-1",
  });
  const video = { ...first, linkId: "pair-1" };
  const aa = asset({ id: "aa", kind: "audio", durationMs: 8000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: {
      ...projectWith(overrides.abut ? [first, second] : [video, second, mate], overrides.abut ? [va] : [va, aa]),
      playheadMs: 0,
      inPointMs: null,
      outPointMs: overrides.abut ? null : 4500,
      markers: overrides.abut ? [] : [{ id: "m1", timeMs: 2000, label: "M1" }],
    },
  };
}

function walkNext(start: Session): number[] {
  const seen: number[] = [];
  let s = start;
  for (let i = 0; i < 16; i++) {
    const next = applyCommand(s, { type: "gotoNextEdit" });
    if (next.project.playheadMs === s.project.playheadMs) break;
    seen.push(next.project.playheadMs);
    s = next;
  }
  return seen;
}

function walkPrev(start: Session): number[] {
  const seen: number[] = [];
  let s = start;
  for (let i = 0; i < 16; i++) {
    const next = applyCommand(s, { type: "gotoPrevEdit" });
    if (next.project.playheadMs === s.project.playheadMs) break;
    seen.push(next.project.playheadMs);
    s = next;
  }
  return seen;
}

describe("goto next/prev edit", () => {
  it("from 0 visits clip-out, marker, next clip-in, OUT; prev is the reverse", () => {
    const start = editFixture();
    expect(start.project.inPointMs).toBeNull();
    expect(walkNext(start)).toEqual([1000, 2000, 3000, 4500]);
    const atEnd = applyCommand(
      { ...start, project: { ...start.project, playheadMs: 4500 } },
      { type: "gotoNextEdit" },
    );
    expect(atEnd.project.playheadMs).toBe(4500);
    expect(walkPrev({ ...start, project: { ...start.project, playheadMs: 4500 } })).toEqual([
      3000, 2000, 1000, 0,
    ]);
  });

  it("collapses duplicate times (clip out == next clip in) to one stop", () => {
    const start = editFixture({ abut: true });
    expect(collectEditPoints(start.project)).toEqual([0, 1000, 2000]);
    expect(walkNext(start)).toEqual([1000, 2000]);
  });

  it("empty project is a no-op both ways and adds no history", () => {
    const start = editFixture({ empty: true });
    const past = start.history.past.length;
    const next = applyCommand(start, { type: "gotoNextEdit" });
    const prev = applyCommand(start, { type: "gotoPrevEdit" });
    expect(next).toBe(start);
    expect(prev).toBe(start);
    expect(next.project.playheadMs).toBe(0);
    expect(prev.project.playheadMs).toBe(0);
    expect(next.history.past.length).toBe(past);
    expect(prev.history.past.length).toBe(past);
  });

  it("no-op in a direction does not add a history entry", () => {
    const start = editFixture();
    const atEnd = { ...start, project: { ...start.project, playheadMs: 4500 } };
    const past = atEnd.history.past.length;
    const next = applyCommand(atEnd, { type: "gotoNextEdit" });
    expect(next).toBe(atEnd);
    expect(next.history.past.length).toBe(past);
    const atStart = applyCommand(start, { type: "gotoPrevEdit" });
    expect(atStart).toBe(start);
    expect(atStart.history.past.length).toBe(start.history.past.length);
  });

  it("jumps while playing without pausing", () => {
    const start: Session = { ...editFixture(), playing: true, shuttleRate: 1 };
    const next = applyCommand(start, { type: "gotoNextEdit" });
    expect(next.project.playheadMs).toBe(1000);
    expect(next.playing).toBe(true);
    expect(next.shuttleRate).toBe(1);
    expect(next.project.inPointMs).toBeNull();
    expect(next.project.outPointMs).toBe(4500);
  });

  it("ArrowUp/Down skip disabled clip edges (P104)", () => {
    const start = editFixture({ abut: true });
    const disabled = {
      ...start,
      project: {
        ...start.project,
        clips: start.project.clips.map((c) => (c.id === "c2" ? { ...c, enabled: false } : c)),
      },
    };
    expect(collectEditPoints(disabled.project)).toEqual([0, 1000]);
    expect(walkNext(disabled)).toEqual([1000]);
    expect(walkNext(start)).toEqual([1000, 2000]);
  });

  it("includes a finite VIS overlay window and dedupes linked A/V times", () => {
    const start = editFixture();
    const withVis = {
      ...start,
      project: {
        ...start.project,
        visualizer: { ...start.project.visualizer, startMs: 500, durationMs: 2500 },
      },
    };
    expect(walkNext(withVis)).toEqual([500, 1000, 2000, 3000, 4500]);
  });

  it("CutStrip/Arrow path visits VIS events and fadeBlack window ends (P55)", () => {
    const start = editFixture();
    const withCuts = {
      ...start,
      project: {
        ...start.project,
        visualizer: {
          ...start.project.visualizer,
          events: [
            {
              id: "e1",
              sceneId: start.project.visualizer.sceneId,
              startMs: 400,
              durationMs: 800,
            },
          ],
        },
        transitions: [
          {
            id: "t1",
            type: "fadeBlack" as const,
            startMs: 3000,
            durationMs: 600,
            sourceAClipId: "c1",
            sourceBClipId: "c2",
            audio: "cut" as const,
            audioMode: "cut" as const,
            audioDurationMs: 250,
          },
        ],
      },
    };
    expect(collectEditPoints(withCuts.project)).toEqual([
      0, 400, 1000, 1200, 2000, 3000, 3250, 3600, 4500,
    ]);
    expect(walkNext(withCuts)).toEqual([400, 1000, 1200, 2000, 3000, 3250, 3600, 4500]);
  });
});
