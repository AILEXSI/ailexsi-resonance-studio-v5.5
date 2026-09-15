import { describe, expect, it } from "vitest";
import {
  clipIntersectsMarquee,
  clipsIntersectingMarquee,
  tracksInLaneSpan,
} from "../../src/core/marquee";
import { clip } from "../helpers";

const a1 = clip({ id: "a1", assetId: "x", trackId: "A1", startMs: 0, durationMs: 1000 });
const a1b = clip({ id: "a1b", assetId: "x", trackId: "A1", startMs: 2000, durationMs: 800 });
const a2 = clip({ id: "a2", assetId: "x", trackId: "A2", startMs: 200, durationMs: 400 });
const v1 = clip({ id: "v1", assetId: "x", trackId: "V1", startMs: 0, durationMs: 500 });

describe("marquee time × track intersection", () => {
  it("selects clips whose body intersects the rect", () => {
    const hits = clipsIntersectingMarquee([a1, a1b, a2, v1], {
      aMs: 100,
      bMs: 800,
      aLane: "A1",
      bLane: "A1",
    });
    expect(hits.map((c) => c.id)).toEqual(["a1"]);
  });

  it("misses when the time window does not overlap", () => {
    const hits = clipsIntersectingMarquee([a1, a1b], {
      aMs: 1200,
      bMs: 1800,
      aLane: "A1",
      bLane: "A1",
    });
    expect(hits).toEqual([]);
  });

  it("spans tracks from VIS..A2 and ignores VIS (no clips)", () => {
    expect(tracksInLaneSpan("VIS", "A1")).toEqual(["V1", "V2", "A1"]);
    expect(tracksInLaneSpan("A2", "V1")).toEqual(["V1", "V2", "A1", "A2"]);
    const hits = clipsIntersectingMarquee([a1, a2, v1], {
      aMs: 0,
      bMs: 300,
      aLane: "V1",
      bLane: "A2",
    });
    expect(hits.map((c) => c.id)).toEqual(["v1", "a1", "a2"]);
    expect(
      clipIntersectsMarquee(a1, { aMs: 500, bMs: 500, aLane: "A1", bLane: "A1" }),
    ).toBe(true);
  });
});
