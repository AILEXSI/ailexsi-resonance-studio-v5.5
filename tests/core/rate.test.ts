import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { jobFromProject } from "../../src/core/exporter/job";
import { sourceTimeSec } from "../../src/core/exporter/frame-source";
import {
  clipRateOf,
  sourceDeltaToTimeline,
  sourceTimeAt,
  timelineDeltaToSource,
  timelineDurationForRate,
} from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import {
  placeAsset,
  rippleTrimClip,
  rollEdit,
  setClipRate,
  slideClip,
  slideClips,
  slipClip,
  splitClipAt,
  trimClip,
  updateClip,
} from "../../src/core/timeline";
import { asset, clip, projectWith } from "../helpers";

function rateSession(): Session {
  const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
  const c = clip({
    id: "c1",
    assetId: "aa",
    trackId: "A1",
    startMs: 0,
    durationMs: 2000,
    sourceInMs: 0,
    sourceOutMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith([c], [a]),
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
  };
}

describe("clip rate defaults and math", () => {
  it("defaults to 1 and maps duration = sourceSpan / rate at 0.5 / 1 / 2", () => {
    expect(clipRateOf(clip({ id: "c", assetId: "a", trackId: "A1" }))).toBe(1);
    expect(timelineDurationForRate(2000, 1)).toBe(2000);
    expect(timelineDurationForRate(2000, 2)).toBe(1000);
    expect(timelineDurationForRate(2000, 0.5)).toBe(4000);
  });

  it("setClipRate keeps the source window and resizes timeline duration", () => {
    const start = rateSession();
    const half = setClipRate(start.project, "c1", 2);
    expect(half.error).toBeUndefined();
    const fast = half.project.clips[0]!;
    expect(fast.rate).toBe(2);
    expect(fast.durationMs).toBe(1000);
    expect(fast.sourceInMs).toBe(0);
    expect(fast.sourceOutMs).toBe(2000);

    const slow = setClipRate(start.project, "c1", 0.5);
    expect(slow.project.clips[0]!.durationMs).toBe(4000);
    expect(slow.project.clips[0]!.sourceOutMs).toBe(2000);
  });

  it("rejects a slower rate that would overlap the next clip", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "c2",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
      ],
      [a],
    );
    const rejected = setClipRate(p, "c1", 0.5);
    expect(rejected.project).toBe(p);
    expect(rejected.error).toMatch(/overlap/i);
    expect(rejected.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
    expect(rejected.project.clips.find((c) => c.id === "c1")!.rate).toBe(1);
  });

  it("grows through a later disabled unlocked take (P136)", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "off",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          enabled: false,
        }),
      ],
      [a],
    );
    const next = setClipRate(p, "c1", 0.5);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "off")!.startMs).toBe(1000);
    expect(next.project.clips.find((c) => c.id === "off")!.enabled).toBe(false);
  });

  it("still refuses grow into a later locked clip even if that clip is disabled (P136)", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "wall",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          enabled: false,
          locked: true,
        }),
      ],
      [a],
    );
    const rejected = setClipRate(p, "c1", 0.5);
    expect(rejected.error).toMatch(/overlap/i);
    expect(rejected.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
  });

  it("speeding up that shrinks into a gap succeeds", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
        }),
        clip({
          id: "c2",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 500,
        }),
      ],
      [a],
    );
    const next = setClipRate(p, "c1", 2);
    expect(next.error).toBeUndefined();
    expect(next.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(500);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
  });
});

describe("setClipRate command + persist + clocks", () => {
  it("applyCommand setClipRate writes rate in one history entry", () => {
    const start = rateSession();
    const next = applyCommand(start, { type: "setClipRate", clipId: "c1", rate: 2 });
    expect(next.project.clips[0]!.rate).toBe(2);
    expect(next.project.clips[0]!.durationMs).toBe(1000);
    expect(next.history.past.length).toBe(start.history.past.length + 1);
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.clips[0]!.rate).toBe(1);
    expect(undone.project.clips[0]!.durationMs).toBe(2000);
  });

  it("legacy project JSON without rate loads as 1", () => {
    const p = projectWith(
      [clip({ id: "c1", assetId: "a1", trackId: "A1", startMs: 0, durationMs: 500 })],
      [asset({ id: "a1", kind: "audio", durationMs: 500 })],
    );
    const raw = JSON.parse(serializeProject(p)) as { clips: Array<Record<string, unknown>> };
    delete raw.clips[0]!.rate;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.clips[0]!.rate).toBe(1);
  });

  it("placeAsset writes rate 1; sourceTimeAt and export clock use rate", () => {
    let project = projectWith([], [asset({ id: "a1", kind: "audio", durationMs: 2000 })]);
    const placed = placeAsset(project, "a1", "A1", 0);
    expect(placed.clip!.rate).toBe(1);
    const c = clip({
      id: "c",
      assetId: "a",
      trackId: "A1",
      startMs: 1000,
      durationMs: 500,
      sourceInMs: 200,
      sourceOutMs: 1200,
      rate: 2,
    });
    expect(sourceTimeAt(c, 1000)).toBe(200);
    expect(sourceTimeAt(c, 1250)).toBe(700);
    const job = jobFromProject(
      projectWith(
        [
          clip({
            id: "c1",
            assetId: "a1",
            trackId: "A1",
            startMs: 0,
            durationMs: 500,
            sourceInMs: 0,
            sourceOutMs: 1000,
            rate: 2,
          }),
        ],
        [asset({ id: "a1", kind: "audio", durationMs: 2000, objectUrl: "blob:t", missing: false })],
      ),
    );
    const exp = job.tracks.find((t) => t.id === "A1")!.clips[0]!;
    expect(exp.rate).toBe(2);
    expect(sourceTimeSec(exp, 0, 30)).toBeCloseTo(500 / 30 / 1000, 5);
    expect(sourceTimeSec(exp, 250, 30)).toBeCloseTo((250 * 2 + 500 / 30) / 1000, 5);
  });
});

function ratedClip(rate: 2 | 0.5) {
  const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
  const c =
    rate === 2
      ? clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          rate: 2,
        })
      : clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          rate: 0.5,
        });
  return projectWith([c], [a]);
}

describe("rate-aware source mapping on edits", () => {
  it("timelineDeltaToSource and reverse stay identity at rate 1", () => {
    const c = clip({ id: "c", assetId: "a", trackId: "A1" });
    expect(timelineDeltaToSource(c, 200)).toBe(200);
    expect(sourceDeltaToTimeline(c, 200)).toBe(200);
    expect(timelineDeltaToSource({ rate: 2 }, 200)).toBe(400);
    expect(sourceDeltaToTimeline({ rate: 2 }, 400)).toBe(200);
    expect(timelineDeltaToSource({ rate: 0.5 }, 200)).toBe(100);
    expect(sourceDeltaToTimeline({ rate: 0.5 }, 100)).toBe(200);
  });

  it("out-trim at rate 2 and 0.5 maps Δtimeline × rate onto sourceOut", () => {
    const fast = trimClip(ratedClip(2), "c1", "out", 800);
    expect(fast.error).toBeUndefined();
    expect(fast.project.clips[0]!.durationMs).toBe(800);
    expect(fast.project.clips[0]!.sourceInMs).toBe(0);
    expect(fast.project.clips[0]!.sourceOutMs).toBe(1600);
    expect(fast.project.clips[0]!.rate).toBe(2);

    const slow = trimClip(ratedClip(0.5), "c1", "out", 1800);
    expect(slow.error).toBeUndefined();
    expect(slow.project.clips[0]!.durationMs).toBe(1800);
    expect(slow.project.clips[0]!.sourceOutMs).toBe(900);
    expect(slow.project.clips[0]!.rate).toBe(0.5);
  });

  it("in-trim at rate 2 and 0.5 maps Δtimeline × rate onto sourceIn", () => {
    const fast = trimClip(ratedClip(2), "c1", "in", 200);
    expect(fast.error).toBeUndefined();
    expect(fast.project.clips[0]!.startMs).toBe(200);
    expect(fast.project.clips[0]!.durationMs).toBe(800);
    expect(fast.project.clips[0]!.sourceInMs).toBe(400);
    expect(fast.project.clips[0]!.sourceOutMs).toBe(2000);
    expect(fast.project.clips[0]!.rate).toBe(2);

    const slow = trimClip(ratedClip(0.5), "c1", "in", 200);
    expect(slow.error).toBeUndefined();
    expect(slow.project.clips[0]!.startMs).toBe(200);
    expect(slow.project.clips[0]!.durationMs).toBe(1800);
    expect(slow.project.clips[0]!.sourceInMs).toBe(100);
    expect(slow.project.clips[0]!.sourceOutMs).toBe(1000);
    expect(slow.project.clips[0]!.rate).toBe(0.5);
  });

  it("inspector duration writes sourceOut = sourceIn + duration × rate", () => {
    const fast = updateClip(ratedClip(2), "c1", { durationMs: 800 });
    expect(fast.error).toBeUndefined();
    expect(fast.project.clips[0]!.durationMs).toBe(800);
    expect(fast.project.clips[0]!.sourceOutMs).toBe(1600);
    expect(fast.project.clips[0]!.rate).toBe(2);

    const slow = updateClip(ratedClip(0.5), "c1", { durationMs: 1800 });
    expect(slow.project.clips[0]!.durationMs).toBe(1800);
    expect(slow.project.clips[0]!.sourceOutMs).toBe(900);

    const sourceIn = updateClip(ratedClip(2), "c1", { sourceInMs: 400 });
    expect(sourceIn.project.clips[0]!.sourceInMs).toBe(400);
    expect(sourceIn.project.clips[0]!.sourceOutMs).toBe(2000);
    expect(sourceIn.project.clips[0]!.durationMs).toBe(800);

    const sourceOut = updateClip(ratedClip(0.5), "c1", { sourceOutMs: 800 });
    expect(sourceOut.project.clips[0]!.sourceOutMs).toBe(800);
    expect(sourceOut.project.clips[0]!.durationMs).toBe(1600);
  });

  it("split at rate 2 and 0.5 cuts at sourceTimeAt and keeps rate on both halves", () => {
    const fast = splitClipAt(ratedClip(2), "c1", 500);
    expect(fast.error).toBeUndefined();
    const [fl, fr] = fast.project.clips;
    expect(sourceTimeAt(ratedClip(2).clips[0]!, 500)).toBe(1000);
    expect(fl!.durationMs).toBe(500);
    expect(fl!.sourceOutMs).toBe(1000);
    expect(fl!.rate).toBe(2);
    expect(fr!.startMs).toBe(500);
    expect(fr!.sourceInMs).toBe(1000);
    expect(fr!.sourceOutMs).toBe(2000);
    expect(fr!.rate).toBe(2);

    const slow = splitClipAt(ratedClip(0.5), "c1", 1000);
    const [sl, sr] = slow.project.clips;
    expect(sourceTimeAt(ratedClip(0.5).clips[0]!, 1000)).toBe(500);
    expect(sl!.sourceOutMs).toBe(500);
    expect(sl!.rate).toBe(0.5);
    expect(sr!.sourceInMs).toBe(500);
    expect(sr!.rate).toBe(0.5);
  });

  it("ripple-trim at rate 2 maps source on the rated clip; rate-1 neighbor stays 1:1", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          rate: 2,
        }),
        clip({
          id: "c2",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          rate: 1,
        }),
      ],
      [a],
    );
    const rippled = rippleTrimClip(p, "c1", "out", 800);
    expect(rippled.error).toBeUndefined();
    const left = rippled.project.clips.find((c) => c.id === "c1")!;
    const right = rippled.project.clips.find((c) => c.id === "c2")!;
    expect(left.durationMs).toBe(800);
    expect(left.sourceOutMs).toBe(1600);
    expect(left.rate).toBe(2);
    expect(right.startMs).toBe(800);
    expect(right.sourceInMs).toBe(0);
    expect(right.sourceOutMs).toBe(1000);
    expect(right.rate).toBe(1);
  });

  it("roll at rate 2 on the left and rate 1 on the right maps each clip by its own rate", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "c1",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          rate: 2,
        }),
        clip({
          id: "c2",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          rate: 1,
        }),
      ],
      [a],
    );
    const rolled = rollEdit(p, "c1", "c2", 1200);
    expect(rolled.error).toBeUndefined();
    const left = rolled.project.clips.find((c) => c.id === "c1")!;
    const right = rolled.project.clips.find((c) => c.id === "c2")!;
    expect(left.durationMs).toBe(1200);
    expect(left.sourceOutMs).toBe(2400);
    expect(left.rate).toBe(2);
    expect(right.startMs).toBe(1200);
    expect(right.durationMs).toBe(800);
    expect(right.sourceInMs).toBe(200);
    expect(right.sourceOutMs).toBe(1000);
    expect(right.rate).toBe(1);
  });

  it("slip converts a timeline/nudge delta through rate so rate 2 consumes 2× source", () => {
    const slipped = slipClip(ratedClip(2), "c1", 100);
    expect(slipped.project.clips[0]!.startMs).toBe(0);
    expect(slipped.project.clips[0]!.durationMs).toBe(1000);
    expect(slipped.project.clips[0]!.sourceInMs).toBe(200);
    expect(slipped.project.clips[0]!.sourceOutMs).toBe(2200);
    expect(slipped.project.clips[0]!.rate).toBe(2);

    const unity = slipClip(
      projectWith(
        [
          clip({
            id: "c1",
            assetId: "aa",
            trackId: "A1",
            startMs: 0,
            durationMs: 1000,
            sourceInMs: 0,
            sourceOutMs: 1000,
          }),
        ],
        [asset({ id: "aa", kind: "audio", durationMs: 4000 })],
      ),
      "c1",
      100,
    );
    expect(unity.project.clips[0]!.sourceInMs).toBe(100);
    expect(unity.project.clips[0]!.sourceOutMs).toBe(1100);
  });

  it("slide maps neighbor source windows through each clip's rate; middle source stays", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 4000 });
    const p = projectWith(
      [
        clip({
          id: "L",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          rate: 2,
        }),
        clip({
          id: "M",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 100,
          sourceOutMs: 1100,
          rate: 1,
        }),
        clip({
          id: "R",
          assetId: "aa",
          trackId: "A1",
          startMs: 2000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 1000,
          rate: 1,
        }),
      ],
      [a],
    );
    const slid = slideClip(p, "M", 200);
    expect(slid.error).toBeUndefined();
    const L = slid.project.clips.find((c) => c.id === "L")!;
    const M = slid.project.clips.find((c) => c.id === "M")!;
    const R = slid.project.clips.find((c) => c.id === "R")!;
    expect(L.durationMs).toBe(1200);
    expect(L.sourceOutMs).toBe(2400);
    expect(L.rate).toBe(2);
    expect(M.startMs).toBe(1200);
    expect(M.durationMs).toBe(1000);
    expect(M.sourceInMs).toBe(100);
    expect(M.sourceOutMs).toBe(1100);
    expect(R.startMs).toBe(2200);
    expect(R.durationMs).toBe(800);
    expect(R.sourceInMs).toBe(200);
    expect(R.rate).toBe(1);
  });

  it("group slide maps outer neighbor source through each clip's rate; block source stays", () => {
    const a = asset({ id: "aa", kind: "audio", durationMs: 8000 });
    const p = projectWith(
      [
        clip({
          id: "L",
          assetId: "aa",
          trackId: "A1",
          startMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          rate: 2,
        }),
        clip({
          id: "A",
          assetId: "aa",
          trackId: "A1",
          startMs: 1000,
          durationMs: 1000,
          sourceInMs: 50,
          sourceOutMs: 1050,
          rate: 1,
        }),
        clip({
          id: "B",
          assetId: "aa",
          trackId: "A1",
          startMs: 2000,
          durationMs: 1000,
          sourceInMs: 80,
          sourceOutMs: 1080,
          rate: 1,
        }),
        clip({
          id: "R",
          assetId: "aa",
          trackId: "A1",
          startMs: 3000,
          durationMs: 1000,
          sourceInMs: 0,
          sourceOutMs: 500,
          rate: 0.5,
        }),
      ],
      [a],
    );
    const slid = slideClips(p, ["A", "B"], 200);
    expect(slid.error).toBeUndefined();
    const L = slid.project.clips.find((c) => c.id === "L")!;
    const A = slid.project.clips.find((c) => c.id === "A")!;
    const B = slid.project.clips.find((c) => c.id === "B")!;
    const R = slid.project.clips.find((c) => c.id === "R")!;
    expect(L.durationMs).toBe(1200);
    expect(L.sourceOutMs).toBe(2400);
    expect(L.rate).toBe(2);
    expect(A.startMs).toBe(1200);
    expect(B.startMs).toBe(2200);
    expect(A.sourceInMs).toBe(50);
    expect(A.sourceOutMs).toBe(1050);
    expect(B.sourceInMs).toBe(80);
    expect(B.sourceOutMs).toBe(1080);
    expect(A.rate).toBe(1);
    expect(B.rate).toBe(1);
    expect(R.startMs).toBe(3200);
    expect(R.durationMs).toBe(800);
    expect(R.sourceInMs).toBe(100);
    expect(R.rate).toBe(0.5);
  });
});
