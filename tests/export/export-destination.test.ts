import { describe, expect, it } from "vitest";
import { openExportDialog } from "../../src/core/exporter/dialog";
import { runExportWithDestination } from "../../src/core/exporter/destination";
import { jobFromProject } from "../../src/core/exporter/job";
import type { ExportJob, ExportResult } from "../../src/core/exporter/types";
import {
  emptyProjectFileMemory,
  exportPickerOptions,
  exportStatusFallback,
  pickExportDestination,
  savePickerOptions,
  wavExportPickerOptions,
  startInForPicker,
  statusHasFakePath,
  type DirectoryHandleLike,
  type FileHandleLike,
  type PickerHost,
  type SavePickerOptions,
} from "../../src/core/project-file";
import { createMemoryProjectFileStore } from "../../src/core/project-file-store";
import { asset, clip, projectWith } from "../helpers";

function projectReady() {
  return {
    ...projectWith(
      [clip({ id: "c1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "a1", kind: "video", durationMs: 1000, objectUrl: "blob:test", missing: false })],
    ),
    name: "Untitled Resonance",
  };
}

function abortError(): Error {
  const err = new Error("The user aborted a request.");
  err.name = "AbortError";
  return err;
}

function successResult(job: ExportJob, body = "mp4bytes"): ExportResult {
  return {
    success: true,
    aborted: false,
    fileName: job.fileName,
    durationMs: job.durationMs,
    fileSizeBytes: body.length,
    blob: new Blob([body], { type: "video/mp4" }),
  };
}

function mockMp4Handle(
  name: string,
  extras: Partial<FileHandleLike> = {},
): { handle: FileHandleLike; written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    handle: {
      name,
      kind: "file",
      createWritable: async () => ({
        write: async (data) => {
          written.push(data);
        },
        close: async () => {},
      }),
      ...extras,
    },
  };
}

describe("export destination before encode", () => {
  it("export picker is MP4-only and uses last folder or documents", () => {
    const job = jobFromProject(projectReady());
    expect(job.fileName).toBe("Untitled_Resonance.mp4");
    const empty = emptyProjectFileMemory();
    const opts = exportPickerOptions(job.fileName, empty);
    expect(opts.suggestedName).toBe("Untitled_Resonance.mp4");
    expect(opts.startIn).toBe("documents");
    expect(opts.types).toEqual([{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }]);
    expect(JSON.stringify(opts.types)).not.toMatch(/json/i);
    expect(savePickerOptions("Song.resonance.json", empty).types[0]?.accept["application/json"]).toBeTruthy();
    const wavOpts = wavExportPickerOptions("Untitled_Resonance.wav", empty);
    expect(wavOpts.types).toEqual([{ description: "WAV audio", accept: { "audio/wav": [".wav"] } }]);
    expect(JSON.stringify(exportPickerOptions(job.fileName, empty).types)).not.toMatch(/wav/i);

    const dir: DirectoryHandleLike = { kind: "directory", name: "Projects" };
    const withDir = { ...empty, directoryHandle: dir };
    expect(exportPickerOptions("cut.mp4", withDir).startIn).toBe(dir);
    expect(startInForPicker(withDir)).toBe(dir);
  });

  it("picker cancel → no dialog and no encode", async () => {
    const events: string[] = [];
    const host: PickerHost = {
      showSaveFilePicker: async () => {
        events.push("pick");
        throw abortError();
      },
    };
    const dest = await pickExportDestination({
      host,
      store: createMemoryProjectFileStore(),
      memory: emptyProjectFileMemory(),
      suggestedName: "Untitled_Resonance.mp4",
    });
    expect(dest.kind).toBe("cancelled");

    const outcome = await runExportWithDestination({
      job: jobFromProject(projectReady()),
      host,
      store: createMemoryProjectFileStore(),
      memory: emptyProjectFileMemory(),
      encode: async () => {
        events.push("encode");
        throw new Error("encode must not run");
      },
      downloadMp4: () => {
        events.push("download");
      },
      onBeforeEncode: () => {
        events.push("dialog");
      },
    });
    expect(outcome.kind).toBe("cancelled");
    expect(events).toEqual(["pick", "pick"]);
  });

  it("picker confirm → dialog fileName is the handle name and encode starts after", async () => {
    const events: string[] = [];
    const { handle, written } = mockMp4Handle("Show.mp4", {
      getParent: async () => ({ kind: "directory", name: "Exports" }),
    });
    let pickerOpts: SavePickerOptions | undefined;
    const host: PickerHost = {
      showSaveFilePicker: async (opts) => {
        events.push("pick");
        pickerOpts = opts;
        return handle;
      },
    };
    const job = jobFromProject(projectReady());
    expect(job.fileName).toBe("Untitled_Resonance.mp4");
    const projectHandle: FileHandleLike = { name: "Song.resonance.json", kind: "file" };
    const memory = {
      ...emptyProjectFileMemory(),
      fileHandle: projectHandle,
      lastFileName: "Song.resonance.json",
    };
    let dialogName = "";
    const downloads: string[] = [];
    const outcome = await runExportWithDestination({
      job,
      host,
      store: createMemoryProjectFileStore(),
      memory,
      encode: async (next) => {
        events.push("encode");
        expect(next.fileName).toBe("Show.mp4");
        return successResult(next);
      },
      downloadMp4: (result) => {
        downloads.push(result.fileName);
      },
      onBeforeEncode: (next) => {
        events.push("dialog");
        const dialog = openExportDialog(next);
        dialogName = dialog.fileName;
        expect(dialog.open).toBe(true);
        expect(dialog.phase).toBe("running");
      },
    });
    expect(pickerOpts?.suggestedName).toBe("Untitled_Resonance.v1.mp4");
    expect(pickerOpts?.types[0]?.accept["video/mp4"]).toEqual([".mp4"]);
    expect(events).toEqual(["pick", "dialog", "encode"]);
    expect(dialogName).toBe("Show.mp4");
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.job.fileName).toBe("Show.mp4");
    expect(outcome.wroteHandle).toBe(true);
    expect(outcome.usedDownload).toBe(false);
    expect(downloads).toEqual([]);
    expect(written).toHaveLength(1);
    expect(outcome.memory.fileHandle).toBe(projectHandle);
    expect(outcome.memory.lastFileName).toBe("Song.resonance.json");
    expect(outcome.memory.directoryHandle?.name).toBe("Exports");
    expect(outcome.status).toContain("Show.mp4");
    expect(statusHasFakePath(outcome.status)).toBe(false);
    expect(outcome.status).not.toMatch(/C:\\/);
    expect(dialogName).not.toMatch(/C:\\/);
  });

  it("success writes via createWritable, not <a download>", async () => {
    const { handle, written } = mockMp4Handle("cut.mp4");
    const clicks: string[] = [];
    const host: PickerHost = {
      showSaveFilePicker: async () => handle,
    };
    const outcome = await runExportWithDestination({
      job: jobFromProject(projectReady()),
      host,
      store: createMemoryProjectFileStore(),
      memory: emptyProjectFileMemory(),
      encode: async (job) => successResult(job, "ENCODED"),
      downloadMp4: () => {
        clicks.push("a[download]");
      },
    });
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.wroteHandle).toBe(true);
    expect(outcome.usedDownload).toBe(false);
    expect(clicks).toEqual([]);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(outcome.result.blob);
    expect((written[0] as Blob).size).toBe("ENCODED".length);
  });

  it("without showSaveFilePicker, encode then downloadMp4 and say so in status", async () => {
    const events: string[] = [];
    const outcome = await runExportWithDestination({
      job: jobFromProject(projectReady()),
      host: {},
      store: createMemoryProjectFileStore(),
      memory: emptyProjectFileMemory(),
      encode: async (job) => {
        events.push("encode");
        return successResult(job);
      },
      downloadMp4: () => {
        events.push("download");
      },
      onBeforeEncode: () => {
        events.push("dialog");
      },
    });
    expect(events).toEqual(["dialog", "encode", "download"]);
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.usedDownload).toBe(true);
    expect(outcome.wroteHandle).toBe(false);
    expect(outcome.status).toBe(
      exportStatusFallback("Untitled_Resonance.v1.mp4", "mp4bytes".length),
    );
    expect(outcome.status).toMatch(/Downloads/);
    expect(outcome.status).toMatch(/unbekannt/);
    expect(statusHasFakePath(outcome.status)).toBe(false);
    expect(outcome.status).not.toMatch(/C:\\/);
  });

  it("picker suggestedName is the next free .vN from last exports (sync, before encode)", async () => {
    let pickerOpts: SavePickerOptions | undefined;
    const { handle } = mockMp4Handle("Untitled_Resonance.v7.mp4");
    const host: PickerHost = {
      showSaveFilePicker: async (opts) => {
        pickerOpts = opts;
        return handle;
      },
    };
    const memory = {
      ...emptyProjectFileMemory(),
      lastExportFileName: "Untitled_Resonance.v6.mp4",
      lastExportFileNames: [
        "Untitled_Resonance.mp4",
        "Untitled_Resonance.v3.mp4",
        "Untitled_Resonance.v6.mp4",
      ],
    };
    const store = createMemoryProjectFileStore(memory);
    const outcome = await runExportWithDestination({
      job: jobFromProject(projectReady()),
      host,
      store,
      memory,
      encode: async (job) => successResult(job),
      downloadMp4: () => {},
    });
    expect(pickerOpts?.suggestedName).toBe("Untitled_Resonance.v7.mp4");
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.job.fileName).toBe("Untitled_Resonance.v7.mp4");
    expect(outcome.memory.lastExportFileName).toBe("Untitled_Resonance.v7.mp4");
    expect((await store.load()).lastExportFileName).toBe("Untitled_Resonance.v7.mp4");
  });

  it("failed encode does not remember an export name", async () => {
    const memory = emptyProjectFileMemory();
    const store = createMemoryProjectFileStore(memory);
    const outcome = await runExportWithDestination({
      job: jobFromProject(projectReady()),
      host: {},
      store,
      memory,
      encode: async (job) => ({
        success: false,
        aborted: false,
        error: "FAIL: empty",
        fileName: job.fileName,
        durationMs: job.durationMs,
        fileSizeBytes: 0,
      }),
      downloadMp4: () => {
        throw new Error("no download");
      },
    });
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.memory.lastExportFileName).toBeNull();
    expect((await store.load()).lastExportFileName).toBeNull();
  });

  it("download fallback also remembers the versioned name so the next export bumps", async () => {
    const memory = {
      ...emptyProjectFileMemory(),
      lastExportFileName: "Untitled_Resonance.mp4",
      lastExportFileNames: ["Untitled_Resonance.mp4"],
    };
    const store = createMemoryProjectFileStore(memory);
    const downloads: string[] = [];
    const outcome = await runExportWithDestination({
      job: jobFromProject(projectReady()),
      host: {},
      store,
      memory,
      encode: async (job) => successResult(job),
      downloadMp4: (result) => {
        downloads.push(result.fileName);
      },
    });
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.job.fileName).toBe("Untitled_Resonance.v2.mp4");
    expect(outcome.usedDownload).toBe(true);
    expect(downloads).toEqual(["Untitled_Resonance.v2.mp4"]);
    expect(outcome.memory.lastExportFileName).toBe("Untitled_Resonance.v2.mp4");
    expect(outcome.status).toContain("Untitled_Resonance.v2.mp4");
  });
});
