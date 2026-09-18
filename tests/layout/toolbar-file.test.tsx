import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { Toolbar } from "../../src/ui/toolbar/Toolbar";
import "../../src/styles.css";

describe("toolbar File button", () => {
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

  it("File is one button; New/Open/Save are not in the file group", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = () => {};
    act(() => {
      root!.render(
        <Toolbar
          exporting={false}
          onToggleFile={noop}
          onImport={noop}
          onExport={noop}
        />,
      );
    });
    const group = host.querySelector("[data-group=file]");
    expect(group).toBeTruthy();
    expect(group?.querySelector('[data-testid="toolbar-file"]')?.textContent?.trim()).toBe("File");
    const labels = [...(group?.querySelectorAll("button") ?? [])].map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    expect(labels).toContain("File");
    expect(labels).toContain("Import");
    expect(labels).not.toContain("Media");
    expect(labels).toContain("Export");
    expect(labels).not.toContain("Export WAV");
    expect(labels.some((t) => t?.startsWith("Help"))).toBe(false);
    expect(labels).not.toContain("Undo");
    expect(labels).not.toContain("Redo");
    expect(labels).not.toContain("Split");
    expect(labels).not.toContain("Snap");
    expect(labels).not.toContain("Edit");
    expect(labels).not.toContain("New");
    expect(labels).not.toContain("Open");
    expect(labels).not.toContain("Save");
    expect(labels).not.toContain("Speichern");
    expect(labels).not.toContain("Öffnen");
    expect(labels).not.toContain("Zuletzt");
    expect(labels).not.toContain("Revert");
    expect(group?.querySelector('[data-testid="open-fsa"]')).toBeNull();
    expect(group?.querySelector('[data-testid="save-project"]')).toBeNull();
    expect(group?.querySelector('[data-testid="open-input"]')).toBeNull();
    expect(group?.querySelector('[data-testid="revert-project"]')).toBeNull();
    expect(group?.querySelector('[data-testid="open-media"]')).toBeNull();
    expect(host.querySelector('[data-testid="app-version"]')?.textContent).toBe("V6.0.0");
  });

  it("File toggles the project panel; Import stays in the toolbar", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
    const group = host.querySelector("[data-group=file]");
    expect(group?.querySelector('[data-testid="toolbar-file"]')).toBeTruthy();
    const groupText = group?.textContent ?? "";
    expect(groupText).toMatch(/Import/);
    expect(groupText).not.toMatch(/Export WAV/);
    expect(groupText).not.toMatch(/Help/);
    expect(groupText).not.toMatch(/\bUndo\b/);
    expect(groupText).not.toMatch(/\bRedo\b/);
    expect(groupText).not.toMatch(/\bSplit\b/);
    expect(groupText).not.toMatch(/\bSnap\b/);
    expect(groupText).not.toMatch(/\bNew\b/);
    expect(groupText).not.toMatch(/\bOpen\b/);
    expect(groupText).not.toMatch(/\bSave\b/);

    await act(async () => {
      (host!.querySelector('[data-testid="toolbar-file"]') as HTMLButtonElement).click();
    });
    const panel = host.querySelector('[data-testid="project-file-panel"]');
    expect(panel).toBeTruthy();
    expect(panel?.querySelector('[data-testid="project-new"]')?.textContent?.trim()).toBe("New");
    expect(panel?.querySelector('[data-testid="save-project"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="open-fsa"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="open-input"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="project-save-as"]')).toBeTruthy();
    expect(panel?.querySelector('[data-testid="revert-project"]')).toBeNull();
    expect(panel?.querySelector('[data-testid="project-choose-folder"]')).toBeNull();
    expect(host.querySelector('[data-testid="import-input-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="import-input"]')).toBeTruthy();
    expect(host.querySelector<HTMLInputElement>('[data-testid="import-input"]')?.multiple).toBe(true);
    expect(group?.contains(panel)).toBe(false);
    expect(host.querySelector('[data-testid="transport-undo"]')?.textContent?.trim()).toBe("Undo");
    expect(host.querySelector('[data-testid="transport-redo"]')?.textContent?.trim()).toBe("Redo");
    expect(host.querySelector('[data-testid="transport-snap"]')?.textContent?.trim()).toBe("Snap");
    const help = host.querySelector('[data-testid="shortcuts-help"]');
    expect(help?.textContent?.replace(/\s+/g, " ").trim().startsWith("Help")).toBe(true);
    expect(host.querySelector('[data-testid="transport"]')?.contains(help)).toBe(true);
    expect(host.querySelector('[data-testid="export-wav-btn"]')).toBeNull();
    const transport = host.querySelector('[data-testid="transport"]');
    const splitButtons = [...(transport?.querySelectorAll("button") ?? [])].filter((b) =>
      (b.textContent ?? "").replace(/\s+/g, " ").trim().startsWith("Split"),
    );
    expect(splitButtons).toHaveLength(1);
  });
});
