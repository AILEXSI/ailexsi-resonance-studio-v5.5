import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginExportFailSession,
  captureThrownValue,
  clearExportFailDiagnostics,
  EXPORT_FAIL_DUMP_TITLE,
  exportResultFromCaughtThrow,
  failExportDialog,
  formatExportFailDump,
  installExportFailDiagnostics,
  isStackOverflowThrown,
  lastCapturedThrown,
  lastGlobalExportFail,
  openExportDialog,
  uninstallExportFailDiagnostics,
  updateExportFailContext,
} from "../../src/core/exporter";
import type { ExportJob } from "../../src/core/exporter/types";
import { ailexsiBuildIdentity } from "../../src/core/build-info";

function job(partial: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "stress-02",
    projectId: "p",
    projectName: "stress-02",
    startMs: 0,
    endMs: 1_500_000,
    durationMs: 1_500_000,
    width: 1920,
    height: 1080,
    fps: 30,
    fileName: "stress-02.mp4",
    tracks: [
      {
        id: "V1",
        kind: "video",
        pan: 0,
        clips: [
          {
            id: "clip-a",
            trackId: "V1",
            kind: "video",
            startMs: 0,
            endMs: 1_500_000,
            sourceUrl: "blob:stress-02",
            sourceInMs: 0,
            sourceOutMs: 38_600,
            gain: 1,
            fadeInMs: 0,
            fadeOutMs: 0,
            rate: 1,
            missing: false,
            label: "Kopie.mp4",
          },
        ],
      },
    ],
    visualizer: { enabled: false, muted: true, sceneId: "spectrum-bars" },
    ...partial,
  };
}

function rangeErrorWithOriginalStack(): RangeError {
  const err = new RangeError("Maximum call stack size exceeded");
  if (!err.stack || !err.stack.includes("Maximum call stack size exceeded")) {
    err.stack = "RangeError: Maximum call stack size exceeded\n    at muxAvcToMp4 (src/core/exporter/mp4.ts:379:24)\n    at exportWithWebCodecs (src/core/exporter/webcodecs.ts:723:13)";
  }
  return err;
}

afterEach(() => {
  uninstallExportFailDiagnostics();
  clearExportFailDiagnostics();
  vi.restoreAllMocks();
  vi.doUnmock("../../src/core/exporter/webcodecs");
});

describe("STRESS-02 call-stack dump capture", () => {
  it("captureThrownValue keeps the original Error.stack (does not rebuild)", () => {
    const original = rangeErrorWithOriginalStack();
    const captured = captureThrownValue(original);
    expect(captured.kind).toBe("error");
    expect(captured.name).toBe("RangeError");
    expect(captured.message).toBe("Maximum call stack size exceeded");
    expect(captured.stack).toBe(original.stack);
    const rebuilt = new Error("Maximum call stack size exceeded");
    expect(captured.stack).not.toBe(rebuilt.stack);
    expect(captured.stack).toContain("Maximum call stack size exceeded");
  });

  it("non-Error thrown values record typeof and String(value)", () => {
    const captured = captureThrownValue(42);
    expect(captured.kind).toBe("nonerror");
    expect(captured.typeofValue).toBe("number");
    expect(captured.stringValue).toBe("42");
    expect(captured.stack).toBeNull();
    const dump = formatExportFailDump(captured);
    expect(dump).toContain("thrown.typeof number");
    expect(dump).toContain("thrown.string 42");
    expect(dump).toContain("error.stack (not an Error");
  });

  it("export boundary dump records original stack plus export context fields", () => {
    const original = rangeErrorWithOriginalStack();
    beginExportFailSession(job());
    updateExportFailContext({
      exportFrame: 42120,
      timelineMs: 1_404_000,
      fps: 30,
      resolution: "1920x1080",
      clipId: "clip-a",
      clipName: "Kopie.mp4",
      sourceId: "Kopie.mp4",
      sourceInMs: 0,
      sourceOutMs: 38_600,
      pictureMode: "video",
      videoReq: 42121,
      videoDec: 42120,
      videoEnc: 42120,
      afeFrames: 42120,
      visFrames: 0,
      blackFrames: 0,
      decoderQueue: 12,
      encoderQueue: 3,
      transactionId: 7,
      requestedSample: 88,
      requestedPts: 3_666_667,
      stage: "mux",
    });
    const result = exportResultFromCaughtThrow(job(), original);
    expect(result.success).toBe(false);
    const dump = result.error ?? "";
    expect(dump.startsWith(EXPORT_FAIL_DUMP_TITLE)).toBe(true);
    expect(dump).toContain("error.name RangeError");
    expect(dump).toContain("error.message Maximum call stack size exceeded");
    expect(dump).toContain(original.stack!);
    expect(dump).not.toContain(new Error("wrapper").stack!.split("\n")[1] ?? "___never___");
    const id = ailexsiBuildIdentity();
    expect(dump).toContain(`productVersion ${id.productVersion}`);
    expect(dump).toContain(`gitSha ${id.gitSha}`);
    expect(dump).toContain(`branch ${id.branch}`);
    expect(dump).toContain("exportFrame 42120");
    expect(dump).toContain("timelineMs 1404000");
    expect(dump).toContain("fps 30");
    expect(dump).toContain("resolution 1920x1080");
    expect(dump).toContain("clipId clip-a");
    expect(dump).toContain("clipName Kopie.mp4");
    expect(dump).toContain("sourceId Kopie.mp4");
    expect(dump).toContain("sourceInMs 0");
    expect(dump).toContain("sourceOutMs 38600");
    expect(dump).toContain("pictureMode video");
    expect(dump).toContain("videoReq 42121");
    expect(dump).toContain("videoDec 42120");
    expect(dump).toContain("videoEnc 42120");
    expect(dump).toContain("afeFrames 42120");
    expect(dump).toContain("visFrames 0");
    expect(dump).toContain("blackFrames 0");
    expect(dump).toContain("decoderQueue 12");
    expect(dump).toContain("encoderQueue 3");
    expect(dump).toContain("transactionId 7");
    expect(dump).toContain("requestedSample 88");
    expect(dump).toContain("requestedPts 3666667");
    expect(dump).toContain("stage mux");
    expect(dump).toMatch(/sourcemapDiagnostic (yes|no)/);
  });

  it("failExportDialog puts the dump on the scrollable failed-status (not console-only)", () => {
    const original = rangeErrorWithOriginalStack();
    const dump = exportResultFromCaughtThrow(job(), original).error ?? "";
    const failed = failExportDialog(
      openExportDialog({ fileName: "stress-02.mp4", width: 1920, height: 1080, fps: 30 }),
      dump,
    );
    expect(failed.phase).toBe("failed");
    expect(failed.error).toContain(EXPORT_FAIL_DUMP_TITLE);
    expect(failed.error).toContain(original.stack!);
    expect(failed.error).toContain("error.name RangeError");
  });

  it("exportTimeline outermost catch records the original RangeError stack", async () => {
    const original = rangeErrorWithOriginalStack();
    vi.resetModules();
    vi.doMock("../../src/core/exporter/webcodecs", async () => {
      const actual = await vi.importActual<typeof import("../../src/core/exporter/webcodecs")>(
        "../../src/core/exporter/webcodecs",
      );
      return {
        ...actual,
        canUseWebCodecs: () => true,
        exportWithWebCodecs: async () => {
          throw original;
        },
      };
    });
    const { exportTimeline: isolatedExportTimeline } = await import("../../src/core/exporter/index");
    const result = await isolatedExportTimeline(job());
    expect(result.success).toBe(false);
    expect(result.error).toContain(EXPORT_FAIL_DUMP_TITLE);
    expect(result.error).toContain("error.name RangeError");
    expect(result.error).toContain(original.stack!);
    expect(result.error).toContain("resolution 1920x1080");
    expect(result.error).toContain("fps 30");
    vi.doUnmock("../../src/core/exporter/webcodecs");
    vi.resetModules();
  });

  it("window.onerror and unhandledrejection capture without swallowing", () => {
    let priorError = 0;
    const prevOnError = window.onerror;
    window.onerror = () => {
      priorError += 1;
      return false;
    };
    installExportFailDiagnostics();
    const original = rangeErrorWithOriginalStack();
    const swallowed = window.onerror?.(
      original.message,
      "app.js",
      10,
      4,
      original,
    );
    expect(swallowed).not.toBe(true);
    expect(priorError).toBe(1);
    expect(lastGlobalExportFail()?.stack).toBe(original.stack);
    expect(lastCapturedThrown()?.name).toBe("RangeError");

    const reason = new RangeError("Maximum call stack size exceeded");
    reason.stack = original.stack;
    const ev = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(ev, "reason", { value: reason });
    let prevented = false;
    ev.preventDefault = () => {
      prevented = true;
    };
    window.onunhandledrejection?.(ev);
    expect(prevented).toBe(false);
    expect(lastGlobalExportFail()?.message).toBe("Maximum call stack size exceeded");
    uninstallExportFailDiagnostics();
    window.onerror = prevOnError;
  });

  it("isStackOverflowThrown matches RangeError call-stack text only", () => {
    expect(isStackOverflowThrown(new RangeError("Maximum call stack size exceeded"))).toBe(true);
    expect(isStackOverflowThrown(new Error("too much recursion"))).toBe(true);
    expect(isStackOverflowThrown(new Error("FAIL: empty export job"))).toBe(false);
    expect(isStackOverflowThrown(new RangeError("Invalid array length"))).toBe(false);
  });
});
