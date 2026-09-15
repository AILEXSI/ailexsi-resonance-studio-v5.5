import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRequestPlan, summarizePlan } from "./afe-plan";
import {
  keyframeAtOrBefore,
  mapTimestampIntoTimescale,
  parseIsoBmff,
  sampleIndexAtTime,
  type AfeMovie,
  type AfeMismatch,
} from "../../src/core/frame-engine";

type Manifest = {
  generated: boolean;
  width: number;
  height: number;
  files: {
    id: string;
    path: string;
    fps: number;
    seconds: number;
    frames: number;
    gop: number;
    keyframeSec: number[];
    width?: number;
    height?: number;
  }[];
};

const PTS_EPS = 1e-6;

/** Linear scan of presentation order — independent of sampleIndexAtTime binary search. */
function expectedIndex(movie: AfeMovie, requestedSec: number): number | null {
  const t = mapTimestampIntoTimescale(requestedSec, movie.timescale, movie.editListOffset);
  let ans: number | null = null;
  for (const sample of movie.presentation) {
    if (sample.ptsTimescale <= t) ans = sample.index;
    else break;
  }
  return ans;
}

describe("AFE sample-table oracle (≥10,000 requests, Mediabunny-free)", () => {
  it("sampleIndexAtTime is self-consistent on the full plan", () => {
    const manifest = JSON.parse(readFileSync("tests/fixtures/afe/manifest.json", "utf8")) as Manifest;
    const rows = buildRequestPlan(manifest);
    const plan = summarizePlan(rows);
    expect(plan.total).toBeGreaterThanOrEqual(10_000);

    const movies = new Map<string, AfeMovie>();
    for (const file of manifest.files) {
      const bytes = new Uint8Array(readFileSync(file.path));
      movies.set(file.id, parseIsoBmff(bytes));
    }

    const mismatches: AfeMismatch[] = [];
    let compared = 0;
    let exact = 0;

    for (const row of rows) {
      const movie = movies.get(row.file)!;
      const afeIndex = sampleIndexAtTime(movie, row.requestedSec);
      const expectIndex = expectedIndex(movie, row.requestedSec);
      const afeSample = afeIndex == null ? null : movie.samples[afeIndex]!;
      const expectSample = expectIndex == null ? null : movie.samples[expectIndex]!;
      const afePts = afeSample ? afeSample.ptsTimescale / movie.timescale : null;
      const expectPts = expectSample ? expectSample.ptsTimescale / movie.timescale : null;
      compared += 1;

      const bothNull = afeIndex == null && expectIndex == null;
      const ptsMatch =
        afeIndex === expectIndex &&
        afePts != null &&
        expectPts != null &&
        Math.abs(afePts - expectPts) <= PTS_EPS;
      if (bothNull || ptsMatch) {
        exact += 1;
        continue;
      }

      mismatches.push({
        file: row.file,
        requestedSec: row.requestedSec,
        afeFrame: afeIndex,
        expectedPts: expectPts,
        afePts,
        dts: afeSample ? afeSample.dtsTimescale / movie.timescale : null,
        nearestKeyframe: afeIndex == null ? null : keyframeAtOrBefore(movie, afeIndex),
        frameDelta: afeIndex == null || expectPts == null ? null : afeIndex - Math.round(expectPts * row.fps),
      });
    }

    expect(compared).toBe(plan.total);
    expect(mismatches, JSON.stringify(mismatches.slice(0, 8), null, 2)).toHaveLength(0);
    expect(exact).toBe(compared);
  }, 120_000);

  it("historical V5 AFE-03 vs Mediabunny oracle stamp remains 10228/10228 (labelled)", () => {
    const summary = JSON.parse(readFileSync("docs/compliance/afe-oracle-summary.json", "utf8")) as {
      historical?: boolean;
      compared: number;
      exact: number;
      mismatches: number;
    };
    expect(summary.historical).toBe(true);
    expect(summary.compared).toBe(10228);
    expect(summary.exact).toBe(10228);
    expect(summary.mismatches).toBe(0);
  });

  it("jsdom cannot decode H.264 — pixel A/B lives in AFE-03 evidence", () => {
    expect(typeof VideoDecoder).toBe("undefined");
    const evidencePath = "docs/compliance/afe-03-evidence-summary.json";
    expect(existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      pixels?: { compared?: number; afe?: { EXACT?: number } };
      classification?: string;
    };
    expect(evidence.classification).toBe("AFE-EQUAL");
    expect(evidence.pixels?.compared).toBeGreaterThan(0);
    expect(evidence.pixels?.afe?.EXACT).toBe(evidence.pixels?.compared);
  });
});
