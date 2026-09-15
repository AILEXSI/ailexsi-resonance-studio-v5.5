import { describe, expect, it } from "vitest";
import {
  existingExportNamesFromMemory,
  existingProjectNamesFromMemory,
  formatExportFileName,
  mediaExportFileName,
  nextVersionedFileName,
  parseExportFileName,
  readyExportNameFromProject,
  sanitizeMediaExportStem,
  splitNameAndExt,
  suggestedProjectSaveAsName,
} from "../../src/core/exporter/filename-version";
import { emptyProjectFileMemory, withExportFileName } from "../../src/core/project-file";
import { DEFAULT_PROJECT_NAME, PROJECT_FILE_SUFFIX, projectFilename } from "../../src/core/project";
import { jobFromProject } from "../../src/core/exporter/job";
import { asset, clip, projectWith } from "../helpers";

function untitledProject() {
  return {
    ...projectWith(
      [clip({ id: "c1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "a1", kind: "video", durationMs: 1000, objectUrl: "blob:test", missing: false })],
    ),
    name: DEFAULT_PROJECT_NAME,
  };
}

describe("export filename versioning helper", () => {
  it("never suggests an unversioned name — empty folder is .v1", () => {
    expect(nextVersionedFileName("Untitled_Resonance.mp4", [])).toBe("Untitled_Resonance.v1.mp4");
    expect(formatExportFileName("Untitled_Resonance", 1, "mp4")).toBe("Untitled_Resonance.v1.mp4");
    expect(formatExportFileName("Untitled_Resonance", null, "mp4")).toBe("Untitled_Resonance.mp4");
    expect(formatExportFileName("Untitled_Resonance", 2, "mp4")).toBe("Untitled_Resonance.v2.mp4");
  });

  it("unversioned Stem.ext occupies v1 so the next suggestion is .v2", () => {
    expect(nextVersionedFileName("Untitled_Resonance.mp4", ["Untitled_Resonance.mp4"])).toBe(
      "Untitled_Resonance.v2.mp4",
    );
    expect(nextVersionedFileName("Untitled_Resonance.mp4", ["Untitled_Resonance.v1.mp4"])).toBe(
      "Untitled_Resonance.v2.mp4",
    );
  });

  it("picks the next free integer after the highest .vN / _vN for the same stem", () => {
    const folder = [
      "Untitled_Resonance.mp4",
      "Untitled_Resonance.v3.mp4",
      "Untitled_Resonance.v4.mp4",
      "Untitled_Resonance.v5.mp4",
      "Untitled_Resonance.v6.mp4",
      "Untitled_Resonance.short.mp4",
      "Untitled_Resonance.temp.mp4",
      "Untitled_Resonance (1).mp4",
    ];
    expect(nextVersionedFileName("Untitled_Resonance.mp4", folder)).toBe("Untitled_Resonance.v7.mp4");
  });

  it("does not fill gaps and treats _vN as the same series", () => {
    expect(
      nextVersionedFileName("Untitled_Resonance.mp4", [
        "Untitled_Resonance.v3.mp4",
        "Untitled_Resonance_v5.mp4",
      ]),
    ).toBe("Untitled_Resonance.v6.mp4");
  });

  it("if the stem already ends with .vN / _vN, increments to the next free in that folder", () => {
    expect(
      nextVersionedFileName("Untitled_Resonance.v5.mp4", [
        "Untitled_Resonance.v3.mp4",
        "Untitled_Resonance.v5.mp4",
        "Untitled_Resonance_v6.mp4",
      ]),
    ).toBe("Untitled_Resonance.v7.mp4");
    expect(nextVersionedFileName("Show_v4.wav", ["Show_v4.wav", "Show.v4.wav"])).toBe("Show.v5.wav");
  });

  it("keeps a free versioned stem when the folder has no siblings", () => {
    expect(nextVersionedFileName("Untitled_Resonance.v5.mp4", [])).toBe("Untitled_Resonance.v5.mp4");
    expect(nextVersionedFileName("Untitled_Resonance.v5.mp4", ["Other.mp4"])).toBe(
      "Untitled_Resonance.v5.mp4",
    );
  });

  it("scopes by folder via the names list only — same stem in another folder is invisible", () => {
    const documents = ["Untitled_Resonance.mp4", "Untitled_Resonance.v6.mp4"];
    const emptyExports: string[] = [];
    expect(nextVersionedFileName("Untitled_Resonance.mp4", documents)).toBe(
      "Untitled_Resonance.v7.mp4",
    );
    expect(nextVersionedFileName("Untitled_Resonance.mp4", emptyExports)).toBe(
      "Untitled_Resonance.v1.mp4",
    );
  });

  it("keeps the extension and ignores other extensions / stems", () => {
    expect(
      nextVersionedFileName("Untitled_Resonance.mp4", [
        "Untitled_Resonance.wav",
        "Untitled_Resonance.v9.wav",
        "Other.mp4",
        "Untitled_Resonance.v2.webm",
      ]),
    ).toBe("Untitled_Resonance.v1.mp4");
    expect(
      nextVersionedFileName("Untitled_Resonance.wav", [
        "Untitled_Resonance.mp4",
        "Untitled_Resonance.v4.mp4",
        "Untitled_Resonance.wav",
      ]),
    ).toBe("Untitled_Resonance.v2.wav");
  });

  it("matches case-insensitively and keeps the proposed stem/ext casing", () => {
    expect(
      nextVersionedFileName("Untitled_Resonance.MP4", [
        "untitled_resonance.mp4",
        "UNTITLED_RESONANCE.V3.MP4",
      ]),
    ).toBe("Untitled_Resonance.v4.MP4");
  });

  it("treats a lone .v0 sibling as occupied and still suggests .v1 if free", () => {
    expect(nextVersionedFileName("clip.mp4", ["clip.v0.mp4"])).toBe("clip.v1.mp4");
  });

  it("skips an occupied .vN candidate and never invents Windows (1) suffixes", () => {
    const names = ["clip.mp4", "clip.v2.mp4", "clip.v3.mp4"];
    expect(nextVersionedFileName("clip.mp4", names)).toBe("clip.v4.mp4");
    expect(nextVersionedFileName("clip.mp4", names)).not.toMatch(/\(\d+\)/);
  });

  it("trims empty / odd proposed names and ignores junk existing rows", () => {
    expect(nextVersionedFileName("   ", [])).toBe("untitled.v1.mp4");
    expect(nextVersionedFileName("", ["", "  ", "clip.mp4"])).toBe("untitled.v1.mp4");
    expect(nextVersionedFileName("solo", [])).toBe("solo.v1");
    expect(nextVersionedFileName("Untitled_Resonance.v7", [])).toBe("Untitled_Resonance.v7");
  });

  it("parses stems, dotted versions, compound .resonance.json, and version-looking extensions", () => {
    expect(splitNameAndExt("Untitled_Resonance.v6.mp4")).toEqual({
      stem: "Untitled_Resonance.v6",
      ext: "mp4",
    });
    expect(splitNameAndExt("Untitled_Resonance.v1.resonance.json")).toEqual({
      stem: "Untitled_Resonance.v1",
      ext: "resonance.json",
    });
    expect(splitNameAndExt("Untitled_Resonance.resonance.json")).toEqual({
      stem: "Untitled_Resonance",
      ext: "resonance.json",
    });
    expect(splitNameAndExt(".hidden")).toEqual({ stem: ".hidden", ext: "" });
    expect(splitNameAndExt("Untitled_Resonance.v7")).toEqual({
      stem: "Untitled_Resonance.v7",
      ext: "",
    });
    expect(parseExportFileName("Untitled_Resonance.v6.mp4")).toEqual({
      baseStem: "Untitled_Resonance",
      version: 6,
      ext: "mp4",
    });
    expect(parseExportFileName("Untitled_Resonance.v1.resonance.json")).toEqual({
      baseStem: "Untitled_Resonance",
      version: 1,
      ext: "resonance.json",
    });
    expect(parseExportFileName("Untitled_Resonance_v2.mp4")).toEqual({
      baseStem: "Untitled_Resonance",
      version: 2,
      ext: "mp4",
    });
    expect(parseExportFileName("v7.mp4")).toEqual({
      baseStem: "v7",
      version: null,
      ext: "mp4",
    });
    expect(parseExportFileName("file.version.mp4")).toEqual({
      baseStem: "file.version",
      version: null,
      ext: "mp4",
    });
    expect(formatExportFileName("", 3, "")).toBe("untitled.v3");
    expect(parseExportFileName("untitled.v9007199254740992.mp4").version).toBeNull();
  });

  it("sanitizes the project title the same way jobFromProject does", () => {
    expect(sanitizeMediaExportStem("???")).toBe("_");
    expect(sanitizeMediaExportStem("Untitled Resonance")).toBe("Untitled_Resonance");
    expect(mediaExportFileName(DEFAULT_PROJECT_NAME)).toBe("Untitled_Resonance.mp4");
    expect(mediaExportFileName("Show.mp4")).toBe("Show_mp4.mp4");
    expect(mediaExportFileName("Show", "wav")).toBe("Show.wav");
    expect(mediaExportFileName("", ".mp4")).toBe("resonance.mp4");
    expect(jobFromProject(untitledProject()).fileName).toBe("Untitled_Resonance.mp4");
  });

  it("ready default-name path: empty memory is .v1, then highest-v, versioned stem", () => {
    const empty = emptyProjectFileMemory();
    expect(readyExportNameFromProject(DEFAULT_PROJECT_NAME, empty)).toBe("Untitled_Resonance.v1.mp4");
    expect(
      readyExportNameFromProject(DEFAULT_PROJECT_NAME, empty, ["Untitled_Resonance.mp4"]),
    ).toBe("Untitled_Resonance.v2.mp4");
    expect(
      readyExportNameFromProject(DEFAULT_PROJECT_NAME, empty, [
        "Untitled_Resonance.mp4",
        "Untitled_Resonance.v3.mp4",
        "Untitled_Resonance.v6.mp4",
      ]),
    ).toBe("Untitled_Resonance.v7.mp4");
    const afterV6 = withExportFileName(empty, "Untitled_Resonance.v6.mp4");
    expect(readyExportNameFromProject(DEFAULT_PROJECT_NAME, afterV6)).toBe(
      "Untitled_Resonance.v7.mp4",
    );
    expect(readyExportNameFromProject("Chorus Cut", afterV6)).toBe("Chorus_Cut.v1.mp4");
    expect(readyExportNameFromProject(DEFAULT_PROJECT_NAME, afterV6, [], "wav")).toBe(
      "Untitled_Resonance.v1.wav",
    );
  });

  it("memory names are collected without inventing paths", () => {
    expect(existingExportNamesFromMemory({})).toEqual([]);
    expect(
      existingExportNamesFromMemory({
        lastExportFileName: "  Untitled_Resonance.mp4  ",
        lastExportFileNames: ["Untitled_Resonance.v3.mp4", "", "  ", 12 as unknown as string],
      }),
    ).toEqual(["Untitled_Resonance.mp4", "Untitled_Resonance.v3.mp4"]);
  });
});

describe("project Speichern unter .vN (not Windows (2))", () => {
  it("defaults to Untitled_Resonance.v1.resonance.json when none exist", () => {
    const raw = projectFilename(untitledProject());
    expect(raw).toBe(`Untitled_Resonance${PROJECT_FILE_SUFFIX}`);
    expect(suggestedProjectSaveAsName(raw, emptyProjectFileMemory())).toBe(
      "Untitled_Resonance.v1.resonance.json",
    );
    expect(suggestedProjectSaveAsName(raw, emptyProjectFileMemory())).not.toMatch(/\(\d+\)/);
  });

  it("unversioned project file occupies v1 → next is .v2.resonance.json", () => {
    expect(
      suggestedProjectSaveAsName("Untitled_Resonance.resonance.json", {
        lastFileName: "Untitled_Resonance.resonance.json",
      }),
    ).toBe("Untitled_Resonance.v2.resonance.json");
  });

  it("ignores Windows-style resonance(2).json and .short/.temp", () => {
    expect(
      suggestedProjectSaveAsName("Untitled_Resonance.resonance.json", emptyProjectFileMemory(), [
        "Untitled_Resonance.resonance.json",
        "Untitled_Resonance.resonance(2).json",
        "Untitled_Resonance.resonance (1).json",
        "Untitled_Resonance.short.resonance.json",
        "Untitled_Resonance.v3.resonance.json",
      ]),
    ).toBe("Untitled_Resonance.v4.resonance.json");
  });

  it("collects lastFileName + recents as project siblings", () => {
    expect(
      existingProjectNamesFromMemory({
        lastFileName: "Untitled_Resonance.resonance.json",
        recents: [
          { lastFileName: "Untitled_Resonance.v2.resonance.json" },
          { lastFileName: "  " },
          { lastFileName: "Untitled_Resonance.resonance.json" },
        ],
      }),
    ).toEqual([
      "Untitled_Resonance.resonance.json",
      "Untitled_Resonance.v2.resonance.json",
    ]);
  });
});
