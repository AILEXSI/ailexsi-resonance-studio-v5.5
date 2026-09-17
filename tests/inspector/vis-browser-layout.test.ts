import { describe, expect, it } from "vitest";
import {
  VIS_BROWSER_PANEL_HEIGHT_EST,
  VIS_BROWSER_PANEL_WIDTH,
  clampVisBrowserPos,
  placeVisBrowserPanel,
  readVisBrowserPos,
  writeVisBrowserPos,
} from "../../src/ui/inspector/vis-browser-layout";

describe("VIS styles panel placement", () => {
  it("clamps dragged position to the viewport", () => {
    expect(
      clampVisBrowserPos(
        { left: -40, top: -20 },
        { width: 400, height: 300 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 8, top: 8 });
    expect(
      clampVisBrowserPos(
        { left: 900, top: 700 },
        { width: 400, height: 300 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 392, top: 292 });
  });

  it("prefers upper placement when the arranger is short or the panel would clip the bottom", () => {
    const header = { top: 620, right: 96, bottom: 668 };
    const viewport = { width: 1280, height: 720 };
    const panel = { width: VIS_BROWSER_PANEL_WIDTH, height: VIS_BROWSER_PANEL_HEIGHT_EST };
    const tight = placeVisBrowserPanel({
      header,
      panel,
      viewport,
      arrangerHeight: 160,
    });
    expect(tight.top).toBeLessThan(header.top);
    expect(tight.top + panel.height).toBeLessThanOrEqual(viewport.height - 8);

    const roomy = placeVisBrowserPanel({
      header: { top: 120, right: 96, bottom: 168 },
      panel,
      viewport,
      arrangerHeight: 600,
    });
    expect(roomy.top).toBe(120);
    expect(roomy.left).toBe(104);
  });

  it("reuses a persisted position and still clamps it", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    writeVisBrowserPos({ left: 40, top: 60 }, storage);
    expect(readVisBrowserPos(storage)).toEqual({ left: 40, top: 60 });
    const reused = placeVisBrowserPanel({
      header: { top: 620, right: 96, bottom: 668 },
      viewport: { width: 1280, height: 720 },
      arrangerHeight: 120,
      lastPos: readVisBrowserPos(storage),
    });
    expect(reused).toEqual({ left: 40, top: 60 });
    const clamped = placeVisBrowserPanel({
      header: { top: 620, right: 96, bottom: 668 },
      panel: { width: 400, height: 300 },
      viewport: { width: 800, height: 600 },
      lastPos: { left: 900, top: 700 },
    });
    expect(clamped).toEqual({ left: 392, top: 292 });
  });
});
