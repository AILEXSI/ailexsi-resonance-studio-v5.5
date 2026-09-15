import { describe, expect, it } from "vitest";
import {
  abortExportDialog,
  applyExportDialogSize,
  applyExportProgress,
  closeExportDialog,
  closedExportDialog,
  driveExportDialog,
  exportTimeline,
  failExportDialog,
  isExportSuccess,
  jobFromProject,
  openExportDialog,
  readyExportDialog,
  succeedExportDialog,
} from "../../src/core/exporter";
import { asset, clip, projectWith } from "../helpers";
import type { ExportResult } from "../../src/core/exporter/types";

function projectReady() {
  return projectWith(
    [clip({ id: "c1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 })],
    [asset({ id: "a1", kind: "video", durationMs: 1000, objectUrl: "blob:test", missing: false })],
  );
}

describe("export dialog state", () => {
  it("jobFromProject uses one working 1280×720@30 default (P66 KEEP)", () => {
    const job = jobFromProject(projectReady());
    expect(job.width).toBe(1280);
    expect(job.height).toBe(720);
    expect(job.fps).toBe(30);
  });

  it("ready dialog size writes jobFromProject opts (P67)", () => {
    let state = readyExportDialog({ fileName: "cut.mp4" });
    expect(state.phase).toBe("ready");
    expect(state.width).toBe(1280);
    expect(state.height).toBe(720);
    expect(state.fps).toBe(30);
    state = applyExportDialogSize(state, { width: 1920, height: 1080, fps: 24 });
    expect(state.width).toBe(1920);
    expect(state.height).toBe(1080);
    expect(state.fps).toBe(24);
    const job = jobFromProject(projectReady(), {
      width: state.width,
      height: state.height,
      fps: state.fps,
    });
    expect(job.width).toBe(1920);
    expect(job.height).toBe(1080);
    expect(job.fps).toBe(24);
    const running = openExportDialog(job);
    expect(applyExportDialogSize(running, { width: 1280, height: 720 })).toBe(running);
  });

  it("export size/fps stay dialog state, not project history (P70 KEEP)", () => {
    const project = projectReady();
    const snapshot = structuredClone(project);
    let dialog = readyExportDialog({ width: 1280, height: 720, fps: 30 });
    dialog = applyExportDialogSize(dialog, { width: 1920, height: 1080, fps: 24 });
    expect(dialog.width).toBe(1920);
    expect(dialog.fps).toBe(24);
    expect(project).toEqual(snapshot);
  });

  it("starting export opens the dialog with job name and size", () => {
    const job = jobFromProject(projectReady());
    const closed = closedExportDialog();
    expect(closed.open).toBe(false);
    expect(closed.phase).toBe("closed");
    const open = openExportDialog(job);
    expect(open.open).toBe(true);
    expect(open.phase).toBe("running");
    expect(open.success).toBe(false);
    expect(open.aborted).toBe(false);
    expect(open.fileName).toBe(job.fileName);
    expect(open.width).toBe(job.width);
    expect(open.height).toBe(job.height);
    expect(open.fps).toBe(job.fps);
  });

  it("progress updates are represented in state", () => {
    const job = jobFromProject(projectReady());
    let state = openExportDialog(job);
    state = applyExportProgress(state, { percent: 37, stage: "Encoding H.264", currentTimeMs: 400 });
    expect(state.percent).toBe(37);
    expect(state.stage).toBe("Encoding H.264");
    expect(state.phase).toBe("running");
    state = applyExportProgress(state, { percent: 90.8, stage: "Encoding AAC" });
    expect(state.percent).toBe(91);
    expect(state.stage).toBe("Encoding AAC");
  });

  it("cancel sets aborted and does not mark success", () => {
    const job = jobFromProject(projectReady());
    let state = openExportDialog(job);
    state = applyExportProgress(state, { percent: 12, stage: "Encoding H.264" });
    state = abortExportDialog(state);
    expect(state.aborted).toBe(true);
    expect(state.success).toBe(false);
    expect(state.phase).toBe("aborted");
    expect(state.stage).toBe("Abgebrochen");
    const closed = closeExportDialog();
    expect(closed.open).toBe(false);
    expect(closed.success).toBe(false);
  });

  it("mocked encoder: cancel is not success and progress was applied", async () => {
    const job = jobFromProject(projectReady());
    const ac = new AbortController();
    const seen: number[] = [];
    const { dialog, result } = await driveExportDialog(
      job,
      async (_job, hooks) => {
        hooks.onProgress?.({ percent: 25, stage: "Encoding H.264" });
        ac.abort();
        const aborted: ExportResult = {
          success: false,
          aborted: true,
          error: "Export aborted",
          fileName: job.fileName,
          durationMs: job.durationMs,
          fileSizeBytes: 0,
        };
        return aborted;
      },
      {
        signal: ac.signal,
        onChange: (s) => {
          if (s.percent > 0) seen.push(s.percent);
        },
      },
    );
    expect(seen).toContain(25);
    expect(dialog.aborted).toBe(true);
    expect(dialog.success).toBe(false);
    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(isExportSuccess(result)).toBe(false);
  });

  it("exportTimeline with an aborted signal does not succeed or produce a blob", async () => {
    const job = jobFromProject(projectReady());
    const ac = new AbortController();
    ac.abort();
    const result = await exportTimeline(job, { signal: ac.signal });
    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.blob).toBeFalsy();
    expect(result.fileSizeBytes).toBe(0);
    expect(isExportSuccess(result)).toBe(false);
  });

  it("fail and done stay in the dialog until closed", () => {
    const job = jobFromProject(projectReady());
    const failed = failExportDialog(openExportDialog(job), "FAIL: empty");
    expect(failed.open).toBe(true);
    expect(failed.phase).toBe("failed");
    expect(failed.success).toBe(false);
    const done = succeedExportDialog(openExportDialog(job), "out.mp4");
    expect(done.phase).toBe("done");
    expect(done.success).toBe(true);
    expect(done.fileName).toBe("out.mp4");
    expect(done.percent).toBe(100);
  });
});
