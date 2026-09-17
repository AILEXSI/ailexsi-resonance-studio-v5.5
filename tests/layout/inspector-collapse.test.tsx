import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import {
  H_SPLIT_RATIO_KEY,
  INSPECTOR_COLLAPSED_KEY,
  INSPECTOR_COLLAPSED_PX,
  loadInspectorCollapsed,
  MIXER_COLLAPSED_KEY,
  MIXER_WIDTH_KEY,
} from "../../src/core/layout-prefs";
import "../../src/styles.css";

describe("inspector collapse (UI-INS)", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    localStorage.removeItem(INSPECTOR_COLLAPSED_KEY);
    localStorage.removeItem(H_SPLIT_RATIO_KEY);
    localStorage.removeItem(MIXER_COLLAPSED_KEY);
    localStorage.removeItem(MIXER_WIDTH_KEY);
  });

  async function mount() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<App />);
    });
  }

  it("UI-INS-01 open is today's inspector; collapse hides content and keeps a reopen strip", async () => {
    await mount();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="inspector-collapse"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="layout-split-h"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-collapsed")).toBe(
      "false",
    );

    await act(async () => {
      (host!.querySelector('[data-testid="inspector-collapse"]') as HTMLButtonElement).click();
    });

    expect(host!.querySelector('[data-testid="inspector"]')).toBeNull();
    expect(host!.querySelector('[data-testid="layout-split-h"]')).toBeNull();
    expect(host!.querySelector('[data-testid="workspace-inspector"]')?.getAttribute("data-collapsed")).toBe(
      "true",
    );
    expect(host!.querySelector('[data-testid="inspector-collapse"]')?.textContent).toMatch(/INS/);
    expect(host!.querySelector('[data-testid="workspace-preview"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="preview"]')).toBeTruthy();
    const strip = host!.querySelector('[data-testid="workspace-inspector"]') as HTMLElement;
    expect(strip.style.minWidth).toBe(`${INSPECTOR_COLLAPSED_PX}px`);
    expect(loadInspectorCollapsed(localStorage)).toBe(true);

    await act(async () => {
      (host!.querySelector('[data-testid="inspector-collapse"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="layout-split-h"]')).toBeTruthy();
    expect(loadInspectorCollapsed(localStorage)).toBe(false);
  });

  it("UI-INS-02 / UI-MIX-01 collapse does not change mixer open/width", async () => {
    await mount();
    const mixerWidth = host!.querySelector('[data-testid="arrange-row"]')?.getAttribute("data-mixer-width");
    expect(host!.querySelector('[data-testid="mixer"]')?.getAttribute("data-collapsed")).toBe("false");
    expect(host!.querySelector('[data-testid="mixer-resize"]')).toBeTruthy();

    await act(async () => {
      (host!.querySelector('[data-testid="inspector-collapse"]') as HTMLButtonElement).click();
    });
    expect(host!.querySelector('[data-testid="mixer"]')?.getAttribute("data-collapsed")).toBe("false");
    expect(host!.querySelector('[data-testid="arrange-row"]')?.getAttribute("data-mixer-width")).toBe(
      mixerWidth,
    );
    expect(host!.querySelector('[data-testid="mixer-resize"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-master"]')).toBeTruthy();
  });
});
