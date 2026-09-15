import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { jobFromProject } from "../../src/core/exporter/job";
import { exportComposite } from "../../src/core/exporter/webcodecs";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import {
  compositeVideoAt,
  contextFromProject,
  formatResolvedSource,
  resolvePictureSource,
  upsertTransition,
} from "../../src/core/transition";
import { previewComposite } from "../../src/ui/preview/Preview";
import { shouldShowVisualizer } from "../../src/core/visualizer";
import { asset, clip, projectWith } from "../helpers";

function stacked(front: "V1" | "V2" = "V2") {
  const project = projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 0, durationMs: 2000 }),
    ],
    [
      asset({ id: "va", kind: "video", durationMs: 4000 }),
      asset({ id: "vb", kind: "video", durationMs: 4000 }),
    ],
  );
  project.frontVideoTrackId = front;
  project.playheadMs = 500;
  return project;
}

function sessionOf(project = stacked(), selected: string[] = ["v1", "v2"]): Session {
  return {
    ...createSession(createMemoryBlobStore()),
    project,
    selectedClipId: selected[0] ?? null,
    selectedClipIds: selected,
  };
}

describe("transition source AUTO", () => {
  it("VIS event + covering video → video wins (VIS only fills gaps)", () => {
    const project = stacked();
    project.visualizer = {
      ...project.visualizer,
      events: [{ id: "ve1", sceneId: "pulse-orb", startMs: 0, durationMs: 1000 }],
    };
    const picture = resolvePictureSource(contextFromProject(project), 500);
    expect(picture).toMatchObject({ source: "auto", kind: "V2", clipId: "v2" });
    expect(shouldShowVisualizer(project, 500)).toBe(false);
    expect(formatResolvedSource(picture)).toBe("AUTO→V2");
  });

  it("VIS event + no video → vis", () => {
    const project = stacked();
    project.clips = [];
    project.visualizer = {
      ...project.visualizer,
      events: [{ id: "ve1", sceneId: "pulse-orb", startMs: 0, durationMs: 1000 }],
    };
    const picture = resolvePictureSource(contextFromProject(project), 500);
    expect(picture).toMatchObject({ source: "auto", kind: "vis" });
    expect(shouldShowVisualizer(project, 500)).toBe(true);
    expect(formatResolvedSource(picture)).toBe("AUTO→VIS");
  });

  it("no VIS, front V2 covering → V2", () => {
    const project = stacked("V2");
    const picture = resolvePictureSource(contextFromProject(project), 500);
    expect(picture).toMatchObject({ source: "auto", kind: "V2", clipId: "v2" });
    expect(compositeVideoAt(contextFromProject(project), 500).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
    expect(formatResolvedSource(picture)).toBe("AUTO→V2");
  });

  it("V2 empty, V1 covering → V1", () => {
    const project = stacked("V2");
    project.clips = project.clips.filter((c) => c.id !== "v2");
    const emptyV2 = resolvePictureSource(contextFromProject(project), 500);
    expect(emptyV2).toMatchObject({ source: "auto", kind: "V1", clipId: "v1" });
  });

  it("muted V2 still covers picture; mute is audio-only", () => {
    const muted = stacked("V2");
    muted.tracks = muted.tracks.map((t) => (t.id === "V2" ? { ...t, muted: true } : t));
    const mutedV2 = resolvePictureSource(contextFromProject(muted), 500);
    expect(mutedV2).toMatchObject({ source: "auto", kind: "V2", clipId: "v2" });
    expect(compositeVideoAt(contextFromProject(muted), 500).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
  });

  it("none → black", () => {
    const project = stacked();
    project.clips = [];
    project.visualizer = { ...project.visualizer, enabled: false };
    const picture = resolvePictureSource(contextFromProject(project), 500);
    expect(picture).toMatchObject({ source: "auto", kind: "black" });
    expect(formatResolvedSource(picture)).toBe("AUTO→BLACK");
    expect(compositeVideoAt(contextFromProject(project), 500).layers).toEqual([]);
  });
});

describe("transition source override", () => {
  it("explicit V2 while V1 covers", () => {
    const start = sessionOf(stacked("V2"));
    const next = applyCommand(start, { type: "setTransitionSource", source: "V2" });
    expect(next.project.transitions[0]?.source).toBe("V2");
    expect(resolvePictureSource(contextFromProject(next.project), 500).kind).toBe("V2");
    expect(compositeVideoAt(contextFromProject(next.project), 500).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
    expect(shouldShowVisualizer(next.project, 500)).toBe(false);
  });

  it("explicit V1 while V2 is front", () => {
    const start = sessionOf(stacked("V2"));
    const next = applyCommand(start, { type: "setTransitionSource", source: "V1" });
    expect(resolvePictureSource(contextFromProject(next.project), 500)).toMatchObject({
      source: "V1",
      kind: "V1",
      clipId: "v1",
    });
    expect(compositeVideoAt(contextFromProject(next.project), 500).layers).toEqual([
      { clipId: "v1", alpha: 1 },
    ]);
    expect(formatResolvedSource(resolvePictureSource(contextFromProject(next.project), 500))).toBe("V1");
  });

  it("explicit vis hides V1/V2", () => {
    const project = stacked();
    project.visualizer = {
      ...project.visualizer,
      events: [{ id: "ve1", sceneId: "spectrum-bars", startMs: 0, durationMs: 800 }],
    };
    const start = sessionOf(project);
    const next = applyCommand(start, { type: "setTransitionSource", source: "vis" });
    expect(resolvePictureSource(contextFromProject(next.project), 500).kind).toBe("vis");
    expect(shouldShowVisualizer(next.project, 500)).toBe(true);
    expect(compositeVideoAt(contextFromProject(next.project), 500).layers).toEqual([]);
    const noEvent = applyCommand(sessionOf(stacked()), { type: "setTransitionSource", source: "vis" });
    expect(resolvePictureSource(contextFromProject(noEvent.project), 500).kind).toBe("black");
    expect(shouldShowVisualizer(noEvent.project, 500)).toBe(false);
    expect(compositeVideoAt(contextFromProject(noEvent.project), 500).layers).toEqual([]);
  });

  it("explicit black hides vis+video", () => {
    const project = stacked();
    project.visualizer = {
      ...project.visualizer,
      events: [{ id: "ve1", sceneId: "lita-bloom", startMs: 0, durationMs: 800 }],
    };
    const next = applyCommand(sessionOf(project), { type: "setTransitionSource", source: "black" });
    expect(resolvePictureSource(contextFromProject(next.project), 500)).toMatchObject({
      source: "black",
      kind: "black",
    });
    expect(shouldShowVisualizer(next.project, 500)).toBe(false);
    expect(compositeVideoAt(contextFromProject(next.project), 500)).toEqual({
      layers: [],
      plate: { color: "#000000", alpha: 1 },
    });
  });

  it("missing field reloads as auto", () => {
    const p = stacked();
    const { project: withTr } = upsertTransition(p, {
      sourceA: p.clips[0]!,
      sourceB: p.clips[1]!,
      overlapStartMs: 0,
      overlapDurationMs: 2000,
    }, { type: "cut" });
    const raw = JSON.parse(serializeProject(withTr)) as { transitions: Array<Record<string, unknown>> };
    delete raw.transitions[0]!.source;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.transitions[0]?.source).toBe("auto");
    expect(resolvePictureSource(contextFromProject(loaded), 500).source).toBe("auto");
  });

  it("undo/redo of setTransitionSource", () => {
    const start = sessionOf();
    const set = applyCommand(start, { type: "setTransitionSource", source: "V1" });
    expect(set.project.transitions[0]?.source).toBe("V1");
    expect(set.history.past.length).toBe(start.history.past.length + 1);
    expect(set.status).toBe("Source V1");
    const undone = applyCommand(set, { type: "undo" });
    expect(undone.project.transitions).toEqual(start.project.transitions);
    const redone = applyCommand(undone, { type: "redo" });
    expect(redone.project.transitions[0]?.source).toBe("V1");
  });

  it("off-grid playhead still writes the thin overlap, not a cover clip (P95)", () => {
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
    project.playheadMs = 1070;
    project.snap = true;
    const start = sessionOf(project, []);
    expect(start.selectedClipId).toBeNull();
    expect(start.selectedClipIds).toEqual([]);
    const next = applyCommand(start, { type: "setTransitionSource", source: "V1" });
    expect(next.project.playheadMs).toBe(1070);
    expect(next.project.transitions).toHaveLength(1);
    expect(next.project.transitions[0]?.sourceAClipId).toBe("v1");
    expect(next.project.transitions[0]?.sourceBClipId).toBe("v2");
    expect(next.project.transitions[0]?.source).toBe("V1");
    expect(next.project.transitions[0]?.startMs).toBe(1000);
    expect(next.status).toBe("Source V1");

    const off = applyCommand(
      { ...start, project: { ...start.project, snap: false } },
      { type: "setTransitionSource", source: "V1" },
    );
    expect(off.project.playheadMs).toBe(1070);
    expect(off.project.transitions[0]?.sourceAClipId).not.toBe("v1");
  });

  it("compositeVideoAt preview path === export path", () => {
    expect(previewComposite).toBe(exportComposite);
    expect(previewComposite).toBe(compositeVideoAt);
    const project = applyCommand(sessionOf(), { type: "setTransitionSource", source: "V1" }).project;
    const job = jobFromProject(project);
    expect(job.transitions?.[0]?.source).toBe("V1");
    const ctx = contextFromProject(project);
    expect(compositeVideoAt(ctx, 500)).toEqual(previewComposite(ctx, 500));
  });
});
