import { describe, expect, it } from "vitest";
import {
  dirFromPath,
  fileNameFromPath,
  joinDirAndFile,
  lastProjectMissingStatus,
  lastProjectPayload,
  normalizeLastProjectPath,
  parentFolderNameFromPath,
  parseLastProject,
  parseLastProjectText,
} from "../../src/core/last-project";
import { createEmptyProject, projectFilename, PROJECT_SCHEMA_VERSION } from "../../src/core/project";
import {
  autostartLastProject,
  mediaExtensionsForKind,
  sourcePathsOfAssets,
  tauriOpenProject,
  tauriSaveProject,
  versionedSaveDefaultPath,
  type TauriProjectFs,
} from "../../src/core/tauri-project-io";
import { isTauriRuntime } from "../../src/core/tauri-runtime";

function mockFs(overrides: Partial<TauriProjectFs> = {}): TauriProjectFs & {
  appWrites: Array<{ name: string; text: string }>;
} {
  const appWrites: Array<{ name: string; text: string }> = [];
  return {
    appWrites,
    async openDialog() {
      return null;
    },
    async saveDialog() {
      return null;
    },
    async readText() {
      throw new Error("not found");
    },
    async writeText() {
      throw new Error("write denied");
    },
    async exists() {
      return false;
    },
    async readAppDataText() {
      throw new Error("no last-project");
    },
    async writeAppDataText(name, text) {
      appWrites.push({ name, text });
    },
    async appDataExists() {
      return false;
    },
    ...overrides,
  };
}

describe("last-project path normalize", () => {
  it("normalizes Windows slash variants to backslash", () => {
    expect(normalizeLastProjectPath("C:/Users/marti/Song.resonance.json")).toBe(
      "C:\\Users\\marti\\Song.resonance.json",
    );
    expect(normalizeLastProjectPath("C:\\Users\\marti\\Song.resonance.json")).toBe(
      "C:\\Users\\marti\\Song.resonance.json",
    );
    expect(normalizeLastProjectPath("C:/Users//marti\\\\Song.resonance.json")).toBe(
      "C:\\Users\\marti\\Song.resonance.json",
    );
  });

  it("rejects empty and non-string paths", () => {
    expect(normalizeLastProjectPath("")).toBe("");
    expect(normalizeLastProjectPath("   ")).toBe("");
    expect(normalizeLastProjectPath(null)).toBe("");
    expect(normalizeLastProjectPath(undefined)).toBe("");
    expect(normalizeLastProjectPath(42)).toBe("");
    expect(normalizeLastProjectPath({ path: "C:\\x.json" })).toBe("");
  });

  it("parses last-project.json and never treats a handle as a path", () => {
    const parsed = parseLastProject({
      path: "C:/Users/marti/Live.resonance.json",
      name: "Live.resonance.json",
    });
    expect(parsed).toEqual({
      path: "C:\\Users\\marti\\Live.resonance.json",
      name: "Live.resonance.json",
    });
    expect(parseLastProject({ handle: {}, name: "x.json" })).toBeNull();
    expect(parseLastProjectText('{ "name": "x.json" }')).toBeNull();
    expect(parseLastProjectText("not-json")).toBeNull();
    expect(lastProjectPayload({ path: "C:/a/b.json", name: "ignored.json" })).toEqual({
      path: "C:\\a\\b.json",
      name: "ignored.json",
    });
    expect(fileNameFromPath("C:\\shows\\night.resonance.json")).toBe("night.resonance.json");
    expect(parentFolderNameFromPath("C:\\Users\\marti\\Projects\\Show.resonance.json")).toBe(
      "Projects",
    );
    expect(parentFolderNameFromPath("/home/marti/Mixes/Live.resonance.json")).toBe("Mixes");
    expect(parentFolderNameFromPath("C:\\Show.resonance.json")).toBe("");
    expect(parentFolderNameFromPath("/Show.resonance.json")).toBe("");
    expect(dirFromPath("C:\\Users\\marti\\Untitled_Resonance.resonance.json")).toBe(
      "C:\\Users\\marti",
    );
    expect(joinDirAndFile("C:\\Users\\marti", "Untitled_Resonance.v2.resonance.json")).toBe(
      "C:\\Users\\marti\\Untitled_Resonance.v2.resonance.json",
    );
    expect(dirFromPath("/home/marti/Show.resonance.json")).toBe("/home/marti");
    expect(joinDirAndFile("/home/marti", "Show.v1.resonance.json")).toBe(
      "/home/marti/Show.v1.resonance.json",
    );
  });

  it("missing-file status uses the project name, not a raw disk path", () => {
    const status = lastProjectMissingStatus("Show A.resonance.json");
    expect(status).toBe("Zuletzt: Show A.resonance.json — Datei nicht gefunden, Öffnen oder Relink");
    expect(status).not.toMatch(/C:\\/i);
  });
});

describe("autostart last-project", () => {
  it("returns missing status and does not write when the remembered file is gone", async () => {
    const fs = mockFs({
      async appDataExists() {
        return true;
      },
      async readAppDataText() {
        return JSON.stringify({
          path: "C:\\Users\\marti\\Gone.resonance.json",
          name: "Gone.resonance.json",
        });
      },
      async exists() {
        return false;
      },
    });
    const result = await autostartLastProject(fs);
    expect(result.kind).toBe("missing");
    if (result.kind === "missing") {
      expect(result.status).toBe(
        "Zuletzt: Gone.resonance.json — Datei nicht gefunden, Öffnen oder Relink",
      );
    }
    expect(fs.appWrites).toHaveLength(0);
  });

  it("loads JSON when the path exists and does not overwrite last-project", async () => {
    const fs = mockFs({
      async appDataExists() {
        return true;
      },
      async readAppDataText() {
        return JSON.stringify({
          path: "C:/Users/marti/From Disk.resonance.json",
          name: "From Disk.resonance.json",
        });
      },
      async exists() {
        return true;
      },
      async readText() {
        return JSON.stringify({
          version: 1,
          name: "From Disk",
          assets: [],
          scenes: [],
          timeline: { duration: 1, cues: [] },
        });
      },
    });
    const result = await autostartLastProject(fs);
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.ref.path).toBe("C:\\Users\\marti\\From Disk.resonance.json");
      expect(result.ref.name).toBe("From Disk.resonance.json");
      expect(JSON.parse(result.text).name).toBe("From Disk");
    }
    expect(fs.appWrites).toHaveLength(0);
  });
});

describe("tauri save/open last-path", () => {
  it("Speichern with lastPath writes without picker; Speichern unter always picks", async () => {
    let saveDialogCalls = 0;
    const writes: Array<{ path: string; text: string }> = [];
    const defaults: string[] = [];
    const fs = mockFs({
      async saveDialog(opts) {
        saveDialogCalls += 1;
        defaults.push(opts.defaultPath ?? "");
        expect(opts.defaultPath).toMatch(/\.v\d+\.resonance\.json$/);
        expect(opts.defaultPath).not.toMatch(/\(\d+\)/);
        return "C:/Users/marti/Projects/Other.resonance.json";
      },
      async writeText(path, text) {
        writes.push({ path, text });
      },
    });
    const project = createEmptyProject("Show");
    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    expect(projectFilename(project)).toBe("Show.resonance.json");
    expect(projectFilename(project)).not.toMatch(/\.\d+\.resonance\.json$/);
    const json = JSON.stringify({ schemaVersion: PROJECT_SCHEMA_VERSION, name: "Show" });

    const overwrite = await tauriSaveProject(fs, {
      json,
      filename: projectFilename(project),
      lastPath: "C:/Users/marti/Projects/Show.resonance.json",
    });
    expect(saveDialogCalls).toBe(0);
    expect("cancelled" in overwrite).toBe(false);
    if (!("cancelled" in overwrite)) {
      expect(overwrite.path).toBe("C:\\Users\\marti\\Projects\\Show.resonance.json");
      expect(overwrite.name).toBe("Show.resonance.json");
      expect(overwrite.status).toBe("Gespeichert: Show.resonance.json");
    }
    expect(writes[0]?.path).toBe("C:/Users/marti/Projects/Show.resonance.json");
    expect(JSON.parse(writes[0]?.text ?? "{}").schemaVersion).toBe(5);

    const saveAs = await tauriSaveProject(fs, {
      json,
      filename: projectFilename(project),
      lastPath: "C:/Users/marti/Projects/Show.resonance.json",
      forcePicker: true,
    });
    expect(saveDialogCalls).toBe(1);
    expect(defaults[0]).toBe("C:\\Users\\marti\\Projects\\Show.v2.resonance.json");
    expect("cancelled" in saveAs).toBe(false);
    if (!("cancelled" in saveAs)) {
      expect(saveAs.name).toBe("Other.resonance.json");
      expect(saveAs.path).toBe("C:\\Users\\marti\\Projects\\Other.resonance.json");
    }

    const firstSave = await tauriSaveProject(fs, {
      json,
      filename: "Untitled_Resonance.resonance.json",
    });
    expect(saveDialogCalls).toBe(2);
    expect(defaults[1]).toBe("Untitled_Resonance.v1.resonance.json");
    expect("cancelled" in firstSave).toBe(false);
    if (!("cancelled" in firstSave)) {
      expect(firstSave.name).toBe("Other.resonance.json");
    }
  });

  it("Speichern unter defaultPath is the next .vN beside the last project", async () => {
    expect(versionedSaveDefaultPath({ filename: "Untitled_Resonance.resonance.json" })).toBe(
      "Untitled_Resonance.v1.resonance.json",
    );
    expect(
      versionedSaveDefaultPath({
        filename: "Untitled_Resonance.resonance.json",
        lastPath: "C:\\Users\\marti\\Documents\\Untitled_Resonance.resonance.json",
      }),
    ).toBe("C:\\Users\\marti\\Documents\\Untitled_Resonance.v2.resonance.json");
    let defaultPath = "";
    const fs = mockFs({
      async saveDialog(opts) {
        defaultPath = opts.defaultPath ?? "";
        return defaultPath;
      },
      async writeText() {
        /* project json */
      },
    });
    const result = await tauriSaveProject(fs, {
      json: "{}",
      filename: "Untitled_Resonance.resonance.json",
      lastPath: "C:\\Users\\marti\\Documents\\Untitled_Resonance.resonance.json",
      forcePicker: true,
    });
    expect(defaultPath).toBe("C:\\Users\\marti\\Documents\\Untitled_Resonance.v2.resonance.json");
    expect(defaultPath).not.toMatch(/\(\d+\)/);
    expect("cancelled" in result).toBe(false);
  });

  it("writes last-project.json after a successful save", async () => {
    const fs = mockFs({
      async saveDialog() {
        return "C:/Users/marti/Show.resonance.json";
      },
      async writeText() {
        /* project json */
      },
    });
    const result = await tauriSaveProject(fs, {
      json: "{}",
      filename: "Show.resonance.json",
    });
    expect("cancelled" in result).toBe(false);
    if (!("cancelled" in result)) {
      expect(result.path).toBe("C:\\Users\\marti\\Show.resonance.json");
      expect(result.name).toBe("Show.resonance.json");
    }
    expect(fs.appWrites).toHaveLength(1);
    expect(fs.appWrites[0]?.name).toBe("last-project.json");
    expect(JSON.parse(fs.appWrites[0]?.text ?? "{}")).toEqual({
      path: "C:\\Users\\marti\\Show.resonance.json",
      name: "Show.resonance.json",
    });
  });

  it("writes last-project.json after a successful open", async () => {
    const fs = mockFs({
      async openDialog() {
        return "C:\\Users\\marti\\Open.resonance.json";
      },
      async readText() {
        return "{\"name\":\"Open\"}";
      },
    });
    const result = await tauriOpenProject(fs);
    expect("cancelled" in result).toBe(false);
    if (!("cancelled" in result)) {
      expect(result.path).toBe("C:\\Users\\marti\\Open.resonance.json");
      expect(result.name).toBe("Open.resonance.json");
    }
    expect(JSON.parse(fs.appWrites[0]?.text ?? "{}")).toEqual({
      path: "C:\\Users\\marti\\Open.resonance.json",
      name: "Open.resonance.json",
    });
  });
});

describe("sourcePath helpers", () => {
  it("collects non-empty sourcePath values and keeps media extension lists tight", () => {
    expect(
      sourcePathsOfAssets([
        { sourcePath: "C:\\Users\\marti\\a.mp4" },
        { sourcePath: "  " },
        {},
        { sourcePath: "C:\\Users\\marti\\b.wav" },
      ]),
    ).toEqual(["C:\\Users\\marti\\a.mp4", "C:\\Users\\marti\\b.wav"]);
    expect(mediaExtensionsForKind("video")).toContain("mp4");
    expect(mediaExtensionsForKind("audio")).toContain("wav");
    expect(mediaExtensionsForKind("audio")).not.toContain("zip");
    expect(mediaExtensionsForKind("image")).toContain("png");
    expect(mediaExtensionsForKind()).toContain("zip");
  });
});

describe("tauri runtime detect", () => {
  it("is false without __TAURI_INTERNALS__ so Chrome FSA stays the fallback", () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
  });
});
