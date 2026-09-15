import { describe, expect, it } from "vitest";
import {
  collectExistingExportNames,
  listDirectoryFileNames,
  probeExportSiblingNames,
  readyExportNameFromProjectAsync,
  resolveSuggestedExportFileName,
} from "../../src/core/exporter/export-name";
import { readyExportNameFromProject } from "../../src/core/exporter/filename-version";
import { readyExportDialog } from "../../src/core/exporter/dialog";
import {
  emptyProjectFileMemory,
  MAX_LAST_EXPORT_NAMES,
  normalizeProjectFileMemory,
  rememberExportFileName,
  rememberFileHandle,
  withExportFileName,
  type DirectoryHandleLike,
  type FileHandleLike,
} from "../../src/core/project-file";
import { createMemoryProjectFileStore } from "../../src/core/project-file-store";
import { DEFAULT_PROJECT_NAME } from "../../src/core/project";

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function dirWithValues(entries: Array<{ kind?: string; name?: string }>): DirectoryHandleLike {
  return {
    kind: "directory",
    name: "Documents",
    values: () => asyncIter(entries),
  };
}

describe("export default-name path (folder listing + memory)", () => {
  it("lists files from values(), skipping directories", async () => {
    const dir = dirWithValues([
      { kind: "file", name: "Untitled_Resonance.mp4" },
      { kind: "directory", name: "sub" },
      { kind: "file", name: "Untitled_Resonance.v6.mp4" },
      { name: "" },
      null as unknown as { kind?: string; name?: string },
    ]);
    expect(await listDirectoryFileNames(dir)).toEqual([
      "Untitled_Resonance.mp4",
      "Untitled_Resonance.v6.mp4",
    ]);
    expect(await listDirectoryFileNames(null)).toEqual([]);
  });

  it("falls back to entries() then keys() when values() is missing", async () => {
    const viaEntries: DirectoryHandleLike = {
      kind: "directory",
      entries: () =>
        asyncIter<[string, { kind?: string; name?: string }]>([
          ["Untitled_Resonance.v3.mp4", { kind: "file" }],
          ["folder", { kind: "directory" }],
          ["", { kind: "file" }],
        ]),
    };
    expect(await listDirectoryFileNames(viaEntries)).toEqual(["Untitled_Resonance.v3.mp4"]);

    const viaKeys: DirectoryHandleLike = {
      kind: "directory",
      keys: () => asyncIter(["clip.mp4", "", "clip.v2.mp4"]),
    };
    expect(await listDirectoryFileNames(viaKeys)).toEqual(["clip.mp4", "clip.v2.mp4"]);

    const emptyApi: DirectoryHandleLike = { kind: "directory", name: "Empty" };
    expect(await listDirectoryFileNames(emptyApi)).toEqual([]);
  });

  it("returns [] when listing throws or permission is denied", async () => {
    const exploding: DirectoryHandleLike = {
      values: () => {
        throw new Error("nope");
      },
    };
    expect(await listDirectoryFileNames(exploding)).toEqual([]);

    const denied: DirectoryHandleLike = {
      queryPermission: async () => "denied",
      requestPermission: async () => "denied",
      values: () => asyncIter([{ kind: "file", name: "x.mp4" }]),
    };
    expect(await listDirectoryFileNames(denied)).toEqual([]);

    const requestThrows: DirectoryHandleLike = {
      queryPermission: async () => "prompt",
      requestPermission: async () => {
        throw new Error("blocked");
      },
      values: () => asyncIter([{ kind: "file", name: "x.mp4" }]),
    };
    expect(await listDirectoryFileNames(requestThrows)).toEqual([]);
  });

  it("requests read permission when the handle is only prompt-able", async () => {
    const asked: string[] = [];
    const dir: DirectoryHandleLike = {
      queryPermission: async () => "prompt",
      requestPermission: async ({ mode } = {}) => {
        asked.push(mode ?? "");
        return "granted";
      },
      values: () => asyncIter([{ kind: "file", name: "Untitled_Resonance.v4.mp4" }]),
    };
    expect(await listDirectoryFileNames(dir)).toEqual(["Untitled_Resonance.v4.mp4"]);
    expect(asked).toEqual(["read"]);
  });

  it("probes Stem.ext plus .vN / _vN when values() is missing", async () => {
    const present = new Set([
      "Untitled_Resonance.mp4",
      "Untitled_Resonance.v3.mp4",
      "Untitled_Resonance_v4.mp4",
    ]);
    const dir: DirectoryHandleLike = {
      kind: "directory",
      getFileHandle: async (name) => {
        if (!present.has(name)) throw new Error("missing");
        return { name, kind: "file" };
      },
    };
    expect(await probeExportSiblingNames(dir, "Untitled_Resonance.mp4")).toEqual([
      "Untitled_Resonance.mp4",
      "Untitled_Resonance.v3.mp4",
      "Untitled_Resonance_v4.mp4",
    ]);
    expect(await probeExportSiblingNames(null, "Untitled_Resonance.mp4")).toEqual([]);
    expect(await probeExportSiblingNames({ kind: "directory" }, "Untitled_Resonance.mp4")).toEqual(
      [],
    );
    const deniedProbe: DirectoryHandleLike = {
      queryPermission: async () => "denied",
      requestPermission: async () => "denied",
      getFileHandle: async (name) => ({ name, kind: "file" }),
    };
    expect(await probeExportSiblingNames(deniedProbe, "Untitled_Resonance.mp4")).toEqual([]);
  });

  it("lists when queryPermission already granted, and swallows values() iteration errors", async () => {
    const granted: DirectoryHandleLike = {
      queryPermission: async () => "granted",
      values: () => asyncIter([{ kind: "file", name: "ok.mp4" }]),
    };
    expect(await listDirectoryFileNames(granted)).toEqual(["ok.mp4"]);

    const midThrow: DirectoryHandleLike = {
      values: () => ({
        async *[Symbol.asyncIterator]() {
          yield { kind: "file", name: "a.mp4" };
          throw new Error("broken iterator");
        },
      }),
    };
    expect(await listDirectoryFileNames(midThrow)).toEqual([]);
  });

  it("collects memory names + listing, and probes when listing is empty", async () => {
    const listed = dirWithValues([
      { kind: "file", name: "Untitled_Resonance.v5.mp4" },
      { kind: "file", name: "Untitled_Resonance.v6.mp4" },
    ]);
    const memory = {
      ...emptyProjectFileMemory(),
      lastExportFileName: "Untitled_Resonance.v4.mp4",
      lastExportFileNames: ["Untitled_Resonance.v4.mp4"],
      directoryHandle: listed,
    };
    expect(await collectExistingExportNames(memory, "Untitled_Resonance.mp4")).toEqual([
      "Untitled_Resonance.v4.mp4",
      "Untitled_Resonance.v5.mp4",
      "Untitled_Resonance.v6.mp4",
    ]);

    const present = new Set(["Untitled_Resonance.mp4"]);
    const probeOnly: DirectoryHandleLike = {
      getFileHandle: async (name) => {
        if (!present.has(name)) throw new Error("missing");
        return { name, kind: "file" };
      },
    };
    const probedMemory = { ...emptyProjectFileMemory(), directoryHandle: probeOnly };
    expect(await collectExistingExportNames(probedMemory, "Untitled_Resonance.mp4")).toContain(
      "Untitled_Resonance.mp4",
    );
    expect(await collectExistingExportNames(emptyProjectFileMemory())).toEqual([]);
  });

  it("resolveSuggestedExportFileName uses injected listing or the remembered folder", async () => {
    const memory = withExportFileName(emptyProjectFileMemory(), "Untitled_Resonance.mp4");
    expect(
      await resolveSuggestedExportFileName({
        proposed: "Untitled_Resonance.mp4",
        memory,
        listedNames: ["Untitled_Resonance.v3.mp4", "Untitled_Resonance.v6.mp4"],
      }),
    ).toBe("Untitled_Resonance.v7.mp4");

    const dir = dirWithValues([{ kind: "file", name: "Untitled_Resonance.mp4" }]);
    expect(
      await resolveSuggestedExportFileName({
        proposed: "Untitled_Resonance.mp4",
        memory: { ...emptyProjectFileMemory(), directoryHandle: dir },
      }),
    ).toBe("Untitled_Resonance.v2.mp4");
  });

  it("ready dialog default name is .v1 when the folder listing is empty", async () => {
    const fileName = await readyExportNameFromProjectAsync({
      projectName: DEFAULT_PROJECT_NAME,
      memory: emptyProjectFileMemory(),
    });
    expect(fileName).toBe("Untitled_Resonance.v1.mp4");
  });

  it("ready dialog default name is the next .vN (async path + dialog state)", async () => {
    const listed = [
      "Untitled_Resonance.mp4",
      "Untitled_Resonance.v3.mp4",
      "Untitled_Resonance.v4.mp4",
      "Untitled_Resonance.v5.mp4",
      "Untitled_Resonance.v6.mp4",
    ];
    const fileName = await readyExportNameFromProjectAsync({
      projectName: DEFAULT_PROJECT_NAME,
      memory: emptyProjectFileMemory(),
      listedNames: listed,
    });
    expect(fileName).toBe("Untitled_Resonance.v7.mp4");
    expect(readyExportNameFromProject(DEFAULT_PROJECT_NAME, emptyProjectFileMemory(), listed)).toBe(
      fileName,
    );
    const dialog = readyExportDialog({ fileName });
    expect(dialog.phase).toBe("ready");
    expect(dialog.fileName).toBe("Untitled_Resonance.v7.mp4");

    const fromFolder = await readyExportNameFromProjectAsync({
      projectName: DEFAULT_PROJECT_NAME,
      memory: {
        ...emptyProjectFileMemory(),
        directoryHandle: dirWithValues(listed.map((name) => ({ kind: "file", name }))),
      },
    });
    expect(fromFolder).toBe("Untitled_Resonance.v7.mp4");
  });

  it("persists last export names without dropping them on project-handle remember", async () => {
    const store = createMemoryProjectFileStore();
    let memory = emptyProjectFileMemory();
    memory = await rememberExportFileName(store, memory, "Untitled_Resonance.mp4");
    expect(memory.lastExportFileName).toBe("Untitled_Resonance.mp4");
    expect(memory.lastExportFileNames).toEqual(["Untitled_Resonance.mp4"]);
    memory = await rememberExportFileName(store, memory, "Untitled_Resonance.v2.mp4");
    expect(memory.lastExportFileName).toBe("Untitled_Resonance.v2.mp4");
    expect(memory.lastExportFileNames[0]).toBe("Untitled_Resonance.v2.mp4");

    const projectHandle: FileHandleLike = {
      name: "Song.resonance.json",
      kind: "file",
      getParent: async () => ({ kind: "directory", name: "Documents" }),
    };
    const afterSave = await rememberFileHandle(store, projectHandle, memory);
    expect(afterSave.lastExportFileName).toBe("Untitled_Resonance.v2.mp4");
    expect(afterSave.lastFileName).toBe("Song.resonance.json");
    expect(afterSave.lastExportFileNames).toContain("Untitled_Resonance.mp4");

    expect(withExportFileName(memory, "   ")).toEqual(normalizeProjectFileMemory(memory));
    const many = {
      lastExportFileName: "keep.mp4",
      lastExportFileNames: Array.from({ length: MAX_LAST_EXPORT_NAMES + 4 }, (_, i) => `n${i}.mp4`),
    };
    expect(normalizeProjectFileMemory(many).lastExportFileNames).toHaveLength(MAX_LAST_EXPORT_NAMES);
    expect(normalizeProjectFileMemory(null).lastExportFileNames).toEqual([]);
    expect(normalizeProjectFileMemory({ lastExportFileName: "  " }).lastExportFileName).toBeNull();
  });
});
