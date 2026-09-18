import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { createTrackGroup } from "../../src/core/track-groups";
import { asset, clip, projectWith } from "../helpers";
import type { Project, TrackId } from "../../src/core/models";
import {
  DEFAULT_LANE_HEIGHT_PX,
  LANE_HEIGHT_MIN_PX,
  LANE_LABEL_MIN_PX,
  type LaneHeights,
} from "../../src/core/layout-prefs";
import {
  HEADER_WIDTH_MEDIUM_PX,
  HEADER_WIDTH_MIN_PX,
  HEADER_WIDTH_NARROW_PX,
  HEADER_WIDTH_WIDE_PX,
} from "../../src/ui/timeline/track-header-overflow";
import { AILEXSI_PRODUCT_VERSION } from "../../src/core/build-info";
import "../../src/styles.css";

const noop = () => {};
const noopMs = (_ms: number) => {};

describe("track header overflow DOM", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    document.querySelectorAll("[data-header-slot=overflow]").forEach((node) => node.remove());
  });

  function mount(
    extras: {
      project?: Project;
      laneLabelPx?: number;
      onLaneLabelPx?: (px: number) => void;
      laneHeights?: LaneHeights;
      onToggleMute?: (id: TrackId) => void;
      onToggleSolo?: (id: TrackId) => void;
      onToggleVisualizerMute?: () => void;
      onCycleVisualizerScene?: () => void;
      onToggleVolumeLane?: (id: TrackId) => void;
      onToggleVolumeWriteArm?: (id: TrackId) => void;
      onAssignTracksToGroup?: (ids: TrackId[], groupId: string | null) => void;
      onCreateTrackGroup?: (ids?: TrackId[]) => void;
      onAddAudioTrack?: () => void;
      onRemoveAudioTrack?: () => void;
      canRemoveAudioTrack?: boolean;
      volumeWriteArmedIds?: TrackId[];
      openVolumeLaneIds?: TrackId[];
      visibleTrackIds?: TrackId[];
    } = {},
  ) {
    const project =
      extras.project ??
      projectWith(
        [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 })],
        [asset({ id: "va", kind: "video", durationMs: 4000 })],
      );
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Timeline
          project={project}
          selectedClipId="v1"
          onSelect={() => {}}
          onPlayhead={noopMs}
          onMoveLive={() => {}}
          onMoveCommit={noop}
          onTrimLive={() => {}}
          onTrimCommit={noop}
          onToggleMute={extras.onToggleMute ?? ((_id: TrackId) => {})}
          onToggleSolo={extras.onToggleSolo ?? ((_id: TrackId) => {})}
          onToggleVisualizerMute={extras.onToggleVisualizerMute ?? noop}
          onCycleVisualizerScene={extras.onCycleVisualizerScene ?? noop}
          onSplitHere={() => {}}
          onCut={noop}
          onCopy={noop}
          onPaste={noop}
          onDelete={noop}
          onZoom={() => {}}
          onFit={noopMs}
          onScroll={noopMs}
          onLoopClick={noopMs}
          onLoopInLive={noopMs}
          onLoopOutLive={noopMs}
          onLoopMoveLive={noopMs}
          onLoopCommit={noop}
          laneLabelPx={extras.laneLabelPx ?? HEADER_WIDTH_MEDIUM_PX}
          onLaneLabelPx={extras.onLaneLabelPx}
          laneHeights={extras.laneHeights}
          visibleTrackIds={extras.visibleTrackIds}
          onToggleVolumeLane={extras.onToggleVolumeLane}
          onToggleVolumeWriteArm={extras.onToggleVolumeWriteArm}
          volumeWriteArmedIds={extras.volumeWriteArmedIds}
          openVolumeLaneIds={extras.openVolumeLaneIds}
          onAssignTracksToGroup={extras.onAssignTracksToGroup}
          onCreateTrackGroup={extras.onCreateTrackGroup}
          onAddAudioTrack={extras.onAddAudioTrack}
          onRemoveAudioTrack={extras.onRemoveAudioTrack}
          canAddAudioTrack
          canRemoveAudioTrack={extras.canRemoveAudioTrack ?? true}
        />,
      );
    });
  }

  function q(sel: string): Element | null {
    return host?.querySelector(sel) ?? document.querySelector(sel);
  }

  function qAll(sel: string): Element[] {
    const local = host ? [...host.querySelectorAll(sel)] : [];
    if (local.length > 0) return local;
    return [...document.querySelectorAll(sel)];
  }

  function slotOf(control: string, laneTestId: string) {
    const lane = host!.querySelector(`[data-testid="${laneTestId}"]`)!;
    const trackId = laneTestId.replace(/^lane-/, "");
    const menu = document.querySelector(`[data-testid="lane-overflow-menu-${trackId}"]`);
    const inLane = [...lane.querySelectorAll(`[data-header-control="${control}"]`)].filter(
      (node) => !node.closest("[data-header-slot=overflow]"),
    );
    const inMenu = menu ? [...menu.querySelectorAll(`[data-header-control="${control}"]`)] : [];
    const nodes = [...inLane, ...inMenu];
    expect(nodes.length, `${control} on ${laneTestId}`).toBe(1);
    const node = nodes[0]!;
    if (node.closest("[data-header-slot=overflow]")) return "overflow";
    return "direct";
  }

  it("RH-13/14/15 default stacked audio keeps M/S direct; W/VOL overflow without raising lane height", () => {
    mount({
      laneLabelPx: HEADER_WIDTH_MEDIUM_PX,
      onToggleVolumeLane: () => undefined,
      onToggleVolumeWriteArm: () => undefined,
    });
    const a1 = host!.querySelector("[data-testid=lane-A1]") as HTMLElement;
    expect(a1.style.height).toBe(`${DEFAULT_LANE_HEIGHT_PX}px`);
    expect(a1.style.minHeight).toBe(`${DEFAULT_LANE_HEIGHT_PX}px`);
    expect(a1.style.maxHeight).toBe(`${DEFAULT_LANE_HEIGHT_PX}px`);
    expect(slotOf("identity", "lane-A1")).toBe("direct");
    expect(slotOf("mute", "lane-A1")).toBe("direct");
    expect(slotOf("solo", "lane-A1")).toBe("direct");
    expect(slotOf("write", "lane-A1")).toBe("overflow");
    expect(slotOf("volume", "lane-A1")).toBe("overflow");
    expect(host!.querySelector("[data-testid=lane-overflow-A1]")).toBeTruthy();
    expect(host!.querySelector("[data-testid=lane-overflow-V1]")).toBeNull();
    expect(host!.querySelector("[data-testid=lane-overflow-VIS]")).toBeNull();
    expect(host!.querySelector("[data-testid=lane-A1] .lane-ms")).toBeTruthy();
  });

  it("RH-05/06/07 audio chrome + group move into one overflow; never both", () => {
    const created: TrackId[][] = [];
    const assigned: Array<{ ids: TrackId[]; groupId: string | null }> = [];
    const added: string[] = [];
    mount({
      laneLabelPx: HEADER_WIDTH_MEDIUM_PX,
      onToggleVolumeLane: () => undefined,
      onToggleVolumeWriteArm: () => undefined,
      onAssignTracksToGroup: (ids, groupId) => assigned.push({ ids, groupId }),
      onCreateTrackGroup: (ids) => created.push(ids ?? []),
      onAddAudioTrack: () => added.push("add"),
      onRemoveAudioTrack: () => added.push("remove"),
    });
    expect(host!.querySelector("[data-testid=lane-A2]")!.getAttribute("data-header-overflow")).toBe(
      "true",
    );
    expect(host!.querySelector("[data-testid=lane-overflow-A2]")).toBeTruthy();
    expect(host!.querySelector("[data-testid=lane-overflow-A1]")).toBeTruthy();
    expect(slotOf("mute", "lane-A2")).toBe("direct");
    expect(slotOf("write", "lane-A2")).toBe("overflow");
    expect(slotOf("volume", "lane-A2")).toBe("overflow");
    expect(slotOf("groupAssign", "lane-A1")).toBe("overflow");
    expect(slotOf("groupCreate", "lane-A2")).toBe("overflow");
    expect(slotOf("addAudio", "lane-A2")).toBe("overflow");
    expect(qAll("[data-testid=create-track-group]")).toHaveLength(1);
    expect(qAll("[data-testid=add-audio-track]")).toHaveLength(1);
    expect(qAll("[data-testid=lane-group-assign-A1]")).toHaveLength(1);

    act(() => {
      (host!.querySelector("[data-testid=lane-overflow-A2]") as HTMLButtonElement).click();
    });
    expect(q("[data-testid=lane-overflow-menu-A2]")!.hasAttribute("hidden")).toBe(false);
    act(() => {
      (q("[data-testid=add-audio-track]") as HTMLButtonElement).click();
      (q("[data-testid=create-track-group]") as HTMLButtonElement).click();
    });
    expect(added).toEqual(["add"]);
    expect(created).toEqual([[]]);
  });

  it("RH-09 overflow mute/write use the same handlers and state as direct buttons", () => {
    const muted: TrackId[] = [];
    const armed: TrackId[] = [];
    mount({
      laneLabelPx: HEADER_WIDTH_NARROW_PX,
      onToggleMute: (id) => muted.push(id),
      onToggleVolumeWriteArm: (id) => armed.push(id),
      onToggleVolumeLane: () => undefined,
      onAssignTracksToGroup: () => undefined,
      volumeWriteArmedIds: ["A1"],
    });
    expect(slotOf("volume", "lane-A1")).toBe("overflow");
    expect(slotOf("write", "lane-A1")).toBe("overflow");
    expect(q("[data-testid=write-arm-A1]")!.className).toMatch(/active/);
    expect(q("[data-testid=write-arm-A1]")!.textContent).toBe("Disarm write automation");
    expect(q("[data-testid=volume-lane-toggle-A1]")!.textContent).toBe("Volume automation");
    act(() => {
      (host!.querySelector("[data-testid=mute-A1]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=lane-overflow-A1]") as HTMLButtonElement).click();
    });
    act(() => {
      (q("[data-testid=volume-lane-toggle-A1]") as HTMLButtonElement).click();
    });
    expect(muted).toEqual(["A1"]);
    expect(armed).toEqual([]);
    const vol = q("[data-testid=volume-lane-toggle-A1]") as HTMLButtonElement;
    expect(vol.getAttribute("aria-label")).toBe("Show volume automation");
  });

  it("RH-10 widening returns controls and removes the overflow button", () => {
    mount({
      laneLabelPx: HEADER_WIDTH_MIN_PX,
      onToggleVolumeLane: () => undefined,
      onToggleVolumeWriteArm: () => undefined,
      onAssignTracksToGroup: () => undefined,
      onCreateTrackGroup: () => undefined,
      onAddAudioTrack: () => undefined,
      onRemoveAudioTrack: () => undefined,
    });
    expect(host!.querySelector("[data-testid=lane-overflow-A2]")).toBeTruthy();
    expect(slotOf("volume", "lane-A2")).toBe("overflow");

    act(() => {
      root!.render(
        <Timeline
          project={projectWith(
            [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 })],
            [asset({ id: "va", kind: "video", durationMs: 4000 })],
          )}
          selectedClipId="v1"
          onSelect={() => {}}
          onPlayhead={noopMs}
          onMoveLive={() => {}}
          onMoveCommit={noop}
          onTrimLive={() => {}}
          onTrimCommit={noop}
          onToggleMute={noop}
          onToggleSolo={noop}
          onToggleVisualizerMute={noop}
          onCycleVisualizerScene={noop}
          onSplitHere={() => {}}
          onCut={noop}
          onCopy={noop}
          onPaste={noop}
          onDelete={noop}
          onZoom={() => {}}
          onFit={noopMs}
          onScroll={noopMs}
          onLoopClick={noopMs}
          onLoopInLive={noopMs}
          onLoopOutLive={noopMs}
          onLoopMoveLive={noopMs}
          onLoopCommit={noop}
          laneLabelPx={HEADER_WIDTH_WIDE_PX}
          onToggleVolumeLane={() => undefined}
          onToggleVolumeWriteArm={() => undefined}
          onAssignTracksToGroup={() => undefined}
          onCreateTrackGroup={() => undefined}
          onAddAudioTrack={() => undefined}
          onRemoveAudioTrack={() => undefined}
          canAddAudioTrack
          canRemoveAudioTrack
        />,
      );
    });
    expect(host!.querySelector("[data-testid=lane-overflow-A2]")).toBeTruthy();
    expect(slotOf("write", "lane-A2")).toBe("direct");
    expect(slotOf("volume", "lane-A2")).toBe("direct");
    expect(slotOf("groupAssign", "lane-A2")).toBe("overflow");
    expect(slotOf("addAudio", "lane-A2")).toBe("overflow");
  });

  it("RH-16/24 compact height packs inline and still overflows group instead of dropping it", () => {
    mount({
      laneLabelPx: HEADER_WIDTH_MEDIUM_PX,
      laneHeights: {
        vis: DEFAULT_LANE_HEIGHT_PX,
        video: DEFAULT_LANE_HEIGHT_PX,
        audio: LANE_HEIGHT_MIN_PX,
      },
      onAssignTracksToGroup: () => undefined,
      onToggleVolumeLane: () => undefined,
      onToggleVolumeWriteArm: () => undefined,
    });
    expect(host!.querySelector("[data-testid=lane-A1]")!.className).toContain("lane-header-compact");
    expect(host!.querySelector("[data-testid=lane-A1]")!.getAttribute("data-header-pack")).toBe(
      "inline",
    );
    expect((host!.querySelector("[data-testid=lane-A1]") as HTMLElement).style.height).toBe(
      `${LANE_HEIGHT_MIN_PX}px`,
    );
    expect(slotOf("groupAssign", "lane-A1")).toBe("overflow");
    expect(qAll("[data-testid=lane-group-assign-A1]")).toHaveLength(1);
  });

  it("RH-19 VIS scene can overflow at min inline width; mute stays direct", () => {
    let muteVis = 0;
    let cycle = 0;
    mount({
      laneLabelPx: HEADER_WIDTH_MIN_PX,
      laneHeights: {
        vis: LANE_HEIGHT_MIN_PX,
        video: DEFAULT_LANE_HEIGHT_PX,
        audio: DEFAULT_LANE_HEIGHT_PX,
      },
      onToggleVisualizerMute: () => {
        muteVis += 1;
      },
      onCycleVisualizerScene: () => {
        cycle += 1;
      },
    });
    expect(host!.querySelector("[data-testid=lane-VIS]")!.getAttribute("data-header-overflow")).toBe(
      "true",
    );
    expect(slotOf("mute", "lane-VIS")).toBe("direct");
    expect(slotOf("scene", "lane-VIS")).toBe("overflow");
    expect(q("[data-testid=visualizer-scene]")!.textContent).toBe("Scene · Wave");
    act(() => {
      (host!.querySelector("[data-testid=mute-VIS]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=lane-overflow-VIS]") as HTMLButtonElement).click();
    });
    act(() => {
      (q("[data-testid=visualizer-scene]") as HTMLButtonElement).click();
    });
    expect(muteVis).toBe(1);
    expect(cycle).toBe(1);
  });

  it("RH-21 VIDEO never invents W/VOL/group and has no overflow button", () => {
    mount({
      laneLabelPx: HEADER_WIDTH_MIN_PX,
      onToggleVolumeLane: () => undefined,
      onToggleVolumeWriteArm: () => undefined,
      onAssignTracksToGroup: () => undefined,
    });
    expect(q("[data-testid=write-arm-V1]")).toBeNull();
    expect(q("[data-testid=volume-lane-toggle-V1]")).toBeNull();
    expect(q("[data-testid=lane-group-assign-V1]")).toBeNull();
    expect(host!.querySelector("[data-testid=lane-overflow-V1]")).toBeNull();
    expect(slotOf("mute", "lane-V1")).toBe("direct");
    expect(slotOf("solo", "lane-V1")).toBe("direct");
  });

  it("RH-17 overflow is not persisted; Escape closes the menu", () => {
    mount({
      laneLabelPx: HEADER_WIDTH_MEDIUM_PX,
      onAssignTracksToGroup: () => undefined,
      onCreateTrackGroup: () => undefined,
      onAddAudioTrack: () => undefined,
    });
    act(() => {
      (host!.querySelector("[data-testid=lane-overflow-A2]") as HTMLButtonElement).click();
    });
    expect(q("[data-testid=lane-overflow-menu-A2]")!.hasAttribute("hidden")).toBe(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(q("[data-testid=lane-overflow-menu-A2]")!.hasAttribute("hidden")).toBe(true);
    expect(window.localStorage.getItem("resonance-studio-v6-0-header-overflow")).toBeNull();
  });

  it("RH-23 CUTTER hides audio headers; VIS/VIDEO overflow policy still applies", () => {
    mount({
      laneLabelPx: HEADER_WIDTH_MIN_PX,
      visibleTrackIds: ["V1", "V2"],
      laneHeights: {
        vis: LANE_HEIGHT_MIN_PX,
        video: DEFAULT_LANE_HEIGHT_PX,
        audio: DEFAULT_LANE_HEIGHT_PX,
      },
    });
    expect(host!.querySelector("[data-testid=lane-A1]")).toBeNull();
    expect(host!.querySelector("[data-testid=lane-V1]")).toBeTruthy();
    expect(host!.querySelector("[data-testid=lane-VIS]")).toBeTruthy();
    expect(host!.querySelector("[data-testid=lane-overflow-V1]")).toBeNull();
  });

  it("RH-18 product version stays 6.0.0", () => {
    expect(AILEXSI_PRODUCT_VERSION).toBe("6.0.0");
  });

  it("overflow menu items reuse live Solo/Write/VOL/Group state", () => {
    const base = projectWith(
      [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 })],
      [asset({ id: "va", kind: "video", durationMs: 4000 })],
    );
    const grouped = createTrackGroup(base, { name: "Chapter IV", trackIds: ["A1"] });
    const project = {
      ...grouped.project,
      tracks: grouped.project.tracks.map((track) =>
        track.id === "A1" ? { ...track, solo: true } : track,
      ),
    };
    mount({
      project,
      laneLabelPx: HEADER_WIDTH_MEDIUM_PX,
      laneHeights: {
        vis: DEFAULT_LANE_HEIGHT_PX,
        video: DEFAULT_LANE_HEIGHT_PX,
        audio: LANE_HEIGHT_MIN_PX,
      },
      onToggleVolumeLane: () => undefined,
      onToggleVolumeWriteArm: () => undefined,
      onAssignTracksToGroup: () => undefined,
      volumeWriteArmedIds: ["A1"],
      openVolumeLaneIds: ["A1"],
    });
    expect(slotOf("solo", "lane-A1")).toBe("overflow");
    expect(slotOf("write", "lane-A1")).toBe("overflow");
    expect(slotOf("volume", "lane-A1")).toBe("overflow");
    expect(slotOf("groupAssign", "lane-A1")).toBe("overflow");
    const solo = q("[data-testid=solo-A1]") as HTMLButtonElement;
    const write = q("[data-testid=write-arm-A1]") as HTMLButtonElement;
    const volume = q("[data-testid=volume-lane-toggle-A1]") as HTMLButtonElement;
    const assign = q("[data-testid=lane-group-assign-A1]") as HTMLSelectElement;
    expect(solo.textContent).toBe("Unsolo");
    expect(solo.className).toMatch(/active/);
    expect(solo.getAttribute("aria-pressed")).toBe("true");
    expect(write.textContent).toBe("Disarm write automation");
    expect(write.className).toMatch(/active/);
    expect(write.getAttribute("aria-pressed")).toBe("true");
    expect(volume.textContent).toBe("Hide volume automation");
    expect(volume.className).toMatch(/active/);
    expect(volume.getAttribute("aria-pressed")).toBe("true");
    expect(q(".lane-overflow-field")!.textContent).toContain("Chapter group · Chapter IV");
    expect(assign.value).toBe(grouped.group!.id);
  });

  it("POP-02 overflow menu flips above a near-bottom trigger and stays in the viewport", () => {
    mount({
      laneLabelPx: HEADER_WIDTH_MEDIUM_PX,
      onToggleVolumeLane: () => undefined,
      onToggleVolumeWriteArm: () => undefined,
      onAssignTracksToGroup: () => undefined,
      onCreateTrackGroup: () => undefined,
      onAddAudioTrack: () => undefined,
    });
    const btn = host!.querySelector("[data-testid=lane-overflow-A2]") as HTMLButtonElement;
    btn.getBoundingClientRect = () =>
      ({
        x: 12,
        y: 640,
        left: 12,
        right: 28,
        top: 640,
        bottom: 656,
        width: 16,
        height: 16,
        toJSON: () => ({}),
      }) as DOMRect;
    const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const innerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    try {
      act(() => {
        btn.click();
      });
      const menu = q("[data-testid=lane-overflow-menu-A2]") as HTMLElement;
      expect(menu.hasAttribute("hidden")).toBe(false);
      expect(menu.getAttribute("data-overflow-placement")).toBe("above");
      const top = Number.parseFloat(menu.style.top);
      expect(top).toBeLessThan(640);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(q("[data-testid=write-arm-A2]")).toBeTruthy();
      expect(q("[data-testid=volume-lane-toggle-A2]")).toBeTruthy();
      expect(q("[data-testid=add-audio-track]")).toBeTruthy();
    } finally {
      if (innerHeight) Object.defineProperty(window, "innerHeight", innerHeight);
      else delete (window as { innerHeight?: number }).innerHeight;
      if (innerWidth) Object.defineProperty(window, "innerWidth", innerWidth);
      else delete (window as { innerWidth?: number }).innerWidth;
    }
  });

  it("divider cannot compress below identity + Mute + overflow", () => {
    const widths: number[] = [];
    mount({
      laneLabelPx: HEADER_WIDTH_MEDIUM_PX,
      onLaneLabelPx: (px) => widths.push(px),
    });
    const handle = host!.querySelector("[data-testid=lane-label-splitter]")!;
    const Ctor = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;
    act(() => {
      handle.dispatchEvent(new Ctor("pointerdown", { bubbles: true, button: 0, clientX: 96 }));
    });
    act(() => {
      window.dispatchEvent(new Ctor("pointermove", { bubbles: true, clientX: 20 }));
    });
    act(() => {
      window.dispatchEvent(new Ctor("pointerup", { bubbles: true, clientX: 20 }));
    });
    expect(widths.at(-1)).toBe(LANE_LABEL_MIN_PX);
    expect(LANE_LABEL_MIN_PX).toBe(HEADER_WIDTH_MIN_PX);
  });
});
