import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  confirmNewProject,
  createSession,
  isProjectDirty,
  newProject,
} from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";

describe("new project confirm (P72)", () => {
  it("clean New does not confirm; dirty New confirms and keeps the store", () => {
    const store = createMemoryBlobStore();
    const start = createSession(store);
    expect(isProjectDirty(start)).toBe(false);

    let asked = 0;
    const clean = confirmNewProject(start, () => {
      asked += 1;
      return false;
    });
    expect(asked).toBe(0);
    expect(clean.store).toBe(store);
    expect(clean.project.clips).toEqual([]);
    expect(isProjectDirty(clean)).toBe(false);

    const dirty = applyCommand(start, { type: "renameProject", name: "Chorus" });
    expect(isProjectDirty(dirty)).toBe(true);

    const cancelled = confirmNewProject(dirty, () => {
      asked += 1;
      return false;
    });
    expect(asked).toBe(1);
    expect(cancelled).toBe(dirty);
    expect(cancelled.project.name).toBe("Chorus");

    const reset = confirmNewProject(dirty, () => {
      asked += 1;
      return true;
    });
    expect(asked).toBe(2);
    expect(reset.store).toBe(store);
    expect(reset.project.clips).toEqual([]);
    expect(reset.project.name).not.toBe("Chorus");
    expect(isProjectDirty(reset)).toBe(false);
    expect(newProject(dirty).store).toBe(store);
  });
});
