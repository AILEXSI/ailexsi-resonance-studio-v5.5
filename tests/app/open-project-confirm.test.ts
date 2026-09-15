import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  confirmOpenProject,
  createSession,
  isProjectDirty,
  openSerialized,
  projectJson,
} from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";

describe("open project confirm (P77)", () => {
  it("clean Open does not confirm; dirty Open confirms and can cancel", () => {
    const start = createSession(createMemoryBlobStore());
    expect(isProjectDirty(start)).toBe(false);

    let asked = 0;
    expect(
      confirmOpenProject(start, () => {
        asked += 1;
        return false;
      }),
    ).toBe(true);
    expect(asked).toBe(0);

    const dirty = applyCommand(start, { type: "renameProject", name: "Chorus" });
    expect(isProjectDirty(dirty)).toBe(true);
    expect(
      confirmOpenProject(dirty, () => {
        asked += 1;
        return false;
      }),
    ).toBe(false);
    expect(asked).toBe(1);
    expect(dirty.project.name).toBe("Chorus");

    expect(
      confirmOpenProject(dirty, () => {
        asked += 1;
        return true;
      }),
    ).toBe(true);
    expect(asked).toBe(2);

    const other = applyCommand(start, { type: "renameProject", name: "Other" });
    const opened = openSerialized(dirty, projectJson(other));
    expect(opened.project.name).toBe("Other");
    expect(isProjectDirty(opened)).toBe(false);
  });
});
