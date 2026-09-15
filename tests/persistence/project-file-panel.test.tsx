import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { statusHasFakePath, type ProjectFileMemory } from "../../src/core/project-file";
import { ProjectFilePanel } from "../../src/ui/project-file/ProjectFilePanel";

describe("project file panel", () => {
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

  it("renders last file name and remembered folder without a fake path", () => {
    const memory: ProjectFileMemory = {
      fileHandle: { name: "Beginagain.resonance.json", kind: "file" },
      directoryHandle: { kind: "directory", name: "Projects" },
      lastFileName: "Beginagain.resonance.json",
      lastExportFileName: null,
      lastExportFileNames: [],
      recents: [
        {
          fileHandle: { name: "Beginagain.resonance.json", kind: "file" },
          directoryHandle: { kind: "directory", name: "Projects" },
          lastFileName: "Beginagain.resonance.json",
        },
        {
          fileHandle: { name: "Older.resonance.json", kind: "file" },
          directoryHandle: { kind: "directory", name: "Archive" },
          lastFileName: "Older.resonance.json",
        },
      ],
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const opened: string[] = [];
    act(() => {
      root!.render(
        <ProjectFilePanel
          memory={memory}
          onNew={() => {}}
          onSave={() => {}}
          onSaveAs={() => {}}
          onOpen={() => {}}
          onOpenRecent={(recent) => {
            opened.push(recent.lastFileName);
          }}
        />,
      );
    });
    const panel = host.querySelector('[data-testid="project-file-panel"]');
    expect(panel).toBeTruthy();
    expect(host.querySelector('[data-testid="project-file-name"]')?.textContent).toBe(
      "Beginagain.resonance.json",
    );
    expect(host.querySelector('[data-testid="project-file-folder"]')?.textContent).toBe("Projects");
    expect(host.querySelector('[data-testid="project-folder-remembered"]')?.textContent).toMatch(
      /gemerkt/,
    );
    const text = panel!.textContent ?? "";
    expect(text).toContain("Projekt");
    expect(text).toContain("New");
    expect(text).toContain("Speichern");
    expect(text).toContain("Öffnen");
    expect(host.querySelector('[data-testid="open-fsa"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="save-project"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="open-input"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="revert-project"]')).toBeNull();
    expect(host.querySelector('[data-testid="project-choose-folder"]')).toBeNull();
    expect(text).not.toContain("Ordner wählen");
    expect(text).not.toContain("Revert");
    expect(statusHasFakePath(text)).toBe(false);
    expect(text).not.toMatch(/C:\\Users/);
    expect(text).not.toMatch(/\/Users\//);

    const recent = host.querySelector('[data-testid="project-recent-Older.resonance.json"]');
    expect(recent).toBeTruthy();
    act(() => {
      (recent as HTMLButtonElement).click();
    });
    expect(opened).toEqual(["Older.resonance.json"]);
  });

  it("Tauri lastPath shows the file name and remembered folder, not Kein Ordner gemerkt", () => {
    const memory: ProjectFileMemory = {
      fileHandle: null,
      directoryHandle: null,
      lastFileName: "Show.resonance.json",
      lastPath: "C:\\Users\\marti\\Projects\\Show.resonance.json",
      lastExportFileName: null,
      lastExportFileNames: [],
      recents: [],
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <ProjectFilePanel
          memory={memory}
          onNew={() => {}}
          onSave={() => {}}
          onSaveAs={() => {}}
          onOpen={() => {}}
          onOpenRecent={() => {}}
        />,
      );
    });
    expect(host.querySelector('[data-testid="project-file-name"]')?.textContent).toBe(
      "Show.resonance.json",
    );
    expect(host.querySelector('[data-testid="project-file-folder"]')?.textContent).toBe("Projects");
    expect(host.querySelector('[data-testid="project-folder-remembered"]')?.textContent).toMatch(
      /gemerkt/,
    );
    const text = host.textContent ?? "";
    expect(text).not.toContain("Kein Ordner gemerkt");
    expect(text).not.toContain("Noch kein Projektordner");
    expect(statusHasFakePath(text)).toBe(false);
    expect(text).not.toMatch(/C:\\Users/);
  });
});
