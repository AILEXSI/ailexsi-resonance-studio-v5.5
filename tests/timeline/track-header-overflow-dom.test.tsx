import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { asset, clip, projectWith } from "../helpers";
import type { TrackId } from "../../src/core/models";
import {
  DEFAULT_LANE_HEIGHT_PX,
  LANE_HEIGHT_MIN_PX,
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
  });

  function mount(
    extras: {
      laneLabelPx?: number;
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
    const project = projectWith(
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

  function slotOf(control: string, laneTestId: string) {
    const lane = host!.querySelector(`[data-testid="${laneTestId}"]`)!;
    const nodes = [...lane.querySelectorAll(`[data-header-control="${control}"]`)];
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
    expect(host!.querySelectorAll("[data-testid=create-track-group]")).toHaveLength(1);
    expect(host!.querySelectorAll("[data-testid=add-audio-track]")).toHaveLength(1);
    expect(host!.querySelectorAll("[data-testid=lane-group-assign-A1]")).toHaveLength(1);

    act(() => {
      (host!.querySelector("[data-testid=lane-overflow-A2]") as HTMLButtonElement).click();
    });
    expect(host!.querySelector("[data-testid=lane-overflow-menu-A2]")!.hasAttribute("hidden")).toBe(
      false,
    );
    act(() => {
      (host!.querySelector("[data-testid=add-audio-track]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=create-track-group]") as HTMLButtonElement).click();
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
    expect(host!.querySelector("[data-testid=write-arm-A1]")!.className).toMatch(/active/);
    act(() => {
      (host!.querySelector("[data-testid=mute-A1]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=lane-overflow-A1]") as HTMLButtonElement).click();
    });
    act(() => {
      (host!.querySelector("[data-testid=volume-lane-toggle-A1]") as HTMLButtonElement).click();
    });
    expect(muted).toEqual(["A1"]);
    expect(armed).toEqual([]);
    const vol = host!.querySelector("[data-testid=volume-lane-toggle-A1]") as HTMLButtonElement;
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
    expect(host!.querySelectorAll("[data-testid=lane-group-assign-A1]")).toHaveLength(1);
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
    expect(host!.querySelector("[data-testid=visualizer-scene]")!.textContent).toBe("Wave");
    act(() => {
      (host!.querySelector("[data-testid=mute-VIS]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=lane-overflow-VIS]") as HTMLButtonElement).click();
    });
    act(() => {
      (host!.querySelector("[data-testid=visualizer-scene]") as HTMLButtonElement).click();
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
    expect(host!.querySelector("[data-testid=write-arm-V1]")).toBeNull();
    expect(host!.querySelector("[data-testid=volume-lane-toggle-V1]")).toBeNull();
    expect(host!.querySelector("[data-testid=lane-group-assign-V1]")).toBeNull();
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
    expect(host!.querySelector("[data-testid=lane-overflow-menu-A2]")!.hasAttribute("hidden")).toBe(
      false,
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host!.querySelector("[data-testid=lane-overflow-menu-A2]")!.hasAttribute("hidden")).toBe(
      true,
    );
    expect(window.localStorage.getItem("resonance-studio-v5-5-header-overflow")).toBeNull();
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

  it("RH-18 product version stays 5.6.0", () => {
    expect(AILEXSI_PRODUCT_VERSION).toBe("5.6.0");
  });
});
