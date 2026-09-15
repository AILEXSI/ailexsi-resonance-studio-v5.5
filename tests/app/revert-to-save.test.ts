import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  confirmRevertToLastSave,
  createSession,
  isProjectDirty,
  markProjectClean,
  revertToLastSave,
} from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";

describe("revert to last save (P79)", () => {
  it("walks existing history back to the last clean checkpoint", () => {
    const start = createSession(createMemoryBlobStore());
    expect(revertToLastSave(start)).toBe(start);

    const named = applyCommand(start, { type: "renameProject", name: "Chorus" });
    expect(isProjectDirty(named)).toBe(true);
    const reverted = revertToLastSave(named);
    expect(reverted.project.name).toBe(start.project.name);
    expect(isProjectDirty(reverted)).toBe(false);
    expect(reverted.status).toBe("Reverted to last save");
    expect(reverted.history.past.length).toBe(start.history.past.length);
    expect(reverted.history.future.length).toBe(start.history.future.length);

    const saved = markProjectClean(named);
    const again = applyCommand(saved, { type: "renameProject", name: "Other" });
    expect(isProjectDirty(again)).toBe(true);
    const back = revertToLastSave(again);
    expect(back.project.name).toBe("Chorus");
    expect(isProjectDirty(back)).toBe(false);

    const undone = applyCommand(saved, { type: "undo" });
    expect(isProjectDirty(undone)).toBe(true);
    const redone = revertToLastSave(undone);
    expect(redone.project.name).toBe("Chorus");
    expect(isProjectDirty(redone)).toBe(false);
  });

  it("command revertToLastSave uses the same history walk (P80)", () => {
    const start = createSession(createMemoryBlobStore());
    const named = applyCommand(start, { type: "renameProject", name: "Chorus" });
    const reverted = applyCommand(named, { type: "revertToLastSave" });
    expect(reverted.project.name).toBe(start.project.name);
    expect(isProjectDirty(reverted)).toBe(false);
  });

  it("confirm Revert: cancel keeps dirty work; confirm drops redo so undo cannot restore (P81)", () => {
    const start = createSession(createMemoryBlobStore());
    const named = applyCommand(start, { type: "renameProject", name: "Chorus" });
    let asked = 0;
    const cancelled = confirmRevertToLastSave(named, () => {
      asked += 1;
      return false;
    });
    expect(asked).toBe(1);
    expect(cancelled).toBe(named);
    expect(cancelled.project.name).toBe("Chorus");

    const reverted = confirmRevertToLastSave(named, () => {
      asked += 1;
      return true;
    });
    expect(asked).toBe(2);
    expect(reverted.project.name).toBe(start.project.name);
    expect(isProjectDirty(reverted)).toBe(false);
    const afterUndo = applyCommand(reverted, { type: "undo" });
    expect(afterUndo.project.name).toBe(start.project.name);
    expect(afterUndo.status).toBe("Nothing to undo");

    expect(confirmRevertToLastSave(start, () => {
      asked += 1;
      return false;
    })).toBe(start);
    expect(asked).toBe(2);
  });
});
