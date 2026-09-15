import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { jobFromProject } from "../../src/core/exporter/job";
import { exportComposite } from "../../src/core/exporter/webcodecs";
import {
  compositeVideoAt,
  contextFromProject,
  listStackedEditPairs,
  resolveEditPair,
  resolvePictureSource,
  transitionAudioGain,
  editPairAt,
  editPairAtProbe,
  upsertTransition,
} from "../../src/core/transition";
import { previewComposite } from "../../src/ui/preview/Preview";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function stackedV1OverV2() {
  return projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000, fadeInMs: 120 }),
      clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
    ],
    [
      asset({ id: "va", kind: "video", name: "Outgoing", durationMs: 4000 }),
      asset({ id: "vb", kind: "video", name: "Incoming", durationMs: 4000 }),
    ],
  );
}

function stackedV2EndsFirst() {
  return projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 3000 }),
      clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 500, durationMs: 1000 }),
    ],
    [
      asset({ id: "va", kind: "video", name: "Stay", durationMs: 4000 }),
      asset({ id: "vb", kind: "video", name: "Leave", durationMs: 4000 }),
    ],
  );
}

function sessionOf(project = stackedV1OverV2(), selected: string[] = ["v1"]): Session {
  return {
    ...createSession(createMemoryBlobStore()),
    project,
    selectedClipId: selected[0] ?? null,
    selectedClipIds: selected,
  };
}

describe("edit pair resolve", () => {
  it("V1→V2 and V2↑V1 resolve to the same outgoing/incoming pair", () => {
    const project = stackedV1OverV2();
    const fromV1 = resolveEditPair(project, ["v1"]);
    const fromV2 = resolveEditPair(project, ["v2"]);
    expect(fromV1?.sourceA.id).toBe("v1");
    expect(fromV1?.sourceB.id).toBe("v2");
    expect(fromV2?.sourceA.id).toBe("v1");
    expect(fromV2?.sourceB.id).toBe("v2");
    expect(fromV1?.overlapStartMs).toBe(1000);
    expect(fromV1?.overlapDurationMs).toBe(1000);
  });

  it("resolves V2↑V1 when V2 ends first", () => {
    const pair = resolveEditPair(stackedV2EndsFirst(), ["v1"]);
    expect(pair?.sourceA.id).toBe("v2");
    expect(pair?.sourceB.id).toBe("v1");
  });

  it("lists stacked overlaps; implicit type is cut", () => {
    const marks = listStackedEditPairs(stackedV1OverV2());
    expect(marks).toHaveLength(1);
    expect(marks[0]?.type).toBe("cut");
    expect(marks[0]?.sourceA.id).toBe("v1");
    expect(marks[0]?.sourceB.id).toBe("v2");
    const flipped = listStackedEditPairs(stackedV2EndsFirst());
    expect(flipped[0]?.sourceA.id).toBe("v2");
    expect(flipped[0]?.sourceB.id).toBe("v1");
    expect(flipped[0]?.type).toBe("cut");
  });

  it("probe at exclusive overlap end still resolves the pair (P95)", () => {
    const project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1001 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 1000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    expect(editPairAt(project, 1001)).toBeUndefined();
    expect(editPairAtProbe(project, 1001)?.sourceA.id).toBe("v1");
    expect(editPairAtProbe(project, 1001)?.sourceB.id).toBe("v2");
    expect(editPairAtProbe(project, 1000)?.overlapStartMs).toBe(1000);
  });

  it("returns no pair without a stacked video overlap", () => {
    const project = projectWith(
      [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 500 })],
      [asset({ id: "va", kind: "video", durationMs: 500 })],
    );
    expect(resolveEditPair(project, ["v1"])).toBeUndefined();
  });
});

describe("compositeVideoAt", () => {
  function ctxWithType(type: "cut" | "crossfade" | "fadeBlack" | "fadeWhite") {
    const project = stackedV1OverV2();
    const { project: next } = upsertTransition(project, resolveEditPair(project, ["v1"])!, {
      type,
      durationMs: 1000,
      startMs: 1000,
    });
    return contextFromProject(next);
  }

  it("composites all four types at t in the window", () => {
    const mid = 1500;
    expect(compositeVideoAt(ctxWithType("cut"), mid)).toEqual({
      layers: [{ clipId: "v2", alpha: 1 }],
    });
    expect(compositeVideoAt(ctxWithType("crossfade"), mid)).toEqual({
      layers: [
        { clipId: "v1", alpha: 0.5 },
        { clipId: "v2", alpha: 0.5 },
      ],
    });
    const black = compositeVideoAt(ctxWithType("fadeBlack"), mid);
    expect(black.layers).toEqual([{ clipId: "v2", alpha: 0 }]);
    expect(black.plate).toEqual({ color: "#000000", alpha: 1 });
    const white = compositeVideoAt(ctxWithType("fadeWhite"), 1250);
    expect(white.layers[0]?.clipId).toBe("v1");
    expect(white.layers[0]?.alpha).toBeCloseTo(0.5);
    expect(white.plate).toEqual({ color: "#ffffff", alpha: 0.5 });
  });

  it("outside the window uses later-track stack order", () => {
    const ctx = ctxWithType("crossfade");
    expect(compositeVideoAt(ctx, 500).layers).toEqual([{ clipId: "v1", alpha: 1 }]);
    expect(compositeVideoAt(ctx, 2500).layers).toEqual([{ clipId: "v2", alpha: 1 }]);
  });

  it("V2-front overlap still shows V2; setFront V1 shows V1", () => {
    const project = stackedV1OverV2();
    const mid = 1500;
    expect(project.frontVideoTrackId).toBe("V2");
    expect(compositeVideoAt(contextFromProject(project), mid).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
    expect(previewComposite(contextFromProject(project), mid).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
    const frontV1 = { ...project, frontVideoTrackId: "V1" as const };
    expect(compositeVideoAt(contextFromProject(frontV1), mid).layers).toEqual([
      { clipId: "v1", alpha: 1 },
    ]);
  });

  it("cut uses the covering clip on the front track", () => {
    const project = stackedV1OverV2();
    const { project: cut } = upsertTransition(project, resolveEditPair(project, ["v1"])!, {
      type: "cut",
      durationMs: 1000,
      startMs: 1000,
    });
    expect(compositeVideoAt(contextFromProject(cut), 1500).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
    const cutV1 = { ...cut, frontVideoTrackId: "V1" as const };
    expect(compositeVideoAt(contextFromProject(cutV1), 1500).layers).toEqual([
      { clipId: "v1", alpha: 1 },
    ]);
  });

  it("crossfade A→B math is unchanged by front track", () => {
    const project = stackedV1OverV2();
    const { project: xf } = upsertTransition(project, resolveEditPair(project, ["v1"])!, {
      type: "crossfade",
      durationMs: 1000,
      startMs: 1000,
    });
    const expected = {
      layers: [
        { clipId: "v1", alpha: 0.5 },
        { clipId: "v2", alpha: 0.5 },
      ],
    };
    expect(compositeVideoAt(contextFromProject(xf), 1500)).toEqual(expected);
    expect(compositeVideoAt(contextFromProject({ ...xf, frontVideoTrackId: "V1" }), 1500)).toEqual(
      expected,
    );
  });
});

describe("setFrontVideoTrack command", () => {
  it("header click command sets front and is history-worthy", () => {
    const start = sessionOf();
    expect(start.project.frontVideoTrackId).toBe("V2");
    const same = applyCommand(start, { type: "setFrontVideoTrack", trackId: "V2" });
    expect(same).toBe(start);
    const next = applyCommand(start, { type: "setFrontVideoTrack", trackId: "V1" });
    expect(next.project.frontVideoTrackId).toBe("V1");
    expect(next.status).toBe("Front V1");
    expect(next.history.past.length).toBe(start.history.past.length + 1);
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.frontVideoTrackId).toBe("V2");
  });
});

describe("disabled clips are not edit pairs (P106)", () => {
  it("listStackedEditPairs and editPairAt skip a disabled overlap mate", () => {
    const project = stackedV1OverV2();
    expect(listStackedEditPairs(project)).toHaveLength(1);
    expect(editPairAt(project, 1500)?.sourceA.id).toBe("v1");
    const off = {
      ...project,
      clips: project.clips.map((c) => (c.id === "v1" ? { ...c, enabled: false } : c)),
    };
    expect(listStackedEditPairs(off)).toEqual([]);
    expect(editPairAt(off, 1500)).toBeUndefined();
    expect(resolveEditPair(off, ["v1", "v2"])).toBeUndefined();
    expect(resolvePictureSource(contextFromProject(off), 1500)).toMatchObject({
      kind: "V2",
      clipId: "v2",
    });
  });

  it("stored transition is ignored when a pair clip is disabled (P107)", () => {
    const project = stackedV1OverV2();
    const { project: withTr } = upsertTransition(project, resolveEditPair(project, ["v1"])!, {
      type: "crossfade",
      durationMs: 1000,
      startMs: 1000,
    });
    expect(compositeVideoAt(contextFromProject(withTr), 1500).layers).toEqual([
      { clipId: "v1", alpha: 0.5 },
      { clipId: "v2", alpha: 0.5 },
    ]);
    const off = {
      ...withTr,
      clips: withTr.clips.map((c) => (c.id === "v1" ? { ...c, enabled: false } : c)),
    };
    expect(compositeVideoAt(contextFromProject(off), 1500).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
    expect(resolvePictureSource(contextFromProject(off), 1500)).toMatchObject({
      kind: "V2",
      clipId: "v2",
    });
  });
});

describe("orphan transition audio and export job (P108)", () => {
  it("preview mix and export job drop a transition whose mate is disabled", () => {
    const project = stackedV1OverV2();
    const { project: withTr } = upsertTransition(project, resolveEditPair(project, ["v1"])!, {
      type: "crossfade",
      audioMode: "crossfade",
      audioDurationMs: 1000,
      durationMs: 1000,
      startMs: 1000,
    });
    expect(transitionAudioGain(withTr.transitions, "v2", 1500, withTr)).toBeCloseTo(
      Math.sin((0.5 * Math.PI) / 2),
    );
    const off = {
      ...withTr,
      clips: withTr.clips.map((c) => (c.id === "v1" ? { ...c, enabled: false } : c)),
    };
    expect(transitionAudioGain(off.transitions, "v2", 1500, off)).toBe(1);
    const assets = [
      asset({ id: "va", kind: "video", durationMs: 4000, objectUrl: "blob:v", missing: false }),
      asset({ id: "vb", kind: "video", durationMs: 4000, objectUrl: "blob:v2", missing: false }),
    ];
    const job = jobFromProject({ ...off, assets });
    expect(job.transitions).toEqual([]);
    expect(job.tracks.find((t) => t.id === "V1")!.clips).toEqual([]);
    expect(job.tracks.find((t) => t.id === "V2")!.clips.map((c) => c.id)).toEqual(["v2"]);
  });
});

describe("preview and export compositor", () => {
  it("preview and export call the same function", () => {
    expect(previewComposite).toBe(exportComposite);
    expect(previewComposite).toBe(compositeVideoAt);
  });
});

describe("transition audio", () => {
  it("audioMode does not mutate clip.fadeInMs", () => {
    const start = sessionOf();
    const before = start.project.clips.find((c) => c.id === "v1")!.fadeInMs;
    const next = applyCommand(start, { type: "setTransition", audioMode: "crossfade", audioDurationMs: 400 });
    expect(next.project.clips.find((c) => c.id === "v1")!.fadeInMs).toBe(before);
    expect(next.project.clips.find((c) => c.id === "v1")!.fadeInMs).toBe(120);
    expect(next.project.transitions[0]?.audioMode).toBe("crossfade");
  });

  it("keepB mutes A in the video window without writing fades", () => {
    const project = stackedV1OverV2();
    const { project: next } = upsertTransition(project, resolveEditPair(project, ["v1"])!, {
      audioMode: "keepB",
      durationMs: 1000,
      startMs: 1000,
    });
    expect(transitionAudioGain(next.transitions, "v1", 1500, next)).toBe(0);
    expect(transitionAudioGain(next.transitions, "v2", 1500, next)).toBe(1);
    expect(next.clips.find((c) => c.id === "v1")!.fadeInMs).toBe(120);
  });
});

describe("export job consumes transitions", () => {
  it("copies transitions onto the job with start shifted by IN", () => {
    const project = { ...stackedV1OverV2(), inPointMs: 200, outPointMs: 2800 };
    const { project: withTr } = upsertTransition(project, resolveEditPair(project, ["v2"])!, {
      type: "crossfade",
      startMs: 1000,
      durationMs: 800,
    });
    const job = jobFromProject(withTr);
    expect(job.transitions).toHaveLength(1);
    expect(job.transitions![0]!.startMs).toBe(800);
    expect(job.transitions![0]!.type).toBe("crossfade");
  });
});
