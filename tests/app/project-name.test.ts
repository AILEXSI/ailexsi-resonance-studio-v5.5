import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, projectJson } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import {
  DEFAULT_PROJECT_NAME,
  deserializeProject,
  renameProject,
  windowTitleFor,
} from "../../src/core/project";

describe("project name (P69)", () => {
  it("rename writes the existing Project.name and survives serialize/open", () => {
    const start = createSession(createMemoryBlobStore());
    expect(start.project.name).toBe(DEFAULT_PROJECT_NAME);
    const next = applyCommand(start, { type: "renameProject", name: " Chorus Cut " });
    expect(next.project.name).toBe("Chorus Cut");
    expect(next.status).toBe("Project renamed");
    const loaded = deserializeProject(projectJson(next));
    expect(loaded.name).toBe("Chorus Cut");
    expect(windowTitleFor(loaded.name)).toBe("Chorus Cut — Resonance Studio");
  });

  it("undo/redo restores the title; empty falls back to Untitled", () => {
    const start = createSession(createMemoryBlobStore());
    const named = applyCommand(start, { type: "renameProject", name: "Show" });
    const undone = applyCommand(named, { type: "undo" });
    expect(undone.project.name).toBe(DEFAULT_PROJECT_NAME);
    const redone = applyCommand(undone, { type: "redo" });
    expect(redone.project.name).toBe("Show");
    expect(renameProject(named.project, "   ")).toEqual(
      expect.objectContaining({ name: DEFAULT_PROJECT_NAME }),
    );
    expect(applyCommand(named, { type: "renameProject", name: "Show" })).toBe(named);
  });
});
