import { describe, expect, it } from "vitest";
import {
  HEADER_CONTROL_MIN_PX,
  HEADER_HYSTERESIS_PX,
  HEADER_PRIORITY,
  HEADER_WIDTH_MEDIUM_PX,
  HEADER_WIDTH_MIN_PX,
  HEADER_WIDTH_NARROW_PX,
  HEADER_WIDTH_WIDE_PX,
  controlIsDirect,
  controlIsOverflowed,
  headerControlsExclusive,
  planTrackHeaderOverflow,
  resolveHeaderWidth,
  stabilizeHeaderWidth,
  type HeaderControlId,
  type HeaderPack,
  type HeaderTrackKind,
} from "../../src/ui/timeline/track-header-overflow";
import { AILEXSI_PRODUCT_VERSION } from "../../src/core/build-info";
import {
  DEFAULT_LANE_HEIGHT_PX,
  LANE_LABEL_MAX_PX,
  LANE_LABEL_MIN_PX,
  laneHeaderPacksInline,
} from "../../src/core/layout-prefs";

const VIS: HeaderControlId[] = ["identity", "mute", "scene"];
const VIDEO: HeaderControlId[] = ["identity", "mute", "solo"];
const AUDIO: HeaderControlId[] = [
  "identity",
  "mute",
  "solo",
  "write",
  "volume",
  "groupAssign",
  "groupCreate",
  "addAudio",
  "removeAudio",
];

const WIDTHS = {
  WIDE: HEADER_WIDTH_WIDE_PX,
  MEDIUM: HEADER_WIDTH_MEDIUM_PX,
  NARROW: HEADER_WIDTH_NARROW_PX,
  MIN: HEADER_WIDTH_MIN_PX,
} as const;

function plan(kind: HeaderTrackKind, width: number, present: HeaderControlId[], pack: HeaderPack = "stack") {
  return planTrackHeaderOverflow({ kind, widthPx: width, pack, present });
}

describe("track header overflow policy", () => {
  it("RH-01 identity is never overflowed", () => {
    for (const kind of ["vis", "video", "audio"] as const) {
      const present = kind === "vis" ? VIS : kind === "video" ? VIDEO : AUDIO;
      for (const width of Object.values(WIDTHS)) {
        for (const pack of ["stack", "inline"] as const) {
          const p = plan(kind, width, present, pack);
          expect(p.visible).toContain("identity");
          expect(p.overflow).not.toContain("identity");
        }
      }
    }
  });

  it("RH-02…RH-08 exclusive invariant: each present control exactly once", () => {
    for (const kind of ["vis", "video", "audio"] as const) {
      const present = kind === "vis" ? VIS : kind === "video" ? VIDEO : AUDIO;
      for (const width of Object.values(WIDTHS)) {
        for (const pack of ["stack", "inline"] as const) {
          const p = plan(kind, width, present, pack);
          expect(headerControlsExclusive(present, p)).toBe(true);
        }
      }
    }
  });

  it("RH-05 overflow set empty iff every present control is direct", () => {
    const wideVideo = plan("video", WIDTHS.WIDE, VIDEO);
    expect(wideVideo.overflow).toEqual([]);
    expect(wideVideo.visible).toEqual(["identity", "mute", "solo"]);

    const minAudio = plan("audio", WIDTHS.MIN, AUDIO);
    expect(minAudio.overflow.length).toBeGreaterThan(0);
  });

  it("RH-10/11 widening returns lower-priority controls; narrowing hides them first", () => {
    const min = plan("audio", WIDTHS.MIN, AUDIO);
    const mid = plan("audio", WIDTHS.MEDIUM, AUDIO);
    const wide = plan("audio", WIDTHS.WIDE, AUDIO);
    expect(wide.overflow).toEqual([]);
    expect(mid.overflow.length).toBeGreaterThan(0);
    expect(min.overflow.length).toBeGreaterThanOrEqual(mid.overflow.length);
    expect(controlIsOverflowed(mid, "groupCreate")).toBe(true);
    expect(controlIsDirect(mid, "mute")).toBe(true);
    expect(controlIsDirect(mid, "solo")).toBe(true);
    expect(controlIsDirect(wide, "volume")).toBe(true);
    expect(controlIsDirect(wide, "groupAssign")).toBe(true);
  });

  it("VIS keeps mute direct; scene is the overflow candidate", () => {
    expect(HEADER_PRIORITY.vis).toEqual(["identity", "mute", "scene"]);
    const stackedMin = plan("vis", WIDTHS.MIN, VIS, "stack");
    expect(controlIsDirect(stackedMin, "mute")).toBe(true);
    expect(stackedMin.overflow).not.toContain("mute");

    const inlineMin = plan("vis", WIDTHS.MIN, VIS, "inline");
    expect(controlIsDirect(inlineMin, "mute")).toBe(true);
    expect(controlIsOverflowed(inlineMin, "scene")).toBe(true);
    expect(headerControlsExclusive(VIS, inlineMin)).toBe(true);
  });

  it("VIDEO has no invented secondaries and no overflow at legal widths", () => {
    expect(HEADER_PRIORITY.video).toEqual(["identity", "mute", "solo"]);
    for (const width of Object.values(WIDTHS)) {
      for (const pack of ["stack", "inline"] as const) {
        const p = plan("video", width, VIDEO, pack);
        expect(p.visible).toEqual(["identity", "mute", "solo"]);
        expect(p.overflow).toEqual([]);
      }
    }
  });

  it("AUDIO priority: write/VOL before group/chrome", () => {
    expect(HEADER_PRIORITY.audio.slice(0, 6)).toEqual([
      "identity",
      "mute",
      "solo",
      "write",
      "volume",
      "groupAssign",
    ]);
    const mid = plan("audio", WIDTHS.MEDIUM, AUDIO);
    expect(controlIsDirect(mid, "mute")).toBe(true);
    expect(controlIsDirect(mid, "solo")).toBe(true);
    expect(controlIsDirect(mid, "write")).toBe(true);
    expect(controlIsDirect(mid, "volume")).toBe(true);
    expect(controlIsOverflowed(mid, "groupAssign") || controlIsOverflowed(mid, "groupCreate")).toBe(true);

    const narrow = plan("audio", WIDTHS.NARROW, AUDIO);
    expect(controlIsDirect(narrow, "mute")).toBe(true);
    expect(controlIsDirect(narrow, "solo")).toBe(true);
    expect(controlIsOverflowed(narrow, "volume") || controlIsDirect(narrow, "write")).toBe(true);
  });

  it("does not invent controls that are not present", () => {
    const bare = plan("audio", WIDTHS.MIN, ["identity", "mute", "solo"]);
    expect(bare.visible.concat(bare.overflow).sort()).toEqual(["identity", "mute", "solo"].sort());
    expect(bare.overflow).toEqual([]);
  });

  it("RH-12 hysteresis ignores sub-band width jitter", () => {
    expect(stabilizeHeaderWidth(96, 96 + HEADER_HYSTERESIS_PX - 1)).toBe(96);
    expect(stabilizeHeaderWidth(96, 96 + HEADER_HYSTERESIS_PX)).toBe(96 + HEADER_HYSTERESIS_PX);
    expect(stabilizeHeaderWidth(0, 96)).toBe(96);
    expect(stabilizeHeaderWidth(96, 0)).toBe(96);
  });

  it("measured width wins; zero/NaN falls back to laneLabelPx", () => {
    expect(resolveHeaderWidth(140, 96)).toBe(140);
    expect(resolveHeaderWidth(0, 72)).toBe(72);
    expect(resolveHeaderWidth(Number.NaN, 96)).toBe(96);
  });

  it("min-width metadata stays usable (no crush)", () => {
    expect(HEADER_CONTROL_MIN_PX.mute).toBeGreaterThanOrEqual(14);
    expect(HEADER_CONTROL_MIN_PX.solo).toBeGreaterThanOrEqual(14);
    expect(HEADER_CONTROL_MIN_PX.volume).toBeGreaterThanOrEqual(18);
    expect(HEADER_CONTROL_MIN_PX.identity).toBeGreaterThanOrEqual(18);
  });

  it("does not change lane height packing or version", () => {
    expect(AILEXSI_PRODUCT_VERSION).toBe("5.6.0");
    expect(laneHeaderPacksInline(DEFAULT_LANE_HEIGHT_PX)).toBe(false);
    expect(LANE_LABEL_MIN_PX).toBe(72);
    expect(LANE_LABEL_MAX_PX).toBe(160);
  });

});

describe("width matrix VIS / VIDEO / AUDIO × WIDE / MEDIUM / NARROW / MIN", () => {
  const rows: Array<{
    kind: HeaderTrackKind;
    present: HeaderControlId[];
    pack: HeaderPack;
    width: keyof typeof WIDTHS;
    direct: HeaderControlId[];
    overflow: HeaderControlId[];
  }> = [
    { kind: "vis", present: VIS, pack: "stack", width: "WIDE", direct: VIS, overflow: [] },
    { kind: "vis", present: VIS, pack: "stack", width: "MEDIUM", direct: VIS, overflow: [] },
    { kind: "vis", present: VIS, pack: "stack", width: "NARROW", direct: VIS, overflow: [] },
    { kind: "vis", present: VIS, pack: "stack", width: "MIN", direct: VIS, overflow: [] },
    { kind: "vis", present: VIS, pack: "inline", width: "WIDE", direct: VIS, overflow: [] },
    { kind: "vis", present: VIS, pack: "inline", width: "MEDIUM", direct: VIS, overflow: [] },
    { kind: "vis", present: VIS, pack: "inline", width: "NARROW", direct: VIS, overflow: [] },
    { kind: "vis", present: VIS, pack: "inline", width: "MIN", direct: ["identity", "mute"], overflow: ["scene"] },
    { kind: "video", present: VIDEO, pack: "stack", width: "WIDE", direct: VIDEO, overflow: [] },
    { kind: "video", present: VIDEO, pack: "stack", width: "MEDIUM", direct: VIDEO, overflow: [] },
    { kind: "video", present: VIDEO, pack: "stack", width: "NARROW", direct: VIDEO, overflow: [] },
    { kind: "video", present: VIDEO, pack: "stack", width: "MIN", direct: VIDEO, overflow: [] },
    { kind: "audio", present: AUDIO, pack: "stack", width: "WIDE", direct: AUDIO, overflow: [] },
    {
      kind: "audio",
      present: AUDIO,
      pack: "stack",
      width: "MEDIUM",
      direct: ["identity", "mute", "solo", "write", "volume"],
      overflow: ["groupAssign", "groupCreate", "addAudio", "removeAudio"],
    },
    {
      kind: "audio",
      present: AUDIO,
      pack: "stack",
      width: "NARROW",
      direct: ["identity", "mute", "solo", "write"],
      overflow: ["volume", "groupAssign", "groupCreate", "addAudio", "removeAudio"],
    },
    {
      kind: "audio",
      present: AUDIO,
      pack: "stack",
      width: "MIN",
      direct: ["identity", "mute", "solo", "write"],
      overflow: ["volume", "groupAssign", "groupCreate", "addAudio", "removeAudio"],
    },
  ];

  for (const row of rows) {
    it(`${row.kind} ${row.pack} ${row.width}`, () => {
      const p = plan(row.kind, WIDTHS[row.width], row.present, row.pack);
      expect(p.visible).toEqual(row.direct);
      expect(p.overflow).toEqual(row.overflow);
      expect(headerControlsExclusive(row.present, p)).toBe(true);
      expect(p.overflow.length > 0).toBe(row.overflow.length > 0);
    });
  }
});
