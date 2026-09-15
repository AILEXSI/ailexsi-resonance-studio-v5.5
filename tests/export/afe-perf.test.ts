import { afterEach, describe, expect, it } from "vitest";
import {
  afePerfAdd,
  afePerfCount,
  afePerfEnabled,
  beginAfePerf,
  endAfePerf,
  peekAfePerf,
  summarizePhases,
} from "../../src/core/frame-engine";
import { wallStats } from "../../scripts/afe-bench";

afterEach(() => {
  endAfePerf();
});

describe("AfePerfStats local telemetry", () => {
  it("is disabled until beginAfePerf and does not accumulate", () => {
    expect(afePerfEnabled()).toBe(false);
    afePerfCount("decoderResets", 4);
    afePerfAdd("videoDecode", 12);
    expect(peekAfePerf()).toBeNull();
    expect(endAfePerf()).toBeNull();
  });

  it("records exclusive phases and counts for one backend session", () => {
    beginAfePerf("ailexsi");
    expect(afePerfEnabled()).toBe(true);
    afePerfAdd("sourceOpen", 3);
    afePerfAdd("containerParse", 5);
    afePerfAdd("sampleTableBuild", 2);
    afePerfCount("decoderCreates");
    afePerfCount("decoderFlushes", 2);
    afePerfCount("cacheHits", 3);
    afePerfCount("cacheMisses", 1);
    const snap = endAfePerf();
    expect(snap).not.toBeNull();
    expect(snap!.backend).toBe("ailexsi");
    expect(snap!.phasesMs.sourceOpen).toBe(3);
    expect(snap!.phasesMs.containerParse).toBe(5);
    expect(snap!.phasesMs.sampleTableBuild).toBe(2);
    expect(snap!.phasesMs.videoDecode).toBe(0);
    expect(snap!.counts.decoderCreates).toBe(1);
    expect(snap!.counts.decoderFlushes).toBe(2);
    expect(snap!.counts.cacheHits).toBe(3);
    expect(afePerfEnabled()).toBe(false);
    const ranked = summarizePhases(snap!);
    expect(ranked[0]!.phase).toBe("containerParse");
  });

  it("wallStats reports median / mean / p50 / p95 / worst / stddev", () => {
    const s = wallStats([10, 20, 30, 40, 100]);
    expect(s.n).toBe(5);
    expect(s.median).toBe(30);
    expect(s.p50).toBe(30);
    expect(s.mean).toBe(40);
    expect(s.worst).toBe(100);
    expect(s.min).toBe(10);
    expect(s.p95).toBe(100);
    expect(s.stddev).toBeCloseTo(Math.sqrt(1000), 8);
  });
});
