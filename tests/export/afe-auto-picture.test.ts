import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/core/project";
import { AfeError, hostSafeSourceName } from "../../src/core/frame-engine";
import { countExportPictureKinds, groupFrameRuns } from "../../src/core/exporter/webcodecs";
import { jobFromProject } from "../../src/core/exporter/job";
import { asset, clip, projectWith } from "../helpers";

describe("AFE-06 AUTO picture counts + honest dump helpers", () => {
  it("VIS-only range with events and no video clip: afeFrames===0, no getDecoder run", () => {
    const p = createEmptyProject("VIS-only");
    p.inPointMs = 0;
    p.outPointMs = 2000;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      sceneId: "void-lattice",
      startMs: 0,
      durationMs: 0,
      events: [{ id: "lattice", sceneId: "void-lattice", startMs: 0, durationMs: 2000 }],
    };
    const job = jobFromProject(p);
    expect(job.visualizer.events?.length).toBeGreaterThan(0);
    expect(job.tracks.flatMap((t) => t.clips.filter((c) => c.kind === "video"))).toHaveLength(0);
    const counts = countExportPictureKinds(job);
    expect(counts.afeFrames).toBe(0);
    expect(counts.visFrames).toBeGreaterThan(0);
    const total = Math.max(1, Math.round((job.durationMs / 1000) * job.fps));
    const runs = groupFrameRuns(job, total, job.fps);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.clip == null)).toBe(true);
  });

  it("gap between VIS events + overlapping V1 clip: afeFrames>0 (AUTO, video first)", () => {
    const p = projectWith(
      [clip({ id: "v1-pocket", assetId: "a1", trackId: "V1", startMs: 1500, durationMs: 1000 })],
      [
        asset({
          id: "a1",
          name: "V1-stills.mp4",
          kind: "video",
          durationMs: 8000,
          objectUrl: "blob:v1-stills",
          missing: false,
        }),
      ],
    );
    p.inPointMs = 0;
    p.outPointMs = 4000;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      sceneId: "void-lattice",
      startMs: 0,
      durationMs: 0,
      events: [
        { id: "lattice", sceneId: "void-lattice", startMs: 0, durationMs: 1000 },
        { id: "field", sceneId: "particle-field", startMs: 3000, durationMs: 1000 },
      ],
    };
    const job = jobFromProject(p);
    expect(job.visualizer.events?.length).toBeGreaterThan(0);
    const counts = countExportPictureKinds(job);
    expect(counts.afeFrames).toBeGreaterThan(0);
    expect(counts.visFrames).toBeGreaterThan(0);
    const total = Math.max(1, Math.round((job.durationMs / 1000) * job.fps));
    const runs = groupFrameRuns(job, total, job.fps);
    expect(runs.some((r) => r.clip?.id === "v1-pocket")).toBe(true);
    expect(runs.some((r) => r.clip == null)).toBe(true);
  });

  it("host-safe source name is a leaf, not a path", () => {
    expect(hostSafeSourceName("blob:https://host/uuid-leaf")).toBe("uuid-leaf");
    expect(hostSafeSourceName("file:///C:/Users/marti/V1-stills.mp4")).toBe("V1-stills.mp4");
    expect(hostSafeSourceName("https://example.test/media/clip.mp4?token=secret")).toBe("clip.mp4");
    expect(hostSafeSourceName("")).toBe("source");
  });

  it("typed stall still carries AfeError AFE_DECODE_STALL (no snap)", () => {
    const err = new AfeError("AFE_DECODE_STALL", "requested sample 3 PTS 100000", false);
    expect(err.code).toBe("AFE_DECODE_STALL");
    expect(err.fallbackSafe).toBe(false);
    expect(err.message).not.toMatch(/nearest|snap/i);
  });
});
