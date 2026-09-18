import { describe, expect, it } from "vitest";
import {
  HEADER_CONTROL_MIN_PX,
  HEADER_HYSTERESIS_PX,
  HEADER_OVERFLOW_BTN_PX,
  HEADER_PRIORITY,
  HEADER_WIDTH_MEDIUM_PX,
  HEADER_WIDTH_MIN_PX,
  HEADER_WIDTH_NARROW_PX,
  HEADER_WIDTH_WIDE_PX,
  controlIsDirect,
  controlIsOverflowed,
  headerControlsExclusive,
  headerOverflowLabel,
  headerUsableMinPx,
  OVERFLOW_MENU_MARGIN_PX,
  placeOverflowMenu,
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
  clampLaneLabelPx,
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
    expect(wide.overflow.length).toBeLessThan(mid.overflow.length);
    expect(mid.overflow.length).toBeGreaterThan(0);
    expect(min.overflow.length).toBeGreaterThanOrEqual(mid.overflow.length);
    expect(controlIsOverflowed(mid, "write")).toBe(true);
    expect(controlIsOverflowed(mid, "volume")).toBe(true);
    expect(controlIsOverflowed(mid, "groupCreate")).toBe(true);
    expect(controlIsDirect(mid, "mute")).toBe(true);
    expect(controlIsDirect(mid, "solo")).toBe(true);
    expect(controlIsDirect(wide, "write")).toBe(true);
    expect(controlIsDirect(wide, "volume")).toBe(true);
    expect(controlIsOverflowed(wide, "groupAssign")).toBe(true);
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

  it("VIDEO has no invented secondaries; Mute stays direct at every legal width", () => {
    expect(HEADER_PRIORITY.video).toEqual(["identity", "mute", "solo"]);
    for (const width of Object.values(WIDTHS)) {
      for (const pack of ["stack", "inline"] as const) {
        const p = plan("video", width, VIDEO, pack);
        expect(p.visible).toContain("identity");
        expect(p.visible).toContain("mute");
        expect(p.overflow).not.toContain("mute");
        expect(headerControlsExclusive(VIDEO, p)).toBe(true);
        if (pack === "stack" || width !== WIDTHS.MIN) {
          expect(p.visible).toEqual(["identity", "mute", "solo"]);
          expect(p.overflow).toEqual([]);
        }
      }
    }
    const inlineMin = plan("video", WIDTHS.MIN, VIDEO, "inline");
    expect(controlIsDirect(inlineMin, "mute")).toBe(true);
    expect(controlIsOverflowed(inlineMin, "solo")).toBe(true);
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
    expect(controlIsOverflowed(mid, "write")).toBe(true);
    expect(controlIsOverflowed(mid, "volume")).toBe(true);
    expect(controlIsOverflowed(mid, "groupAssign")).toBe(true);

    const narrow = plan("audio", WIDTHS.NARROW, AUDIO);
    expect(controlIsDirect(narrow, "mute")).toBe(true);
    expect(controlIsDirect(narrow, "solo")).toBe(true);
    expect(controlIsOverflowed(narrow, "write")).toBe(true);
    expect(controlIsOverflowed(narrow, "volume")).toBe(true);
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
    expect(resolveHeaderWidth(0, HEADER_WIDTH_MIN_PX)).toBe(HEADER_WIDTH_MIN_PX);
    expect(resolveHeaderWidth(Number.NaN, 96)).toBe(96);
  });

  it("min-width metadata stays usable (no crush)", () => {
    expect(HEADER_CONTROL_MIN_PX.mute).toBeGreaterThanOrEqual(18);
    expect(HEADER_CONTROL_MIN_PX.solo).toBeGreaterThanOrEqual(18);
    expect(HEADER_CONTROL_MIN_PX.volume).toBeGreaterThanOrEqual(24);
    expect(HEADER_CONTROL_MIN_PX.write).toBeGreaterThanOrEqual(22);
    expect(HEADER_CONTROL_MIN_PX.identity).toBeGreaterThanOrEqual(24);
    expect(HEADER_CONTROL_MIN_PX.scene).toBeGreaterThanOrEqual(40);
  });

  it("does not change lane height packing or version", () => {
    expect(AILEXSI_PRODUCT_VERSION).toBe("5.6.0");
    expect(laneHeaderPacksInline(DEFAULT_LANE_HEIGHT_PX)).toBe(false);
    expect(LANE_LABEL_MIN_PX).toBe(headerUsableMinPx());
    expect(HEADER_WIDTH_MIN_PX).toBe(LANE_LABEL_MIN_PX);
    expect(LANE_LABEL_MAX_PX).toBe(160);
    expect(HEADER_OVERFLOW_BTN_PX).toBeGreaterThanOrEqual(14);
  });

  it("semantic min is identity + Mute + overflow only; divider cannot go below", () => {
    expect(headerUsableMinPx()).toBe(LANE_LABEL_MIN_PX);
    expect(headerUsableMinPx()).toBeGreaterThan(72);
    expect(clampLaneLabelPx(72)).toBe(LANE_LABEL_MIN_PX);
    expect(clampLaneLabelPx(LANE_LABEL_MIN_PX - 1)).toBe(LANE_LABEL_MIN_PX);
    expect(clampLaneLabelPx(LANE_LABEL_MIN_PX)).toBe(LANE_LABEL_MIN_PX);
    const minInline = plan("audio", HEADER_WIDTH_MIN_PX, AUDIO, "inline");
    expect(minInline.visible).toEqual(["identity", "mute"]);
    expect(minInline.overflow).toContain("solo");
    expect(minInline.overflow).toContain("write");
    expect(headerControlsExclusive(AUDIO, minInline)).toBe(true);
  });

  it("overflow menu labels are readable and reflect state", () => {
    expect(headerOverflowLabel("solo")).toBe("Solo");
    expect(headerOverflowLabel("solo", { soloed: true })).toBe("Unsolo");
    expect(headerOverflowLabel("write")).toBe("Write automation");
    expect(headerOverflowLabel("write", { writeArmed: true })).toBe("Disarm write automation");
    expect(headerOverflowLabel("volume")).toBe("Volume automation");
    expect(headerOverflowLabel("volume", { volumeLaneOpen: true })).toBe("Hide volume automation");
    expect(headerOverflowLabel("mute")).toBe("Mute");
    expect(headerOverflowLabel("mute", { muted: true })).toBe("Unmute");
    expect(headerOverflowLabel("groupAssign")).toBe("Chapter group");
    expect(headerOverflowLabel("groupAssign", { groupName: "Chapter IV" })).toBe(
      "Chapter group · Chapter IV",
    );
    expect(headerOverflowLabel("groupCreate")).toBe("Group selected audio tracks");
    expect(headerOverflowLabel("scene", { sceneName: "Lattice" })).toBe("Scene · Lattice");
  });

  it("POP-01 opens below the trigger when the menu fits", () => {
    const box = placeOverflowMenu({
      trigger: { left: 12, right: 28, top: 80, bottom: 96 },
      menu: { width: 176, height: 160 },
      viewport: { width: 1280, height: 720 },
    });
    expect(box.placement).toBe("below");
    expect(box.constrained).toBe(false);
    expect(box.top).toBe(96 + 2);
    expect(box.left).toBe(12);
    expect(box.top + 160).toBeLessThanOrEqual(720 - OVERFLOW_MENU_MARGIN_PX);
  });

  it("POP-02 flips above when there is not enough room below", () => {
    const trigger = { left: 12, right: 28, top: 640, bottom: 656 };
    const box = placeOverflowMenu({
      trigger,
      menu: { width: 176, height: 180 },
      viewport: { width: 1280, height: 720 },
    });
    expect(box.placement).toBe("above");
    expect(box.constrained).toBe(false);
    expect(box.top).toBe(640 - 2 - 180);
    expect(box.top).toBeGreaterThanOrEqual(OVERFLOW_MENU_MARGIN_PX);
    expect(box.top + 180).toBeLessThanOrEqual(trigger.top);
  });

  it("POP-03/04 constrains maxHeight and picks the taller side when neither side fits", () => {
    const box = placeOverflowMenu({
      trigger: { left: 12, right: 28, top: 200, bottom: 216 },
      menu: { width: 176, height: 500 },
      viewport: { width: 400, height: 360 },
    });
    expect(box.constrained).toBe(true);
    expect(box.maxHeight).toBeLessThan(500);
    expect(box.maxHeight).toBeGreaterThan(0);
    expect(box.top).toBeGreaterThanOrEqual(OVERFLOW_MENU_MARGIN_PX);
    expect(box.top + box.maxHeight).toBeLessThanOrEqual(360 - OVERFLOW_MENU_MARGIN_PX);
  });

  it("POP-05/06 shifts horizontally to stay in the viewport without leaving the trigger", () => {
    const trigger = { left: 1180, right: 1196, top: 80, bottom: 96 };
    const box = placeOverflowMenu({
      trigger,
      menu: { width: 176, height: 120 },
      viewport: { width: 1280, height: 720 },
    });
    expect(box.left + 176).toBeLessThanOrEqual(1280 - OVERFLOW_MENU_MARGIN_PX);
    expect(box.left).toBeGreaterThanOrEqual(OVERFLOW_MENU_MARGIN_PX);
    expect(box.left).toBeLessThanOrEqual(trigger.left);
    expect(trigger.right - box.left).toBeGreaterThan(0);
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
    { kind: "vis", present: VIS, pack: "inline", width: "MEDIUM", direct: ["identity", "mute"], overflow: ["scene"] },
    { kind: "vis", present: VIS, pack: "inline", width: "NARROW", direct: ["identity", "mute"], overflow: ["scene"] },
    { kind: "vis", present: VIS, pack: "inline", width: "MIN", direct: ["identity", "mute"], overflow: ["scene"] },
    { kind: "video", present: VIDEO, pack: "stack", width: "WIDE", direct: VIDEO, overflow: [] },
    { kind: "video", present: VIDEO, pack: "stack", width: "MEDIUM", direct: VIDEO, overflow: [] },
    { kind: "video", present: VIDEO, pack: "stack", width: "NARROW", direct: VIDEO, overflow: [] },
    { kind: "video", present: VIDEO, pack: "stack", width: "MIN", direct: VIDEO, overflow: [] },
    {
      kind: "audio",
      present: AUDIO,
      pack: "stack",
      width: "WIDE",
      direct: ["identity", "mute", "solo", "write", "volume"],
      overflow: ["groupAssign", "groupCreate", "addAudio", "removeAudio"],
    },
    {
      kind: "audio",
      present: AUDIO,
      pack: "stack",
      width: "MEDIUM",
      direct: ["identity", "mute", "solo"],
      overflow: ["write", "volume", "groupAssign", "groupCreate", "addAudio", "removeAudio"],
    },
    {
      kind: "audio",
      present: AUDIO,
      pack: "stack",
      width: "NARROW",
      direct: ["identity", "mute", "solo"],
      overflow: ["write", "volume", "groupAssign", "groupCreate", "addAudio", "removeAudio"],
    },
    {
      kind: "audio",
      present: AUDIO,
      pack: "stack",
      width: "MIN",
      direct: ["identity", "mute", "solo"],
      overflow: ["write", "volume", "groupAssign", "groupCreate", "addAudio", "removeAudio"],
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
