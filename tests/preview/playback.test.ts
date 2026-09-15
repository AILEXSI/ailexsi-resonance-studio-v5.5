import { describe, expect, it } from "vitest";
import { sourceTimeAt } from "../../src/core/models";
import { advancePlayhead, nextShuttleRate, playbackBounds } from "../../src/core/playback";
import { clip, projectWith } from "../helpers";

describe("preview / playback", () => {
  it("maps timeline time to source time", () => {
    const c = clip({
      id: "c",
      assetId: "a",
      trackId: "V1",
      startMs: 1000,
      durationMs: 500,
      sourceInMs: 200,
      sourceOutMs: 700,
    });
    expect(sourceTimeAt(c, 1000)).toBe(200);
    expect(sourceTimeAt(c, 1250)).toBe(450);
    const fast = { ...c, rate: 2, durationMs: 250 };
    expect(sourceTimeAt(fast, 1250)).toBe(700);
  });

  it("LOOP ON wraps OUT → IN; LOOP OFF crosses OUT and continues", () => {
    const p = projectWith([
      clip({ id: "c", assetId: "a", trackId: "V1", startMs: 0, durationMs: 5000 }),
    ]);
    p.inPointMs = 1000;
    p.outPointMs = 2000;
    p.playheadMs = 1900;
    p.loop = true;
    expect(playbackBounds(p)).toEqual({ startMs: 1000, endMs: 2000 });
    expect(advancePlayhead(p, 200).playheadMs).toBe(1000);
    p.loop = false;
    expect(playbackBounds(p).startMs).toBe(0);
    expect(playbackBounds(p).endMs).toBe(5000);
    const crossed = advancePlayhead(p, 200);
    expect(crossed.stopped).toBe(false);
    expect(crossed.playheadMs).toBe(2100);
  });

  it("reverse shuttle crosses IN when LOOP is off and wraps when LOOP is on", () => {
    const p = projectWith([
      clip({ id: "c", assetId: "a", trackId: "V1", startMs: 0, durationMs: 5000 }),
    ]);
    p.inPointMs = 1000;
    p.outPointMs = 2000;
    p.playheadMs = 1100;
    p.loop = false;
    const crossed = advancePlayhead(p, -200);
    expect(crossed.stopped).toBe(false);
    expect(crossed.playheadMs).toBe(900);
    p.loop = true;
    const wrapped = advancePlayhead(p, -200);
    expect(wrapped.stopped).toBe(false);
    expect(wrapped.playheadMs).toBe(2000);
  });

  it("shuttle rate table is 1 → 2 → 4", () => {
    expect([0, 1, 2, 4].map((r) => nextShuttleRate(r, 1))).toEqual([1, 2, 4, 4]);
    expect([0, -1, -2, -4].map((r) => nextShuttleRate(r, -1))).toEqual([-1, -2, -4, -4]);
  });

  it("uses clip extent when IN/OUT unset", () => {
    const p = projectWith([
      clip({ id: "c", assetId: "a", trackId: "A1", startMs: 0, durationMs: 800 }),
    ]);
    expect(playbackBounds(p).endMs).toBe(800);
  });

  it("Play/loop matches export range: skip disabled tail, keep VIS events (P103)", () => {
    const p = projectWith([
      clip({ id: "on", assetId: "a", trackId: "V1", startMs: 0, durationMs: 800 }),
      clip({ id: "off", assetId: "a", trackId: "V1", startMs: 800, durationMs: 4000, enabled: false }),
    ]);
    p.markers = [{ id: "m", timeMs: 9000, label: "M" }];
    expect(playbackBounds(p).endMs).toBe(800);
    p.playheadMs = 750;
    const stopped = advancePlayhead(p, 200);
    expect(stopped.stopped).toBe(true);
    expect(stopped.playheadMs).toBe(800);

    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      events: [{ id: "e1", sceneId: "pulse-orb", startMs: 500, durationMs: 1500 }],
    };
    expect(playbackBounds(p).endMs).toBe(2000);
  });
});

describe("LOOP OFF ignores OUT as a playback boundary", () => {
  function ranged(): ReturnType<typeof projectWith> {
    const p = projectWith([
      clip({ id: "c", assetId: "a", trackId: "V1", startMs: 0, durationMs: 5000 }),
    ]);
    p.inPointMs = 1000;
    p.outPointMs = 2000;
    return p;
  }

  it("toggle LOOP OFF inside the loop makes OUT stop being a boundary immediately", () => {
    const p = ranged();
    p.loop = true;
    p.playheadMs = 1500;
    p.loop = false;
    const next = advancePlayhead(p, 600);
    expect(next.stopped).toBe(false);
    expect(next.playheadMs).toBe(2100);
  });

  it("toggle LOOP OFF immediately before OUT continues through OUT", () => {
    const p = ranged();
    p.loop = true;
    p.playheadMs = 1980;
    p.loop = false;
    const next = advancePlayhead(p, 40);
    expect(next.stopped).toBe(false);
    expect(next.playheadMs).toBe(2020);
  });

  it("seeking after OUT with LOOP OFF is valid and playback continues", () => {
    const p = ranged();
    p.loop = false;
    p.playheadMs = 3500;
    expect(playbackBounds(p).endMs).toBe(5000);
    const next = advancePlayhead(p, 100);
    expect(next.stopped).toBe(false);
    expect(next.playheadMs).toBe(3600);
  });

  it("project/media end still stops when LOOP is off", () => {
    const p = ranged();
    p.loop = false;
    p.playheadMs = 4950;
    const stopped = advancePlayhead(p, 100);
    expect(stopped.stopped).toBe(true);
    expect(stopped.playheadMs).toBe(5000);
  });
});
