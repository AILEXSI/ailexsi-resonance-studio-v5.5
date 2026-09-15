import { describe, expect, it } from "vitest";
import {
  buildRulerTicks,
  estimateLabelWidthPx,
  labeledTickGapPx,
} from "../../src/core/ruler";
import { applyFit, applyZoom, createSession } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { playheadInView, usableLanePx } from "../../src/core/zoom";
import { asset, clip, projectWith } from "../helpers";

function labeled(ticks: ReturnType<typeof buildRulerTicks>) {
  return ticks.filter((t) => t.kind === "major" && t.label);
}

function assertNoOverlap(
  ticks: ReturnType<typeof buildRulerTicks>,
  zoom: number,
  scrollMs = 0,
): void {
  const majors = labeled(ticks);
  expect(majors.length).toBeGreaterThan(1);
  for (let i = 1; i < majors.length; i += 1) {
    const prev = majors[i - 1]!;
    const cur = majors[i]!;
    const gap = labeledTickGapPx(prev, cur, zoom);
    const need = estimateLabelWidthPx(prev.label!) + 8;
    expect(gap).toBeGreaterThanOrEqual(need);
    const x0 = ((prev.timeMs - scrollMs) / 1000) * zoom;
    const x1 = ((cur.timeMs - scrollMs) / 1000) * zoom;
    expect(x1).toBeGreaterThanOrEqual(x0 + need);
  }
}

describe("adaptive ruler", () => {
  it("at 2.5 px/s over ~400s consecutive labels have a minimum pixel gap", () => {
    const zoom = 2.5;
    const ticks = buildRulerTicks({
      zoomPxPerSec: zoom,
      durationMs: 400_000,
      scrollMs: 0,
      viewWidthPx: 1000,
    });
    const majors = labeled(ticks);
    expect(majors.length).toBeGreaterThan(1);
    expect(majors.length).toBeLessThan(20);
    assertNoOverlap(ticks, zoom);
    expect(majors[0]!.label).toMatch(/0/);
  });

  it("zoom-in increases tick density without overlap", () => {
    const coarse = labeled(
      buildRulerTicks({
        zoomPxPerSec: 2.5,
        durationMs: 400_000,
        scrollMs: 0,
        viewWidthPx: 1000,
      }),
    );
    const fine = labeled(
      buildRulerTicks({
        zoomPxPerSec: 80,
        durationMs: 400_000,
        scrollMs: 0,
        viewWidthPx: 1000,
      }),
    );
    const coarseStep = coarse[1]!.timeMs - coarse[0]!.timeMs;
    const fineStep = fine[1]!.timeMs - fine[0]!.timeMs;
    expect(fineStep).toBeLessThan(coarseStep);
    expect(fine.length).toBeGreaterThan(1);
    assertNoOverlap(
      buildRulerTicks({
        zoomPxPerSec: 80,
        durationMs: 400_000,
        scrollMs: 0,
        viewWidthPx: 1000,
      }),
      80,
    );
  });

  it("labels stay non-overlapping at 400, 2000, and 12000 px/s", () => {
    for (const zoom of [400, 2000, 12_000]) {
      const ticks = buildRulerTicks({
        zoomPxPerSec: zoom,
        durationMs: 400_000,
        scrollMs: 13_000,
        viewWidthPx: 1000,
      });
      assertNoOverlap(ticks, zoom, 13_000);
      const majors = labeled(ticks);
      const step = majors[1]!.timeMs - majors[0]!.timeMs;
      if (zoom >= 12_000) expect(step).toBeLessThanOrEqual(50);
      if (zoom >= 2000) expect(step).toBeLessThanOrEqual(200);
    }
  });
});

describe("fit and playhead zoom still hold", () => {
  it("Fit still shows full duration; playhead zoom still locks to currentTime", () => {
    const a = asset({ id: "wav", kind: "audio", durationMs: 400_000 });
    const c = clip({ id: "c1", assetId: "wav", trackId: "A1", startMs: 0, durationMs: 400_000 });
    let s = {
      ...createSession(createMemoryBlobStore()),
      project: { ...projectWith([c], [a]), playheadMs: 13_560 },
    };
    s = applyFit(s, 1000);
    expect(s.project.scrollMs).toBe(0);
    expect(400 * s.project.zoomPxPerSec).toBeLessThanOrEqual(usableLanePx(1000) + 0.001);
    s = applyZoom(s, 80, 1000);
    expect(playheadInView(13_560, s.project.scrollMs, s.project.zoomPxPerSec, 1000)).toBe(true);
  });
});
