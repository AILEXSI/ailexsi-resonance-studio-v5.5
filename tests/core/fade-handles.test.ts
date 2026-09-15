import { describe, expect, it } from "vitest";
import {
  FADE_HANDLE_MIN_CLIP_PX,
  FADE_HANDLE_PX,
  TRIM_HANDLE_PX,
  clipHitZone,
  fadeHandlesVisible,
  fadeMsFromDrag,
  fadesFromHandleDrag,
} from "../../src/core/fade-handles";

describe("clipHitZone vs trim / fade", () => {
  const wide = 160;

  it("edge pixels are trim, inset pixels are fade handles", () => {
    expect(clipHitZone(0, wide)).toBe("trim-in");
    expect(clipHitZone(TRIM_HANDLE_PX - 1, wide)).toBe("trim-in");
    expect(clipHitZone(TRIM_HANDLE_PX, wide)).toBe("trim-in");
    expect(clipHitZone(TRIM_HANDLE_PX + 1, wide)).toBe("fade-in");
    expect(clipHitZone(TRIM_HANDLE_PX + FADE_HANDLE_PX - 1, wide)).toBe("fade-in");
    expect(clipHitZone(TRIM_HANDLE_PX + FADE_HANDLE_PX, wide)).toBe("body");
    expect(clipHitZone(wide / 2, wide)).toBe("body");
    expect(clipHitZone(wide - TRIM_HANDLE_PX - FADE_HANDLE_PX, wide)).toBe("body");
    expect(clipHitZone(wide - TRIM_HANDLE_PX - FADE_HANDLE_PX + 1, wide)).toBe("fade-out");
    expect(clipHitZone(wide - TRIM_HANDLE_PX - 1, wide)).toBe("fade-out");
    expect(clipHitZone(wide - TRIM_HANDLE_PX, wide)).toBe("trim-out");
    expect(clipHitZone(wide - 1, wide)).toBe("trim-out");
  });

  it("hides fade zones below the minimum clip width and keeps trim", () => {
    const tight = FADE_HANDLE_MIN_CLIP_PX - 1;
    expect(fadeHandlesVisible(tight)).toBe(false);
    expect(clipHitZone(0, tight)).toBe("trim-in");
    expect(clipHitZone(TRIM_HANDLE_PX + 1, tight)).toBe("body");
    expect(clipHitZone(tight - TRIM_HANDLE_PX - 1, tight)).toBe("body");
    expect(clipHitZone(tight - 1, tight)).toBe("trim-out");
    expect(fadeHandlesVisible(FADE_HANDLE_MIN_CLIP_PX)).toBe(true);
  });
});

describe("fade handle drag mapping", () => {
  it("maps pixels to fadeInMs / fadeOutMs at the project zoom", () => {
    expect(fadeMsFromDrag(0, 16, 80, "in")).toBe(200);
    expect(fadeMsFromDrag(100, -8, 80, "in")).toBe(0);
    expect(fadeMsFromDrag(0, -16, 80, "out")).toBe(200);
    expect(fadeMsFromDrag(400, 16, 80, "out")).toBe(200);
  });

  it("clamps and scales like the inspector when fades would overlap", () => {
    const grown = fadesFromHandleDrag(0, 0, 1000, 80, 80, "in");
    expect(grown.fadeInMs).toBe(1000);
    expect(grown.fadeOutMs).toBe(0);

    const both = fadesFromHandleDrag(800, 800, 1000, 16, 80, "in");
    expect(both.fadeInMs + both.fadeOutMs).toBeCloseTo(1000, 5);
    expect(both.fadeInMs).toBeCloseTo(1000 * (1000 / 1800), 5);
    expect(both.fadeOutMs).toBeCloseTo(1000 * (800 / 1800), 5);
  });
});
