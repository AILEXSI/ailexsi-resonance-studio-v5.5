import { describe, expect, it } from "vitest";
import { AFE_MAX_REORDER_READY, PtsIndexMap, classifyCtts, maxReorderSamples } from "../../src/core/frame-engine";

describe("AFE PTS-keyed frame match (no FIFO identity, no nearest)", () => {
  it("matches exact PTS and leaves unmatched timestamps undefined", () => {
    const map = new PtsIndexMap();
    map.push(0, 0);
    map.push(100_000, 2);
    map.push(66_667, 1);
    expect(map.takeExact(66_667)).toBe(1);
    expect(map.takeExact(0)).toBe(0);
    expect(map.takeExact(100_000)).toBe(2);
    expect(map.takeExact(66_667)).toBeUndefined();
    expect(map.takeExact(1)).toBeUndefined();
    expect(map.takeExact(66_668)).toBeUndefined();
  });

  it("keeps duplicate timestamps in stable submit order", () => {
    const map = new PtsIndexMap();
    map.push(1000, 4);
    map.push(1000, 9);
    map.push(1000, 11);
    expect(map.takeExact(1000)).toBe(4);
    expect(map.takeExact(1000)).toBe(9);
    expect(map.takeExact(1000)).toBe(11);
    expect(map.takeExact(1000)).toBeUndefined();
  });

  it("does not assign FIFO / nearest when PTS does not match", () => {
    const map = new PtsIndexMap();
    map.push(0, 0);
    map.push(3000, 1);
    map.push(1000, 2);
    expect(map.takeExact(1000)).toBe(2);
    expect(map.takeExact(1)).toBeUndefined();
    expect(map.takeExact(2999)).toBeUndefined();
    expect(map.takeExact(3001)).toBeUndefined();
    expect(map.hasIndex(1)).toBe(true);
    expect(map.takeExact(3000)).toBe(1);
  });

  it("classifies CTTS and measures IBBP reorder delay", () => {
    expect(classifyCtts(null)).toBe("absent");
    expect(classifyCtts([1024, 1024, 1024])).toBe("constant");
    expect(classifyCtts([2048, 0, 1024, 1024])).toBe("variable");
    const ibbp = [
      { index: 0, ptsTimescale: 0 },
      { index: 1, ptsTimescale: 3000 },
      { index: 2, ptsTimescale: 1000 },
      { index: 3, ptsTimescale: 2000 },
    ];
    expect(maxReorderSamples(ibbp)).toBe(1);
    expect(AFE_MAX_REORDER_READY).toBe(64);
  });

  it("pendingCount tracks push/take/delete/clear", () => {
    const map = new PtsIndexMap();
    map.push(1, 0);
    map.push(2, 1);
    expect(map.pendingCount()).toBe(2);
    expect(map.deleteIndex(1)).toBe(true);
    expect(map.pendingCount()).toBe(1);
    expect(map.takeExact(1)).toBe(0);
    expect(map.pendingCount()).toBe(0);
    map.push(3, 2);
    map.clear();
    expect(map.pendingCount()).toBe(0);
    expect(map.takeExact(3)).toBeUndefined();
  });
});
