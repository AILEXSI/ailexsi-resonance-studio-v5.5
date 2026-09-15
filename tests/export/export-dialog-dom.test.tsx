import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyExportDialogSize,
  applyExportProgress,
  openExportDialog,
  readyExportDialog,
  succeedExportDialog,
} from "../../src/core/exporter/dialog";
import { ExportDialog } from "../../src/ui/export/ExportDialog";
import { Toolbar } from "../../src/ui/toolbar/Toolbar";
import "../../src/styles.css";

describe("export dialog DOM", () => {
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

  it("ready phase: 1080p + 24 fps then Export (P67)", () => {
    const started: string[] = [];
    let state = readyExportDialog({ fileName: "cut.mp4" });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const render = () => {
      act(() => {
        root!.render(
          <ExportDialog
            state={state}
            onCancel={() => {}}
            onClose={() => {}}
            onChange={(next) => {
              state = next;
              render();
            }}
            onStart={() => started.push(`${state.width}x${state.height}@${state.fps}`)}
          />,
        );
      });
    };
    render();
    expect(host.querySelector('[data-testid="export-dialog-presets"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="export-dialog-bar"]')).toBeNull();
    expect(host.querySelector('[data-testid="export-start"]')?.textContent).toBe("Export");
    act(() => {
      (host!.querySelector('[data-testid="export-size-1080p"]') as HTMLButtonElement).click();
    });
    act(() => {
      (host!.querySelector('[data-testid="export-fps-24"]') as HTMLButtonElement).click();
    });
    expect(state.width).toBe(1920);
    expect(state.height).toBe(1080);
    expect(state.fps).toBe(24);
    expect(host.querySelector('[data-testid="export-dialog-meta"]')?.textContent).toMatch(/1920×1080/);
    expect(host.querySelector('[data-testid="export-dialog-meta"]')?.textContent).toMatch(/24 fps/);
    act(() => {
      (host!.querySelector('[data-testid="export-start"]') as HTMLButtonElement).click();
    });
    expect(started).toEqual(["1920x1080@24"]);
    expect(applyExportDialogSize(state, { width: 1280, height: 720 }).width).toBe(1280);
  });

  it("shows name, size, progress and Abbrechen; cancel does not look like success", () => {
    const cancelled: string[] = [];
    let state = openExportDialog({ fileName: "cut.mp4", width: 1280, height: 720, fps: 30 });
    state = applyExportProgress(state, { percent: 40, stage: "Encoding H.264" });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <ExportDialog state={state} onCancel={() => cancelled.push("cancel")} onClose={() => cancelled.push("close")} />,
      );
    });
    expect(host.querySelector('[data-testid="export-dialog"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="export-frame-engine"]')?.textContent).toBe(
      "Frame Engine: AILEXSI",
    );
    expect(host.querySelector('[data-testid="export-dialog-file"]')?.textContent).toContain("cut.mp4");
    expect(host.querySelector('[data-testid="export-dialog-file"]')?.textContent).not.toMatch(/C:\\/);
    expect(host.textContent ?? "").not.toMatch(/C:\\Users/);
    expect(host.querySelector('[data-testid="export-dialog-meta"]')?.textContent).toMatch(/1280×720/);
    expect(host.querySelector('[data-testid="export-dialog-status"]')?.textContent).toMatch(/40%/);
    expect(host.querySelector('[data-testid="export-cancel"]')?.textContent).toBe("Abbrechen");
    act(() => {
      (host!.querySelector('[data-testid="export-cancel"]') as HTMLButtonElement).click();
    });
    expect(cancelled).toEqual(["cancel"]);
    act(() => {
      (host!.querySelector('[data-testid="export-dialog-x"]') as HTMLButtonElement).click();
    });
    expect(cancelled).toEqual(["cancel", "cancel"]);
  });

  it("done state shows the output name and Schließen, not Abbrechen", () => {
    const closed: string[] = [];
    const state = succeedExportDialog(
      openExportDialog({ fileName: "cut.mp4", width: 1280, height: 720, fps: 30 }),
      "cut.mp4",
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<ExportDialog state={state} onCancel={() => closed.push("cancel")} onClose={() => closed.push("close")} />);
    });
    expect(host.querySelector('[data-testid="export-dialog-status"]')?.textContent).toMatch(/Fertig/);
    expect(host.querySelector('[data-testid="export-cancel"]')).toBeNull();
    act(() => {
      (host!.querySelector('[data-testid="export-close"]') as HTMLButtonElement).click();
    });
    expect(closed).toEqual(["close"]);
  });

  it("ready dialog shows the next versioned default name without a path", () => {
    const state = readyExportDialog({ fileName: "Untitled_Resonance.v7.mp4" });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <ExportDialog state={state} onCancel={() => {}} onClose={() => {}} />,
      );
    });
    expect(host.querySelector('[data-testid="export-dialog-file"]')?.textContent).toBe(
      "Untitled_Resonance.v7.mp4",
    );
    expect(host.querySelector('[data-testid="export-dialog-file"]')?.textContent).not.toMatch(/C:\\/);
    expect(host.querySelector('[data-testid="export-dialog-status"]')?.textContent).toMatch(
      /Größe wählen/,
    );
  });

  it("toolbar Export stays labeled Export (progress lives in the dialog)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = () => {};
    act(() => {
      root!.render(
        <Toolbar
          exporting
          projectName="Chorus Cut"
          onToggleFile={noop}
          onImport={noop}
          onExport={noop}
        />,
      );
    });
    const btn = host.querySelector('[data-testid="export-btn"]') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe("Export");
    expect(btn.disabled).toBe(true);
    expect(host.querySelector('[data-testid="export-wav-btn"]')).toBeNull();
    const title = host.querySelector('[data-testid="project-name"]') as HTMLInputElement;
    expect(title.value).toBe("Chorus Cut");
  });
});
