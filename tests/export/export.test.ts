import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/core/project";
import { exportVisOf, jobFromProject, ExportPlanError } from "../../src/core/exporter/job";
import { exportContentEndMs, exportRangeMs } from "../../src/core/timeline";
import { exportTimeline, canUseWebCodecs, webCodecsUnavailableMessage } from "../../src/core/exporter";
import { hexHeader, looksLikeWebm, validateMp4Ftyp } from "../../src/core/exporter/ftyp";
import { muxAvcToMp4 } from "../../src/core/exporter/mp4";
import { DEFAULT_VISUALIZER_SCENE_ID, sourceTimeAt } from "../../src/core/models";
import { contextFromExportClips, contextFromProject, resolvePictureSource } from "../../src/core/transition";
import { featuresAt, visFeaturesForExport } from "../../src/core/visualizer";
import { asset, clip, projectWith } from "../helpers";
import type { ExportJob } from "../../src/core/exporter/types";

function projectReady() {
  return projectWith(
    [clip({ id: "c1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 })],
    [asset({ id: "a1", kind: "video", durationMs: 1000, objectUrl: "blob:test", missing: false })],
  );
}

function emptyJob(partial: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "empty",
    projectId: "p",
    projectName: "empty",
    startMs: 0,
    endMs: 0,
    durationMs: 0,
    width: 16,
    height: 16,
    fps: 30,
    fileName: "empty.mp4",
    tracks: [],
    visualizer: { enabled: false, muted: false, sceneId: "spectrum-bars" },
    ...partial,
  };
}

describe("export planner + fail path", () => {
  it("fails empty project before encode", () => {
    expect(() => jobFromProject(createEmptyProject())).toThrow(ExportPlanError);
    expect(exportContentEndMs(createEmptyProject())).toBe(0);
  });

  it("unset OUT includes VIS events/window and skips disabled clips (P101)", () => {
    const visOnly = createEmptyProject("VIS");
    visOnly.visualizer = {
      ...visOnly.visualizer,
      enabled: true,
      muted: false,
      startMs: 0,
      durationMs: 0,
      events: [{ id: "ve1", sceneId: "pulse-orb", startMs: 1000, durationMs: 4000 }],
    };
    const visJob = jobFromProject(visOnly);
    expect(exportRangeMs(visOnly)).toEqual({ startMs: 0, endMs: 5000 });
    expect(visJob.durationMs).toBe(5000);
    expect(visJob.visualizer.events?.[0]?.startMs).toBe(1000);

    const windowOnly = createEmptyProject("WIN");
    windowOnly.visualizer = {
      ...windowOnly.visualizer,
      enabled: true,
      muted: false,
      startMs: 200,
      durationMs: 1800,
      events: [],
    };
    expect(jobFromProject(windowOnly).durationMs).toBe(2000);

    const p = projectReady();
    p.clips.push(
      clip({ id: "off", assetId: "a1", trackId: "V1", startMs: 1000, durationMs: 4000, enabled: false }),
    );
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      events: [{ id: "tail", sceneId: "lita-bloom", startMs: 800, durationMs: 700 }],
    };
    expect(exportRangeMs(p)).toEqual({ startMs: 0, endMs: 1500 });
    const job = jobFromProject(p);
    expect(job.durationMs).toBe(1500);
    expect(job.tracks.find((t) => t.id === "V1")!.clips.map((c) => c.id)).toEqual(["c1"]);

    p.outPointMs = 900;
    expect(exportRangeMs(p).endMs).toBe(900);
    expect(jobFromProject(p).durationMs).toBe(900);

    const muted = createEmptyProject("MUTE");
    muted.visualizer = {
      ...muted.visualizer,
      enabled: true,
      muted: true,
      events: [{ id: "ve", sceneId: "pulse-orb", startMs: 0, durationMs: 9000 }],
    };
    expect(exportContentEndMs(muted)).toBe(0);
    expect(() => jobFromProject(muted)).toThrow(ExportPlanError);

    const locked = projectReady();
    locked.clips[0] = { ...locked.clips[0]!, locked: true };
    expect(exportRangeMs(locked).endMs).toBe(1000);
    expect(jobFromProject(locked).tracks.find((t) => t.id === "V1")!.clips[0]!.id).toBe("c1");
  });

  it("rate + IN still advances sourceIn via sourceTimeAt (already matched)", () => {
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "a1",
          trackId: "V1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 4000,
          rate: 2,
        }),
      ],
      [asset({ id: "a1", kind: "video", durationMs: 4000, objectUrl: "blob:test", missing: false })],
    );
    p.inPointMs = 500;
    p.outPointMs = 1500;
    const jc = jobFromProject(p).tracks.find((t) => t.id === "V1")!.clips[0]!;
    expect(jc.sourceInMs).toBe(sourceTimeAt(p.clips[0]!, 500));
    expect(jc.sourceOutMs).toBe(sourceTimeAt(p.clips[0]!, 1500));
    expect(jc.rate).toBe(2);
    expect(jc.startMs).toBe(0);
    expect(jc.endMs).toBe(1000);
  });

  it("empty job FAIL", async () => {
    const result = await exportTimeline(emptyJob());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty|no clips/i);
    expect(result.fileSizeBytes).toBe(0);
    expect(result.blob).toBeFalsy();
  });

  it("fails when IN >= OUT", () => {
    const p = projectReady();
    p.inPointMs = 800;
    p.outPointMs = 200;
    expect(() => jobFromProject(p)).toThrow(/empty/);
  });

  it("copies visualizer onto the job; encode features stay the synthetic 120 BPM grid", () => {
    const p = projectReady();
    p.visualizer = { enabled: true, muted: false, sceneId: "lita-bloom" };
    const job = jobFromProject(p);
    expect(job.visualizer).toEqual({
      enabled: true,
      muted: false,
      sceneId: "lita-bloom",
      startMs: 0,
      durationMs: 0,
      events: [],
    });
    // No mix yet: paint still falls back to featuresAt (120 BPM grid).
    const f = featuresAt(0, job.durationMs);
    expect(f.tempoBpm).toBe(120);
    expect(f.spectrum).toHaveLength(64);
    expect(f.rms).toBeCloseTo(1, 5);
    expect(jobFromProject(projectReady()).visualizer.sceneId).toBe(DEFAULT_VISUALIZER_SCENE_ID);
  });

  it("plans IN/OUT range and shifts clip times", () => {
    const p = projectReady();
    p.inPointMs = 200;
    p.outPointMs = 800;
    const job = jobFromProject(p);
    expect(job.durationMs).toBe(600);
    expect(job.tracks.find((t) => t.id === "V1")!.clips[0]!.startMs).toBe(0);
    expect(job.fileName.endsWith(".mp4")).toBe(true);
    const jc = job.tracks.find((t) => t.id === "V1")!.clips[0]!;
    expect(jc.endMs).toBe(600);
    expect(jc.sourceInMs).toBe(200);
    expect(jc.sourceOutMs).toBe(800);
  });

  it("IN advances sourceIn so export frame 0 matches preview at IN (P98)", () => {
    const p = projectReady();
    p.inPointMs = 200;
    p.outPointMs = 800;
    const job = jobFromProject(p);
    const jc = job.tracks.find((t) => t.id === "V1")!.clips[0]!;
    const previewSrc = p.clips[0]!;
    expect(jc.sourceInMs).toBe(sourceTimeAt(previewSrc, 200));
    expect(jc.startMs).toBe(0);
    expect(jc.endMs).toBe(600);
  });

  it("no-mix VIS features at job t=0 match preview-at-IN (P100)", () => {
    const p = createEmptyProject("VIS");
    p.inPointMs = 2250;
    p.outPointMs = 4000;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      startMs: 0,
      durationMs: 0,
      events: [],
    };
    const job = jobFromProject(p);
    expect(job.startMs).toBe(2250);
    expect(job.durationMs).toBe(1750);
    const preview = featuresAt(2250, 2250 + job.durationMs);
    const exported = visFeaturesForExport(0, job.durationMs, null, {
      timelineOriginMs: job.startMs,
    });
    expect(exported.energy).toBeCloseTo(preview.energy, 5);
    expect(exported.energy).not.toBeCloseTo(featuresAt(0, job.durationMs).energy, 5);
  });

  it("shifts the legacy VIS window by IN like events (P96)", () => {
    const p = createEmptyProject("VIS");
    p.inPointMs = 2000;
    p.outPointMs = 4000;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      startMs: 1000,
      durationMs: 4000,
      events: [],
    };
    const job = jobFromProject(p);
    expect(job.visualizer.startMs).toBe(-1000);
    expect(job.visualizer.durationMs).toBe(4000);
    expect(job.durationMs).toBe(2000);
    const preview = resolvePictureSource(contextFromProject(p), 2000);
    const exported = resolvePictureSource(
      contextFromExportClips([], job.transitions ?? [], job.frontVideoTrackId, exportVisOf(job)),
      0,
    );
    expect(preview.kind).toBe("vis");
    expect(exported.kind).toBe("vis");
    expect(exported).toEqual(preview);
  });

  it("exportTimeline FAILs without WebCodecs (never WebM success)", async () => {
    const job = jobFromProject(projectReady());
    const result = await exportTimeline(job);
    if (canUseWebCodecs()) {
      expect(result.success === true || result.success === false).toBe(true);
      if (result.success) {
        expect(result.mimeType).toBe("video/mp4");
        expect(result.blob).toBeTruthy();
      }
    } else {
      expect(result.success).toBe(false);
      expect(result.error).toBe(webCodecsUnavailableMessage());
      expect(result.error).toMatch(/WebM is not a fallback/);
    }
  });

  it("fails when the only video clip is missing", async () => {
    const p = projectWith(
      [clip({ id: "c1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "a1", name: "user-video.mp4", kind: "video", durationMs: 1000, missing: true })],
    );
    const job = jobFromProject(p);
    const result = await exportTimeline(job);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing:user-video\.mp4/);
    expect(result.blob).toBeFalsy();
    expect(result.fileSizeBytes).toBe(0);
  });

  it("rejects WebM bytes as MP4", () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);
    expect(looksLikeWebm(webm)).toBe(true);
    const check = validateMp4Ftyp(webm);
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/WebM/);
  });

  it("validates a muxed ftyp box (synthetic AVC, not a runtime export)", () => {
    const avcC = new Uint8Array([
      1, 0x42, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x08,
      0x67, 0x42, 0x00, 0x1f, 0xaa, 0xbb, 0xcc, 0xdd,
      0x01, 0x00, 0x05, 0x68, 0xee, 0xff, 0x00, 0x11,
    ]);
    const nal = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x65, 1, 2, 3, 4, 5, 6, 7]);
    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: avcC,
      samples: [{ data: nal, timestampUs: 0, durationUs: 33333, key: true }],
    });
    const check = validateMp4Ftyp(bytes);
    expect(check.ok).toBe(true);
    expect(check.brands).toContain("isom");
    expect(check.brands).toContain("avc1");
    expect(hexHeader(bytes, 8)).toMatch(/66 74 79 70/);
    expect(String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!)).toBe("ftyp");
  });
});

describe("export mute skip", () => {
  it("keeps muted V1 picture clips and silences their gain", () => {
    const p = projectWith(
      [
        clip({ id: "v1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "a1", assetId: "a2", trackId: "A1", startMs: 0, durationMs: 1000 }),
      ],
      [
        asset({ id: "a1", kind: "video", durationMs: 1000, objectUrl: "blob:v", missing: false }),
        asset({ id: "a2", kind: "audio", durationMs: 1000, objectUrl: "blob:a", missing: false }),
      ],
    );
    p.tracks = p.tracks.map((t) => (t.id === "V1" ? { ...t, muted: true } : t));
    const job = jobFromProject(p);
    expect(job.tracks.find((t) => t.id === "V1")!.clips).toHaveLength(1);
    expect(job.tracks.find((t) => t.id === "V1")!.clips[0]!.gain).toBe(0);
    expect(job.tracks.find((t) => t.id === "V1")!.clips[0]!.videoGain).toBe(1);
    expect(job.tracks.find((t) => t.id === "A1")!.clips).toHaveLength(1);
  });

  it("copies visualizer onto the job; no-mix export still uses the 120 BPM fallback", () => {
    const p = projectReady();
    p.visualizer = { enabled: true, muted: false, sceneId: "lita-bloom" };
    const job = jobFromProject(p);
    expect(job.visualizer).toEqual({
      enabled: true,
      muted: false,
      sceneId: "lita-bloom",
      startMs: 0,
      durationMs: 0,
      events: [],
    });
    const f = featuresAt(0, job.durationMs);
    expect(f.tempoBpm).toBe(120);
    expect(f.spectrum).toHaveLength(64);
    expect(f.rms).toBeCloseTo(1, 5);
  });

  it("omits non-soloed tracks when any track is soloed", () => {
    const p = projectWith(
      [
        clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "a2", assetId: "ab", trackId: "A2", startMs: 0, durationMs: 1000 }),
      ],
      [
        asset({ id: "aa", kind: "audio", durationMs: 1000, objectUrl: "blob:a", missing: false }),
        asset({ id: "ab", kind: "audio", durationMs: 1000, objectUrl: "blob:b", missing: false }),
      ],
    );
    p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, solo: true } : t));
    const job = jobFromProject(p);
    expect(job.tracks.find((t) => t.id === "A1")!.clips).toHaveLength(1);
    expect(job.tracks.find((t) => t.id === "A2")!.clips).toHaveLength(0);
  });

  it("omits muted A1 from the job", () => {
    const p = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 1000, objectUrl: "blob:v", missing: false }),
        asset({ id: "aa", kind: "audio", durationMs: 1000, objectUrl: "blob:a", missing: false }),
      ],
    );
    p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, muted: true } : t));
    const job = jobFromProject(p);
    expect(job.tracks.find((t) => t.id === "A1")!.clips).toHaveLength(0);
    expect(job.tracks.find((t) => t.id === "V1")!.clips).toHaveLength(1);
  });
});
