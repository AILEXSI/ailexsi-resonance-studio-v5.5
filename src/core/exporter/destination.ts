import {
  existingExportNamesFromMemory,
  nextVersionedFileName,
} from "./filename-version";
import {
  exportPickerOptions,
  exportStatusFallback,
  exportStatusFsa,
  pickExportDestination,
  rememberExportFileName,
  writeExportBlob,
  type ExportDestination,
  type PickerHost,
  type ProjectFileMemory,
  type ProjectFileStore,
  type SavePickerOptions,
} from "../project-file";
import { isExportSuccess } from "./dialog";
import type { ExportHooks, ExportJob, ExportProgress, ExportResult } from "./types";

export type ExportDestinationOutcome =
  | { kind: "cancelled" }
  | {
      kind: "done";
      job: ExportJob;
      result: ExportResult;
      usedDownload: boolean;
      wroteHandle: boolean;
      memory: ProjectFileMemory;
      status: string;
    };

/**
 * Pick the MP4 destination first. Encode only after the user confirms
 * (or after deciding FSA is unavailable). Write via createWritable when a
 * handle exists; otherwise downloadMp4 after encode.
 */
export async function runExportWithDestination(opts: {
  job: ExportJob;
  host: PickerHost;
  store: ProjectFileStore;
  memory: ProjectFileMemory;
  encode: (job: ExportJob, hooks?: ExportHooks) => Promise<ExportResult>;
  downloadMp4: (result: ExportResult) => void;
  pickerOptions?: (suggestedName: string, memory: ProjectFileMemory) => SavePickerOptions;
  onBeforeEncode?: (job: ExportJob) => void;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}): Promise<ExportDestinationOutcome> {
  // Sync only — first await must stay showSaveFilePicker (user gesture).
  const suggestedName = nextVersionedFileName(
    opts.job.fileName,
    existingExportNamesFromMemory(opts.memory),
  );
  const planned = suggestedName === opts.job.fileName ? opts.job : { ...opts.job, fileName: suggestedName };
  const dest: ExportDestination = await pickExportDestination({
    host: opts.host,
    store: opts.store,
    memory: opts.memory,
    suggestedName: planned.fileName,
    pickerOptions: opts.pickerOptions ?? exportPickerOptions,
  });
  if (dest.kind === "cancelled") return { kind: "cancelled" };

  const job =
    dest.kind === "picked" ? { ...planned, fileName: dest.fileName } : planned;
  const memory = dest.kind === "picked" ? dest.memory : opts.memory;

  opts.onBeforeEncode?.(job);
  const result = await opts.encode(job, {
    signal: opts.signal,
    onProgress: opts.onProgress,
  });

  if (opts.signal?.aborted || result.aborted) {
    return {
      kind: "done",
      job,
      result,
      usedDownload: false,
      wroteHandle: false,
      memory,
      status: "Export cancelled",
    };
  }
  if (!isExportSuccess(result) || !result.blob) {
    return {
      kind: "done",
      job,
      result,
      usedDownload: false,
      wroteHandle: false,
      memory,
      status: "Export failed",
    };
  }

  if (dest.kind === "picked" && typeof dest.handle.createWritable === "function") {
    await writeExportBlob(dest.handle, result.blob);
    return {
      kind: "done",
      job,
      result,
      usedDownload: false,
      wroteHandle: true,
      memory: await rememberExportFileName(opts.store, memory, job.fileName),
      status: exportStatusFsa(job.fileName, result.fileSizeBytes),
    };
  }

  opts.downloadMp4(result);
  return {
    kind: "done",
    job,
    result,
    usedDownload: true,
    wroteHandle: false,
    memory: await rememberExportFileName(opts.store, memory, job.fileName),
    status: exportStatusFallback(job.fileName, result.fileSizeBytes),
  };
}
