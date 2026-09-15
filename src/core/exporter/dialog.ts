import type { ExportHooks, ExportJob, ExportProgress, ExportResult } from "./types";

export type ExportDialogPhase = "closed" | "ready" | "running" | "aborted" | "failed" | "done";

export const EXPORT_SIZE_PRESETS = [
  { id: "720p", width: 1280, height: 720 },
  { id: "1080p", width: 1920, height: 1080 },
] as const;

export const EXPORT_FPS_PRESETS = [24, 25, 30] as const;

export function normalizeExportSize(width: number, height: number): { width: number; height: number } {
  if (height >= 1080 || width >= 1920) return { width: 1920, height: 1080 };
  return { width: 1280, height: 720 };
}

export function normalizeExportFps(fps: number): number {
  if (fps === 24 || fps === 25) return fps;
  return 30;
}

export interface ExportDialogJobInfo {
  fileName: string;
  width: number;
  height: number;
  fps: number;
}

export interface ExportDialogState {
  open: boolean;
  phase: ExportDialogPhase;
  fileName: string;
  width: number;
  height: number;
  fps: number;
  percent: number;
  stage: string;
  error: string | null;
  aborted: boolean;
  success: boolean;
}

export function closedExportDialog(): ExportDialogState {
  return {
    open: false,
    phase: "closed",
    fileName: "",
    width: 1280,
    height: 720,
    fps: 30,
    percent: 0,
    stage: "",
    error: null,
    aborted: false,
    success: false,
  };
}

export function readyExportDialog(info: Partial<ExportDialogJobInfo> = {}): ExportDialogState {
  const size = normalizeExportSize(info.width ?? 1280, info.height ?? 720);
  return {
    open: true,
    phase: "ready",
    fileName: info.fileName ?? "",
    width: size.width,
    height: size.height,
    fps: normalizeExportFps(info.fps ?? 30),
    percent: 0,
    stage: "",
    error: null,
    aborted: false,
    success: false,
  };
}

export function applyExportDialogSize(
  state: ExportDialogState,
  patch: { width?: number; height?: number; fps?: number },
): ExportDialogState {
  if (!state.open || state.phase !== "ready") return state;
  const size = normalizeExportSize(patch.width ?? state.width, patch.height ?? state.height);
  return {
    ...state,
    width: size.width,
    height: size.height,
    fps: normalizeExportFps(patch.fps ?? state.fps),
  };
}

export function openExportDialog(job: ExportDialogJobInfo): ExportDialogState {
  return {
    open: true,
    phase: "running",
    fileName: job.fileName,
    width: job.width,
    height: job.height,
    fps: job.fps,
    percent: 0,
    stage: "Starting",
    error: null,
    aborted: false,
    success: false,
  };
}

export function applyExportProgress(
  state: ExportDialogState,
  progress: ExportProgress,
): ExportDialogState {
  if (!state.open || state.phase !== "running") return state;
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return {
    ...state,
    percent,
    stage: progress.stage,
  };
}

/** Abort the job. Never success. Caller may then close the dialog. */
export function abortExportDialog(state: ExportDialogState): ExportDialogState {
  return {
    ...state,
    phase: "aborted",
    aborted: true,
    success: false,
    stage: "Abgebrochen",
    error: null,
  };
}

export function failExportDialog(state: ExportDialogState, error: string): ExportDialogState {
  return {
    ...state,
    open: true,
    phase: "failed",
    success: false,
    aborted: false,
    error,
    stage: "Failed",
  };
}

export function succeedExportDialog(state: ExportDialogState, fileName?: string): ExportDialogState {
  return {
    ...state,
    open: true,
    phase: "done",
    success: true,
    aborted: false,
    fileName: fileName ?? state.fileName,
    percent: 100,
    stage: "Done",
    error: null,
  };
}

export function closeExportDialog(): ExportDialogState {
  return closedExportDialog();
}

export function isExportSuccess(result: ExportResult): boolean {
  return result.success === true && result.aborted !== true && Boolean(result.blob);
}

/**
 * Drive dialog state around a (possibly mocked) encoder.
 * Cancel / abort never becomes success.
 */
export async function driveExportDialog(
  job: ExportJob,
  encode: (job: ExportJob, hooks: ExportHooks) => Promise<ExportResult>,
  opts: { signal?: AbortSignal; onChange?: (state: ExportDialogState) => void } = {},
): Promise<{ dialog: ExportDialogState; result: ExportResult }> {
  let dialog = openExportDialog(job);
  opts.onChange?.(dialog);
  const result = await encode(job, {
    signal: opts.signal,
    onProgress: (progress) => {
      dialog = applyExportProgress(dialog, progress);
      opts.onChange?.(dialog);
    },
  });
  if (opts.signal?.aborted || result.aborted) {
    dialog = abortExportDialog(dialog);
  } else if (!result.success) {
    dialog = failExportDialog(dialog, result.error ?? "Export failed");
  } else {
    dialog = succeedExportDialog(dialog, result.fileName);
  }
  opts.onChange?.(dialog);
  return { dialog, result };
}
