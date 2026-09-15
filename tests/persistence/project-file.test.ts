import { describe, expect, it } from "vitest";
import { downloadText } from "../../src/core/project";
import {
  emptyProjectFileMemory,
  hasFileSystemAccess,
  loadStatusFallback,
  loadStatusFsa,
  openPickerOptions,
  pickRelinkMediaFile,
  relinkAcceptAttr,
  projectPanelView,
  rememberDirectoryHandle,
  rememberFileHandle,
  rememberTauriProjectPath,
  runChooseFolder,
  runOpen,
  runOpenRecent,
  resolveSavePicker,
  runSave,
  runSaveAs,
  savePickerOptions,
  saveStatusFallback,
  saveStatusFsa,
  startInForPicker,
  statusHasFakePath,
  suggestedProjectPickerName,
  type DirectoryHandleLike,
  type FileHandleLike,
  type PickerHost,
  type SavePickerOptions,
} from "../../src/core/project-file";
import { createMemoryProjectFileStore } from "../../src/core/project-file-store";

function mockFileHandle(name: string, extras: Partial<FileHandleLike> = {}): FileHandleLike {
  const written: string[] = [];
  return {
    name,
    kind: "file",
    createWritable: async () => ({
      write: async (data) => {
        written.push(typeof data === "string" ? data : await data.text());
      },
      close: async () => {},
    }),
    getFile: async () => {
      const body = `{"name":"${name}"}`;
      const file = new File([body], name, { type: "application/json" });
      if (typeof file.text !== "function") {
        return Object.assign(file, { text: async () => body });
      }
      return file;
    },
    queryPermission: async () => "granted",
    ...extras,
    // expose writes for asserts when not overwritten
    ...(extras.createWritable ? {} : {}),
  };
}

describe("project file picker memory", () => {
  it("first run startIn is documents, then the remembered directory", async () => {
    const empty = emptyProjectFileMemory();
    expect(startInForPicker(empty)).toBe("documents");
    expect(savePickerOptions("Song.resonance.json", empty).startIn).toBe("documents");
    expect(openPickerOptions(empty).startIn).toBe("documents");

    const dir: DirectoryHandleLike = { kind: "directory", name: "Projects" };
    const file = mockFileHandle("Song.resonance.json", {
      getParent: async () => dir,
    });
    const store = createMemoryProjectFileStore();
    const memory = await rememberFileHandle(store, file);
    expect(memory.lastFileName).toBe("Song.resonance.json");
    expect(startInForPicker(memory)).toBe(dir);
    expect(savePickerOptions("Song.resonance.json", memory).startIn).toBe(dir);
    expect(openPickerOptions(memory).startIn).toBe(dir);
  });

  it("save/open helpers pass startIn on the next picker", async () => {
    const dir: DirectoryHandleLike = { kind: "directory", name: "Studio" };
    const store = createMemoryProjectFileStore();
    let saveOpts: SavePickerOptions | undefined;
    const file = mockFileHandle("Mix.resonance.json", { getParent: async () => dir });
    const host: PickerHost = {
      showSaveFilePicker: async (opts) => {
        saveOpts = opts;
        return file;
      },
      showOpenFilePicker: async (opts) => {
        expect(opts.startIn).toBe(dir);
        return [file];
      },
    };
    const first = await runSave({
      host,
      store,
      memory: emptyProjectFileMemory(),
      filename: "Mix.resonance.json",
      json: '{"ok":true}',
      fallbackDownload: () => {
        throw new Error("should use FSA");
      },
    });
    expect(saveOpts?.startIn).toBe("documents");
    expect(first.status).toBe(saveStatusFsa("Mix.resonance.json"));
    expect(first.status).toContain("Mix.resonance.json");
    expect(first.usedFallback).toBe(false);
    expect(startInForPicker(first.memory)).toBe(dir);

    const opened = await runOpen({ host, store, memory: first.memory });
    expect(opened.kind).toBe("opened");
    if (opened.kind === "opened") {
      expect(opened.status).toBe(loadStatusFsa("Mix.resonance.json"));
      expect(opened.status).toContain("Mix.resonance.json");
      expect(opened.fileName).toBe("Mix.resonance.json");
    }
  });

  it("UI status includes the file name after save and after load", () => {
    expect(saveStatusFsa("Beginagain.resonance.json")).toContain("Beginagain.resonance.json");
    expect(loadStatusFsa("Beginagain.resonance.json")).toContain("Beginagain.resonance.json");
    expect(saveStatusFsa("Beginagain.resonance.json")).toMatch(/gemerkt/);
  });

  it("fallback path does not claim a fake filesystem path", async () => {
    const downloads: string[] = [];
    const result = await runSave({
      host: {},
      store: createMemoryProjectFileStore(),
      memory: emptyProjectFileMemory(),
      filename: "Untitled_Resonance.resonance.json",
      json: "{}",
      fallbackDownload: (name, text) => {
        downloads.push(`${name}:${text}`);
      },
    });
    expect(hasFileSystemAccess({})).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.status).toBe(saveStatusFallback("Untitled_Resonance.v1.resonance.json"));
    expect(result.status).toContain("Untitled_Resonance.v1.resonance.json");
    expect(result.status).toMatch(/Downloads/);
    expect(result.status).toMatch(/unbekannt/);
    expect(statusHasFakePath(result.status)).toBe(false);
    expect(statusHasFakePath(loadStatusFallback("clip.resonance.json"))).toBe(false);
    expect(loadStatusFallback("clip.resonance.json")).toContain("clip.resonance.json");
    expect(downloads[0]).toContain("Untitled_Resonance.v1.resonance.json");
    expect(typeof downloadText).toBe("function");
  });

  it("recents store round-trips file and directory handles", async () => {
    const dir: DirectoryHandleLike = { kind: "directory", name: "Mixes" };
    const fileA = mockFileHandle("A.resonance.json", { getParent: async () => dir });
    const fileB = mockFileHandle("B.resonance.json", { getParent: async () => dir });
    const store = createMemoryProjectFileStore();
    const first = await rememberFileHandle(store, fileA);
    expect(first.recents).toHaveLength(1);
    expect(first.recents[0].fileHandle).toBe(fileA);
    expect(first.recents[0].directoryHandle).toBe(dir);
    expect(first.recents[0].lastFileName).toBe("A.resonance.json");

    const loaded = await store.load();
    expect(loaded.recents[0].fileHandle).toBe(fileA);
    expect(loaded.recents[0].directoryHandle).toBe(dir);
    expect(loaded.lastFileName).toBe("A.resonance.json");

    const second = await rememberFileHandle(store, fileB, loaded);
    expect(second.recents.map((row) => row.lastFileName)).toEqual([
      "B.resonance.json",
      "A.resonance.json",
    ]);
    expect(second.recents[0].fileHandle).toBe(fileB);
    expect(second.recents[1].fileHandle).toBe(fileA);
    expect((await store.load()).recents[1].directoryHandle).toBe(dir);
  });

  it("panel view shows last file and folder name, never a fake Windows path", () => {
    const named = projectPanelView({
      fileHandle: mockFileHandle("Song.resonance.json"),
      directoryHandle: { kind: "directory", name: "Projects" },
      lastFileName: "Song.resonance.json",
      recents: [],
    });
    expect(named.fileName).toBe("Song.resonance.json");
    expect(named.folderLabel).toBe("Projects");
    expect(named.folderRemembered).toBe(true);
    expect(statusHasFakePath(named.fileName)).toBe(false);
    expect(statusHasFakePath(named.folderLabel)).toBe(false);
    expect(named.folderLabel).not.toMatch(/C:\\Users/);
    expect(named.folderLabel).not.toMatch(/\/Users\//);

    const unnamedDir = projectPanelView({
      fileHandle: mockFileHandle("Song.resonance.json"),
      directoryHandle: { kind: "directory" },
      lastFileName: "Song.resonance.json",
      recents: [],
    });
    expect(unnamedDir.folderLabel).toBe("Song.resonance.json — Ordner gemerkt");
    expect(statusHasFakePath(unnamedDir.folderLabel)).toBe(false);
    expect(unnamedDir.folderLabel).not.toMatch(/C:\\/);
  });

  it("Tauri lastPath is remembered without FSA handles and never shows a disk path", () => {
    const remembered = rememberTauriProjectPath(
      "C:/Users/marti/Projects/Show.resonance.json",
      "Show.resonance.json",
    );
    expect(remembered.fileHandle).toBeNull();
    expect(remembered.directoryHandle).toBeNull();
    expect(remembered.lastFileName).toBe("Show.resonance.json");
    expect(remembered.lastPath).toBe("C:\\Users\\marti\\Projects\\Show.resonance.json");

    const named = projectPanelView(remembered);
    expect(named.fileName).toBe("Show.resonance.json");
    expect(named.folderLabel).toBe("Projects");
    expect(named.folderRemembered).toBe(true);
    expect(statusHasFakePath(named.fileName)).toBe(false);
    expect(statusHasFakePath(named.folderLabel)).toBe(false);
    expect(named.folderLabel).not.toMatch(/C:\\/);
    expect(named.folderLabel).not.toMatch(/\/Users\//);

    const driveRoot = projectPanelView(
      rememberTauriProjectPath("C:\\Show.resonance.json", "Show.resonance.json"),
    );
    expect(driveRoot.fileName).toBe("Show.resonance.json");
    expect(driveRoot.folderLabel).toBe("Show.resonance.json — Pfad gemerkt");
    expect(driveRoot.folderRemembered).toBe(true);
    expect(statusHasFakePath(driveRoot.folderLabel)).toBe(false);

    const empty = projectPanelView(emptyProjectFileMemory());
    expect(empty.fileName).toBe("Noch nicht gespeichert");
    expect(empty.folderLabel).toBe("Kein Ordner gemerkt");
    expect(empty.folderRemembered).toBe(false);
  });

  it("save picker types are Chromium-valid .json only", () => {
    const opts = savePickerOptions("Untitled_Resonance.resonance.json", emptyProjectFileMemory());
    expect(opts.suggestedName).toBe("Untitled_Resonance.resonance.json");
    expect(opts.types).toEqual([
      { description: "Resonance project", accept: { "application/json": [".json"] } },
    ]);
  });

  it("Speichern unter invokes showSaveFilePicker when present; download only when missing", async () => {
    const store = createMemoryProjectFileStore();
    const picked = mockFileHandle("chosen.json");
    let saveCalls = 0;
    const downloads: string[] = [];
    const host: PickerHost = {
      showSaveFilePicker: async (opts) => {
        saveCalls += 1;
        expect(opts.types).toEqual([
          { description: "Resonance project", accept: { "application/json": [".json"] } },
        ]);
        expect(opts.suggestedName).toBe("Untitled_Resonance.v1.resonance.json");
        return picked;
      },
    };
    const savedAs = await runSaveAs({
      host,
      store,
      memory: emptyProjectFileMemory(),
      filename: "Untitled_Resonance.resonance.json",
      json: "{}",
      fallbackDownload: () => {
        throw new Error("must not download when picker exists");
      },
    });
    expect(saveCalls).toBe(1);
    expect(savedAs.usedFallback).toBe(false);
    expect(savedAs.memory.fileHandle).toBe(picked);

    const w = window as unknown as { showSaveFilePicker?: unknown };
    const previous = w.showSaveFilePicker;
    delete w.showSaveFilePicker;
    try {
      const fallback = await runSaveAs({
        host: {},
        store,
        memory: emptyProjectFileMemory(),
        filename: "Untitled_Resonance.resonance.json",
        json: "{}",
        fallbackDownload: (name) => {
          downloads.push(name);
        },
      });
      expect(fallback.usedFallback).toBe(true);
      expect(downloads).toEqual(["Untitled_Resonance.v1.resonance.json"]);
    } finally {
      if (previous) w.showSaveFilePicker = previous;
    }
  });

  it("Speichern unter suggestedName is .vN, never Windows (2)", async () => {
    expect(suggestedProjectPickerName("Untitled_Resonance.resonance.json", emptyProjectFileMemory())).toBe(
      "Untitled_Resonance.v1.resonance.json",
    );
    const memory = {
      ...emptyProjectFileMemory(),
      lastFileName: "Untitled_Resonance.resonance.json",
    };
    expect(suggestedProjectPickerName("Untitled_Resonance.resonance.json", memory)).toBe(
      "Untitled_Resonance.v2.resonance.json",
    );
    let suggested = "";
    const host: PickerHost = {
      showSaveFilePicker: async (opts) => {
        suggested = opts.suggestedName;
        expect(opts.suggestedName).not.toMatch(/\(\d+\)/);
        return mockFileHandle(opts.suggestedName);
      },
    };
    await runSaveAs({
      host,
      store: createMemoryProjectFileStore(),
      memory,
      filename: "Untitled_Resonance.resonance.json",
      json: "{}",
      fallbackDownload: () => {
        throw new Error("picker exists");
      },
    });
    expect(suggested).toBe("Untitled_Resonance.v2.resonance.json");
  });

  it("Speichern unter uses live window.showSaveFilePicker when the host snapshot is empty", async () => {
    const store = createMemoryProjectFileStore();
    const picked = mockFileHandle("from-window.json");
    let saveCalls = 0;
    const w = window as unknown as {
      showSaveFilePicker?: (opts: SavePickerOptions) => Promise<FileHandleLike>;
    };
    const previous = w.showSaveFilePicker;
    w.showSaveFilePicker = async () => {
      saveCalls += 1;
      return picked;
    };
    try {
      expect(typeof resolveSavePicker({})).toBe("function");
      const result = await runSaveAs({
        host: {},
        store,
        memory: emptyProjectFileMemory(),
        filename: "Untitled_Resonance.resonance.json",
        json: "{}",
        fallbackDownload: () => {
          throw new Error("live window picker must win over download");
        },
      });
      expect(saveCalls).toBe(1);
      expect(result.usedFallback).toBe(false);
      expect(result.memory.fileHandle).toBe(picked);
    } finally {
      if (previous) w.showSaveFilePicker = previous;
      else delete w.showSaveFilePicker;
    }
  });

  it("Speichern unter always opens the picker; Speichern may overwrite a granted handle", async () => {
    const dir: DirectoryHandleLike = { kind: "directory", name: "Studio" };
    const store = createMemoryProjectFileStore();
    const existing = mockFileHandle("Old.resonance.json", { getParent: async () => dir });
    const renamed = mockFileHandle("Renamed.resonance.json", { getParent: async () => dir });
    let saveCalls = 0;
    const host: PickerHost = {
      showSaveFilePicker: async () => {
        saveCalls += 1;
        return renamed;
      },
      showOpenFilePicker: async () => [renamed],
    };
    const remembered = await rememberFileHandle(store, existing);

    const overwritten = await runSave({
      host,
      store,
      memory: remembered,
      filename: "Old.resonance.json",
      json: "{}",
      fallbackDownload: () => {
        throw new Error("plain save should reuse the granted handle");
      },
    });
    expect(saveCalls).toBe(0);
    expect(overwritten.usedFallback).toBe(false);
    expect(overwritten.memory.fileHandle).toBe(existing);
    expect(overwritten.status).toBe(saveStatusFsa("Old.resonance.json"));

    const savedAs = await runSaveAs({
      host,
      store,
      memory: remembered,
      filename: "Renamed.resonance.json",
      json: "{}",
      fallbackDownload: () => {
        throw new Error("save-as must open the picker, not download");
      },
    });
    expect(saveCalls).toBe(1);
    expect(savedAs.usedFallback).toBe(false);
    expect(savedAs.memory.fileHandle).toBe(renamed);
    expect(savedAs.memory.lastFileName).toBe("Renamed.resonance.json");
  });

  it("Speichern unter and Öffnen pass startIn the last directory", async () => {
    const dir: DirectoryHandleLike = { kind: "directory", name: "Studio" };
    const store = createMemoryProjectFileStore();
    const existing = mockFileHandle("Old.resonance.json", { getParent: async () => dir });
    const next = mockFileHandle("New.resonance.json", { getParent: async () => dir });
    let saveOpts: SavePickerOptions | undefined;
    let saveCalls = 0;
    const host: PickerHost = {
      showSaveFilePicker: async (opts) => {
        saveCalls += 1;
        saveOpts = opts;
        return next;
      },
      showOpenFilePicker: async (opts) => {
        expect(opts.startIn).toBe(dir);
        return [next];
      },
    };
    const remembered = await rememberFileHandle(store, existing);
    const savedAs = await runSaveAs({
      host,
      store,
      memory: remembered,
      filename: "New.resonance.json",
      json: "{}",
      fallbackDownload: () => {
        throw new Error("should use FSA");
      },
    });
    expect(saveCalls).toBe(1);
    expect(saveOpts?.startIn).toBe(dir);
    expect(savedAs.memory.lastFileName).toBe("New.resonance.json");
    expect(startInForPicker(savedAs.memory)).toBe(dir);

    const opened = await runOpen({ host, store, memory: savedAs.memory });
    expect(opened.kind).toBe("opened");
  });

  it("Ordner wählen stores the directory handle for the next picker", async () => {
    const dir: DirectoryHandleLike = { kind: "directory", name: "Resonance" };
    const store = createMemoryProjectFileStore();
    const host: PickerHost = {
      showDirectoryPicker: async (opts) => {
        expect(opts.startIn).toBe("documents");
        return dir;
      },
    };
    const picked = await runChooseFolder({
      host,
      store,
      memory: emptyProjectFileMemory(),
    });
    expect(picked.memory.directoryHandle).toBe(dir);
    expect(picked.status).toContain("Resonance");
    expect(statusHasFakePath(picked.status)).toBe(false);
    expect(startInForPicker(picked.memory)).toBe(dir);
    const again = await rememberDirectoryHandle(store, dir, picked.memory);
    expect(again.directoryHandle).toBe(dir);
  });

  it("opening a recent reuses the stored file handle", async () => {
    const dir: DirectoryHandleLike = { kind: "directory", name: "Recents" };
    const file = mockFileHandle("Live.resonance.json", { getParent: async () => dir });
    const store = createMemoryProjectFileStore();
    const memory = await rememberFileHandle(store, file);
    const opened = await runOpenRecent({ store, memory, recent: memory.recents[0] });
    expect(opened.kind).toBe("opened");
    if (opened.kind === "opened") {
      expect(opened.fileName).toBe("Live.resonance.json");
      expect(opened.memory.fileHandle).toBe(file);
      expect(startInForPicker(opened.memory)).toBe(dir);
    }
  });

  it("relink picker cancel is AbortError and names no path", async () => {
    expect(relinkAcceptAttr("video")).toBe("video/*");
    expect(relinkAcceptAttr("audio")).toBe("audio/*");
    expect(relinkAcceptAttr("image")).toBe("image/*");
    const host: PickerHost = {
      showOpenFilePicker: async () => {
        const err = new Error("The user aborted a request.");
        err.name = "AbortError";
        throw err;
      },
    };
    const result = await pickRelinkMediaFile({
      host,
      memory: emptyProjectFileMemory(),
      kind: "video",
    });
    expect(result).toEqual({ kind: "cancelled" });
  });
});
