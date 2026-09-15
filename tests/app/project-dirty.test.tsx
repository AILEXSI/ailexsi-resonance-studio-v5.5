import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applyPlayhead,
  beforeUnloadIfDirty,
  createSession,
  isProjectDirty,
  markProjectClean,
  newProject,
  openSerialized,
  projectJson,
} from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { Toolbar } from "../../src/ui/toolbar/Toolbar";

describe("project dirty (P71)", () => {
  it("new session and new/open are clean; history past save is dirty", () => {
    const start = createSession(createMemoryBlobStore());
    expect(isProjectDirty(start)).toBe(false);

    const named = applyCommand(start, { type: "renameProject", name: "Chorus" });
    expect(isProjectDirty(named)).toBe(true);

    const saved = markProjectClean(named);
    expect(isProjectDirty(saved)).toBe(false);

    const undone = applyCommand(saved, { type: "undo" });
    expect(isProjectDirty(undone)).toBe(true);
    expect(undone.project.name).toBe(start.project.name);

    const redone = applyCommand(undone, { type: "redo" });
    expect(isProjectDirty(redone)).toBe(false);
    expect(redone.project.name).toBe("Chorus");

    const playhead = applyPlayhead(saved, 4000);
    expect(isProjectDirty(playhead)).toBe(false);

    expect(isProjectDirty(newProject(named))).toBe(false);
    expect(isProjectDirty(openSerialized(named, projectJson(named)))).toBe(false);

    const cleanEvent = { preventDefault: () => {}, returnValue: "keep" };
    expect(beforeUnloadIfDirty(start, cleanEvent)).toBe(false);
    expect(cleanEvent.returnValue).toBe("keep");
    let prevented = 0;
    const dirtyEvent = { preventDefault: () => { prevented += 1; }, returnValue: "keep" };
    expect(beforeUnloadIfDirty(named, dirtyEvent)).toBe(true);
    expect(prevented).toBe(1);
    expect(dirtyEvent.returnValue).toBe("");
  });
});

describe("project dirty toolbar (P71)", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  it("shows * next to the name only when dirty", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = () => {};
    let reverted = 0;
    const render = (dirty: boolean) => {
      act(() => {
        root!.render(
          <Toolbar
            exporting={false}
            projectName="Chorus Cut"
            projectDirty={dirty}
            onToggleFile={noop}
            onImport={noop}
            onExport={noop}
          />,
        );
      });
    };
    render(false);
    expect(host.querySelector('[data-testid="project-name"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="project-dirty"]')).toBeNull();
    expect(host.querySelector('[data-testid="revert-project"]')).toBeNull();
    render(true);
    const mark = host.querySelector('[data-testid="project-dirty"]');
    expect(mark?.textContent).toBe("*");
    expect(mark?.getAttribute("aria-label")).toBe("Unsaved changes");
    expect(host.querySelector('[data-testid="revert-project"]')).toBeNull();
    expect(reverted).toBe(0);
  });
});
