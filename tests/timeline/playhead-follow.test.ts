import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applyPlayhead,
  applyToggleFollow,
  applyToggleLoop,
  applyTimelineViewport,
  createSession,
  type Session,
} from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { FRAME_MS } from "../../src/core/models";
import { advancePlayhead } from "../../src/core/playback";
import {
  FOLLOW_ANCHOR_RATIO,
  playheadInView,
  playheadViewRatio,
  scrollFollowPlayhead,
  visibleDurationMs,
} from "../../src/core/zoom";
import { asset, clip, projectWith } from "../helpers";

const LANE = 1000;

function zoomedSession(): Session {
  const a = asset({ id: "wav", kind: "audio", durationMs: 120_000, name: "long.wav" });
  const c = clip({ id: "c1", assetId: "wav", trackId: "A1", startMs: 0, durationMs: 120_000 });
  return {
    ...createSession(createMemoryBlobStore()),
    timelineWidthPx: LANE,
    project: { ...projectWith([c], [a]), zoomPxPerSec: 200, scrollMs: 0, playheadMs: 0 },
  };
}

describe("playhead follow (P46)", () => {
  it("applyPlayhead pages scroll when the needle leaves the view", () => {
    const start = zoomedSession();
    expect(playheadInView(30_000, 0, 200, LANE)).toBe(false);
    const next = applyPlayhead(start, 30_000);
    expect(next.project.playheadMs).toBe(30_000);
    expect(next.project.scrollMs).toBeGreaterThan(0);
    expect(playheadInView(30_000, next.project.scrollMs, 200, LANE)).toBe(true);
    expect(next.history.past.length).toBe(start.history.past.length);
    const visible = visibleDurationMs(200, LANE);
    expect(next.project.scrollMs).toBeCloseTo(30_000 - visible, 5);
  });

  it("leaves scroll alone when the playhead is already visible", () => {
    const start = zoomedSession();
    const next = applyPlayhead(start, 500);
    expect(next.project.playheadMs).toBe(500);
    expect(next.project.scrollMs).toBe(0);
  });

  it("goto next/prev edit follows; Follow off does not scroll", () => {
    const start = zoomedSession();
    start.project = {
      ...start.project,
      playheadMs: 0,
      markers: [{ id: "m1", timeMs: 40_000, label: "far" }],
    };
    const jumped = applyCommand(start, { type: "gotoNextEdit" });
    expect(jumped.project.playheadMs).toBe(40_000);
    expect(playheadInView(40_000, jumped.project.scrollMs, 200, LANE)).toBe(true);

    const off = applyToggleFollow(start);
    expect(off.followPlayhead).toBe(false);
    const stayed = applyCommand(off, { type: "gotoNextEdit" });
    expect(stayed.project.playheadMs).toBe(40_000);
    expect(stayed.project.scrollMs).toBe(0);
    expect(playheadInView(40_000, 0, 200, LANE)).toBe(false);
  });

  it("frame-step snaps toward nearby edges, not back onto itself (P88)", () => {
    const start = zoomedSession();
    start.project = {
      ...start.project,
      playheadMs: 1930,
      snap: true,
      markers: [{ id: "m1", timeMs: 2000, label: "M" }],
    };
    const snapped = applyCommand(start, { type: "nudgePlayhead", deltaMs: FRAME_MS });
    expect(snapped.project.playheadMs).toBe(2000);

    const off = applyCommand(
      { ...start, project: { ...start.project, snap: false } },
      { type: "nudgePlayhead", deltaMs: FRAME_MS },
    );
    expect(off.project.playheadMs).toBeCloseTo(1930 + FRAME_MS, 5);

    const leave = applyCommand(snapped, { type: "nudgePlayhead", deltaMs: FRAME_MS });
    expect(leave.project.playheadMs).toBeCloseTo(2000 + FRAME_MS, 5);

    const exact = applyPlayhead(start, 1966);
    expect(exact.project.playheadMs).toBe(1966);
  });

  it("viewport report is view-state only", () => {
    const start = zoomedSession();
    const past = start.history.past.length;
    const next = applyTimelineViewport(start, 800, 80);
    expect(next.timelineWidthPx).toBe(800);
    expect(next.timelineLaneLabelPx).toBe(80);
    expect(next.history.past.length).toBe(past);
    expect(applyTimelineViewport(next, 800, 80)).toBe(next);
  });
});

function ratioOf(session: Session): number {
  return playheadViewRatio(
    session.project.playheadMs,
    session.project.scrollMs,
    session.project.zoomPxPerSec,
    session.timelineWidthPx,
    session.timelineLaneLabelPx,
  );
}

function transportTo(session: Session, timeMs: number): Session {
  return applyPlayhead(session, timeMs, "transport");
}

describe("playhead follow transport pin", () => {
  it("Follow OFF does not auto-scroll during transport past the anchor", () => {
    const start = applyToggleFollow(zoomedSession());
    expect(start.followPlayhead).toBe(false);
    const visible = visibleDurationMs(200, LANE);
    const pastAnchor = visible * 0.8;
    const next = transportTo(start, pastAnchor);
    expect(next.project.playheadMs).toBe(pastAnchor);
    expect(next.project.scrollMs).toBe(0);
    expect(ratioOf(next)).toBeGreaterThan(FOLLOW_ANCHOR_RATIO);
  });

  it("Follow ON walks through the left of the view without scrolling", () => {
    const start = zoomedSession();
    const visible = visibleDurationMs(200, LANE);
    const before = visible * 0.4;
    const next = transportTo(start, before);
    expect(next.project.scrollMs).toBe(0);
    expect(next.project.playheadMs).toBe(before);
    expect(ratioOf(next)).toBeCloseTo(0.4, 5);
  });

  it("Follow ON pins near 65% and scrolls shared scrollMs after the anchor", () => {
    const start = zoomedSession();
    const visible = visibleDurationMs(200, LANE);
    const after = visible * 0.8;
    const next = transportTo(start, after);
    expect(next.project.playheadMs).toBe(after);
    expect(next.project.scrollMs).toBeCloseTo(after - visible * FOLLOW_ANCHOR_RATIO, 5);
    expect(ratioOf(next)).toBeCloseTo(FOLLOW_ANCHOR_RATIO, 5);
    expect(playheadInView(after, next.project.scrollMs, 200, LANE)).toBe(true);
  });

  it("after the anchor, sequential ticks scroll content and keep the pin stable", () => {
    const start = zoomedSession();
    const visible = visibleDurationMs(200, LANE);
    const step = 16;
    let s = transportTo(start, visible * FOLLOW_ANCHOR_RATIO);
    expect(s.project.scrollMs).toBeCloseTo(0, 5);
    const ratios: number[] = [ratioOf(s)];
    const scrolls: number[] = [s.project.scrollMs];
    for (let i = 0; i < 40; i++) {
      s = transportTo(s, s.project.playheadMs + step);
      ratios.push(ratioOf(s));
      scrolls.push(s.project.scrollMs);
    }
    expect(scrolls[scrolls.length - 1]).toBeGreaterThan(scrolls[0]);
    for (let i = 1; i < scrolls.length; i++) {
      expect(scrolls[i]).toBeGreaterThanOrEqual(scrolls[i - 1] - 1e-6);
    }
    for (const r of ratios.slice(1)) {
      expect(r).toBeCloseTo(FOLLOW_ANCHOR_RATIO, 4);
    }
    const uniqueScroll = new Set(scrolls.slice(1).map((v) => Math.round(v * 1000)));
    expect(uniqueScroll.size).toBeGreaterThan(10);
  });

  it("one shared scrollMs keeps ruler / VIS / V / A lanes on the same time axis", () => {
    const start = zoomedSession();
    const visible = visibleDurationMs(200, LANE);
    const next = transportTo(start, visible * 0.9);
    expect(next.project.scrollMs).toBeGreaterThan(0);
    const zoom = next.project.zoomPxPerSec;
    const scroll = next.project.scrollMs;
    const times = [0, next.project.playheadMs, 10_000, 40_000];
    const xs = times.map((ms) => ((ms - scroll) / 1000) * zoom);
    const again = times.map((ms) => ((ms - next.project.scrollMs) / 1000) * zoom);
    expect(xs).toEqual(again);
  });

  it("zoomed-out overview does not invent scroll when the project already fits", () => {
    const start = zoomedSession();
    start.project = { ...start.project, zoomPxPerSec: 2, playheadMs: 0, scrollMs: 0 };
    const visible = visibleDurationMs(2, LANE);
    expect(visible).toBeGreaterThan(100_000);
    const next = transportTo(start, 80_000);
    expect(next.project.scrollMs).toBe(0);
    expect(next.project.playheadMs).toBe(80_000);
    expect(ratioOf(next)).toBeLessThan(FOLLOW_ANCHOR_RATIO);
  });

  it("precision zoom (~1775 px/s) still pins and scrolls without oscillation", () => {
    const start = zoomedSession();
    start.project = { ...start.project, zoomPxPerSec: 1775, playheadMs: 0, scrollMs: 0 };
    const visible = visibleDurationMs(1775, LANE);
    expect(visible).toBeLessThan(600);
    let s = transportTo(start, visible * 0.2);
    expect(s.project.scrollMs).toBe(0);
    s = transportTo(s, visible * 0.7);
    expect(ratioOf(s)).toBeCloseTo(FOLLOW_ANCHOR_RATIO, 4);
    const pinned = s.project.scrollMs;
    s = transportTo(s, s.project.playheadMs + 8);
    expect(s.project.scrollMs).toBeGreaterThan(pinned);
    expect(ratioOf(s)).toBeCloseTo(FOLLOW_ANCHOR_RATIO, 4);
    s = transportTo(s, s.project.playheadMs + 8);
    expect(ratioOf(s)).toBeCloseTo(FOLLOW_ANCHOR_RATIO, 4);
  });

  it("seek during playback stays in-view without forcing a pin; transport then pins", () => {
    const start = zoomedSession();
    start.playing = true;
    const visible = visibleDurationMs(200, LANE);
    const walking = applyPlayhead(start, visible * 0.3);
    expect(walking.project.scrollMs).toBe(0);
    const seeked = applyPlayhead(walking, visible * 0.85);
    expect(seeked.project.scrollMs).toBe(0);
    expect(ratioOf(seeked)).toBeCloseTo(0.85, 5);
    const continued = transportTo(seeked, seeked.project.playheadMs + 16);
    expect(continued.project.scrollMs).toBeGreaterThan(0);
    expect(ratioOf(continued)).toBeCloseTo(FOLLOW_ANCHOR_RATIO, 4);
  });

  it("loop wrap while Follow ON walks from IN again when IN is left of the pin", () => {
    const start = zoomedSession();
    const visible = visibleDurationMs(200, LANE);
    start.project = {
      ...start.project,
      loop: true,
      inPointMs: 500,
      outPointMs: Math.round(visible * 0.8),
      playheadMs: Math.round(visible * 0.8) - 10,
    };
    const beforeWrap = transportTo(start, start.project.playheadMs);
    expect(beforeWrap.project.scrollMs).toBeGreaterThan(0);
    const stepped = advancePlayhead(beforeWrap.project, 20);
    expect(stepped.playheadMs).toBe(500);
    const wrapped = transportTo(beforeWrap, stepped.playheadMs);
    expect(wrapped.project.playheadMs).toBe(500);
    expect(ratioOf(wrapped)).toBeLessThan(FOLLOW_ANCHOR_RATIO);
    const after = transportTo(wrapped, 500 + 16);
    expect(after.project.playheadMs).toBe(516);
    expect(ratioOf(after)).toBeLessThan(FOLLOW_ANCHOR_RATIO);
  });

  it("scrollFollowPlayhead is monotonic and does not recenter behind the playhead", () => {
    const zoom = 200;
    const duration = 120_000;
    let scroll = 0;
    let playhead = 0;
    const ratios: number[] = [];
    for (let i = 0; i < 200; i++) {
      playhead += 33;
      const next = scrollFollowPlayhead(playhead, scroll, zoom, LANE, duration);
      expect(next).toBeGreaterThanOrEqual(scroll - 1e-9);
      scroll = next;
      ratios.push(playheadViewRatio(playhead, scroll, zoom, LANE));
    }
    const anchored = ratios.filter((_, i) => playheadViewRatio((i + 1) * 33, 0, zoom, LANE) >= FOLLOW_ANCHOR_RATIO);
    expect(anchored.length).toBeGreaterThan(10);
    for (const r of ratios) {
      expect(r).toBeLessThanOrEqual(FOLLOW_ANCHOR_RATIO + 1e-6);
    }
  });

  it("Follow ON + LOOP OFF crosses OUT as a marker and keeps pinning", () => {
    const start = zoomedSession();
    start.project = {
      ...start.project,
      loop: false,
      inPointMs: 800,
      outPointMs: 1600,
      playheadMs: 1500,
    };
    const visible = visibleDurationMs(200, LANE);
    expect(1600).toBeLessThan(visible * FOLLOW_ANCHOR_RATIO);
    const before = transportTo(start, 1500);
    const stepped = advancePlayhead(before.project, 200);
    expect(stepped.stopped).toBe(false);
    expect(stepped.playheadMs).toBe(1700);
    const after = transportTo(before, stepped.playheadMs);
    expect(after.project.playheadMs).toBe(1700);
    expect(after.project.outPointMs).toBe(1600);
    expect(after.project.loop).toBe(false);
    expect(after.project.scrollMs).toBe(0);
    const toggled = applyToggleLoop({ ...start, project: { ...start.project, loop: true, playheadMs: 1550 } });
    expect(toggled.project.loop).toBe(false);
    const through = advancePlayhead(toggled.project, 100);
    expect(through.playheadMs).toBe(1650);
    expect(through.stopped).toBe(false);
  });
});
