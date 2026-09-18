import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import {
  INSPECTOR_COLLAPSED_KEY,
  loadNormalSplitRatio,
  loadSplitRatio,
  loadTimelineFocus,
  MIXER_COLLAPSED_KEY,
  MIXER_WIDTH_KEY,
  NORMAL_SPLIT_RATIO_KEY,
  saveSplitRatio,
  SPLIT_RATIO_KEY,
  TIMELINE_FOCUS_KEY,
} from "../../src/core/layout-prefs";
import "../../src/styles.css";

describe("timeline focus (UI-FOCUS)", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    localStorage.removeItem(TIMELINE_FOCUS_KEY);
    localStorage.removeItem(NORMAL_SPLIT_RATIO_KEY);
    localStorage.removeItem(SPLIT_RATIO_KEY);
    localStorage.removeItem(INSPECTOR_COLLAPSED_KEY);
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

  it("UI-FOCUS-01 toggle stores the prior divider and restores it exactly", async () => {
    saveSplitRatio(localStorage, 0.61);
    await mount();
    const pane = () => host!.querySelector('[data-testid="preview-pane"]') as HTMLElement;
    const toggle = () => host!.querySelector('[data-testid="timeline-focus"]') as HTMLButtonElement;
    expect(toggle()).toBeTruthy();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(pane().getAttribute("data-timeline-focus")).toBe("false");
    expect(Number(pane().getAttribute("data-preview-ratio"))).toBeCloseTo(0.61, 5);
    expect(host!.querySelector('[data-testid="layout-split"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();

    await act(async () => {
      toggle().click();
    });
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(pane().getAttribute("data-timeline-focus")).toBe("true");
    const focused = Number(pane().getAttribute("data-preview-ratio"));
    expect(focused).toBeLessThan(0.61);
    expect(loadTimelineFocus(localStorage)).toBe(true);
    expect(loadNormalSplitRatio(localStorage)).toBeCloseTo(0.61, 5);
    expect(loadSplitRatio(localStorage)).toBeCloseTo(0.61, 5);
    expect(host!.querySelector('[data-testid="inspector"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mixer"]')?.getAttribute("data-collapsed")).toBe("false");

    await act(async () => {
      toggle().click();
    });
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(Number(pane().getAttribute("data-preview-ratio"))).toBeCloseTo(0.61, 5);
    expect(loadTimelineFocus(localStorage)).toBe(false);
    expect(loadSplitRatio(localStorage)).toBeCloseTo(0.61, 5);
  });

  it("UI-FOCUS-02 existing preview/arrange splitter remains while focused", async () => {
    await mount();
    await act(async () => {
      (host!.querySelector('[data-testid="timeline-focus"]') as HTMLButtonElement).click();
    });
    const split = host!.querySelector('[data-testid="layout-split"]') as HTMLElement;
    expect(split).toBeTruthy();
    expect(getComputedStyle(split).cursor).toBe("ns-resize");
    expect(host!.querySelector('[data-testid="layout-split-grip"]')).toBeTruthy();
  });
});
