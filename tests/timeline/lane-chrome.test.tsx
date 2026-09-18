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
import "../../src/styles.css";

const noop = () => {};
const noopMs = (_ms: number) => {};

function pointer(type: string, init: MouseEventInit = {}): Event {
  const Ctor = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, ...init });
}

describe("lane header chrome", () => {
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
      onLaneLabelPx?: (px: number) => void;
      onLaneHeight?: (group: "vis" | "video" | "audio", px: number) => void;
      mutedV1?: boolean;
      selectedTrackIds?: TrackId[];
      onSelectTrack?: (id: TrackId, opts?: { toggle?: boolean }) => void;
      laneHeights?: LaneHeights;
      onToggleMute?: (id: TrackId) => void;
      onToggleSolo?: (id: TrackId) => void;
      onToggleVisualizerMute?: () => void;
      onCycleVisualizerScene?: () => void;
      onSelectVis?: () => void;
    } = {},
  ) {
    const project = projectWith(
      [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 })],
      [asset({ id: "va", kind: "video", durationMs: 4000 })],
    );
    if (extras.mutedV1) {
      project.tracks = project.tracks.map((t) => (t.id === "V1" ? { ...t, muted: true } : t));
    }
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
          selectedTrackIds={extras.selectedTrackIds}
          onSelectTrack={extras.onSelectTrack}
          onToggleVisualizerMute={extras.onToggleVisualizerMute ?? noop}
          onCycleVisualizerScene={extras.onCycleVisualizerScene ?? noop}
          onSelectVis={extras.onSelectVis}
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
          laneLabelPx={extras.laneLabelPx ?? 96}
          laneHeights={extras.laneHeights}
          onLaneLabelPx={extras.onLaneLabelPx}
          onLaneHeight={extras.onLaneHeight}
        />,
      );
    });
  }

  it("exposes a shared label splitter and lane height handles", () => {
    mount();
    expect(host!.querySelector("[data-testid=lane-label-splitter]")).toBeTruthy();
    expect(host!.querySelector("[data-testid=lane-height-VIS]")).toBeTruthy();
    expect(host!.querySelector("[data-testid=lane-height-V1]")).toBeTruthy();
    expect(host!.querySelector(".lane-label")).toBeTruthy();
    for (const id of ["VIS", "V1", "V2", "A1", "A2"] as const) {
      expect(host!.querySelector(`[data-testid=lane-${id}]`)!.getAttribute("data-header-pack")).toBe("stack");
    }
  });

  it("dragging the label splitter writes a clamped width", () => {
    const widths: number[] = [];
    mount({
      laneLabelPx: 96,
      onLaneLabelPx: (px) => widths.push(px),
    });
    const handle = host!.querySelector("[data-testid=lane-label-splitter]")!;
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 96 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 140 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 140 }));
    });
    expect(widths.at(-1)).toBe(140);
  });

  it("does not dim a muted V1 filmstrip", () => {
    mount({ mutedV1: true });
    const lane = host!.querySelector("[data-testid=lane-V1]")!;
    expect(lane.className).toContain("muted");
    expect(lane.className).toContain("video-lane");
    const body = host!.querySelector("[data-testid=lane-V1-body]") as HTMLElement;
    expect(body.className).not.toContain("audio-lane");
    expect(lane.className).not.toContain("audio-lane");
  });

  it("lane header click selects a track; Ctrl+click toggles", () => {
    const picks: Array<{ id: TrackId; toggle?: boolean }> = [];
    mount({
      selectedTrackIds: ["V1"],
      onSelectTrack: (id, opts) => picks.push({ id, toggle: opts?.toggle }),
    });
    expect(host!.querySelector("[data-testid=lane-V1]")!.className).toContain("track-selected");
    act(() => {
      (host!.querySelector("[data-testid=lane-label-A1]") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true }),
      );
    });
    expect(picks).toEqual([{ id: "A1", toggle: true }]);
  });

  it("keeps stacked V/A headers at default height and packs M/S inline when short", () => {
    const muted: TrackId[] = [];
    const soloed: TrackId[] = [];
    mount({
      laneHeights: {
        vis: DEFAULT_LANE_HEIGHT_PX,
        video: LANE_HEIGHT_MIN_PX,
        audio: DEFAULT_LANE_HEIGHT_PX,
      },
      onToggleMute: (id) => muted.push(id),
      onToggleSolo: (id) => soloed.push(id),
    });
    expect(host!.querySelector("[data-testid=lane-V1]")!.getAttribute("data-header-pack")).toBe("inline");
    expect(host!.querySelector("[data-testid=lane-V2]")!.getAttribute("data-header-pack")).toBe("inline");
    expect(host!.querySelector("[data-testid=lane-label-V1]")!.getAttribute("data-header-pack")).toBe("inline");
    expect(host!.querySelector("[data-testid=lane-V1]")!.className).toContain("lane-header-compact");
    expect(host!.querySelector("[data-testid=lane-A1]")!.getAttribute("data-header-pack")).toBe("stack");
    expect(host!.querySelector("[data-testid=lane-A2]")!.getAttribute("data-header-pack")).toBe("stack");
    expect(host!.querySelector("[data-testid=lane-A1]")!.className).not.toContain("lane-header-compact");
    expect(host!.querySelector("[data-testid=lane-VIS]")!.className).not.toContain("lane-header-compact");

    act(() => {
      (host!.querySelector("[data-testid=mute-V1]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=solo-V2]") as HTMLButtonElement).click();
    });
    expect(muted).toEqual(["V1"]);
    expect(soloed).toEqual(["V2"]);
  });

  it("packs A1/A2 M/S inline at the shortest audio height", () => {
    mount({
      laneHeights: {
        vis: DEFAULT_LANE_HEIGHT_PX,
        video: DEFAULT_LANE_HEIGHT_PX,
        audio: LANE_HEIGHT_MIN_PX,
      },
    });
    expect(host!.querySelector("[data-testid=lane-A1]")!.getAttribute("data-header-pack")).toBe("inline");
    expect(host!.querySelector("[data-testid=lane-A2]")!.getAttribute("data-header-pack")).toBe("inline");
    expect(host!.querySelector("[data-testid=lane-V1]")!.getAttribute("data-header-pack")).toBe("stack");
    expect(host!.querySelector("[data-testid=mute-A1]")).toBeTruthy();
    expect(host!.querySelector("[data-testid=solo-A2]")).toBeTruthy();
  });

  it("packs VIS M/scene beside the name at the shortest vis height", () => {
    let muteVis = 0;
    let cycleScene = 0;
    let selectVis = 0;
    mount({
      laneHeights: {
        vis: LANE_HEIGHT_MIN_PX,
        video: DEFAULT_LANE_HEIGHT_PX,
        audio: DEFAULT_LANE_HEIGHT_PX,
      },
      onToggleVisualizerMute: () => {
        muteVis += 1;
      },
      onCycleVisualizerScene: () => {
        cycleScene += 1;
      },
      onSelectVis: () => {
        selectVis += 1;
      },
    });
    expect(host!.querySelector("[data-testid=lane-VIS]")!.getAttribute("data-header-pack")).toBe("inline");
    expect(host!.querySelector("[data-testid=lane-label-VIS]")!.getAttribute("data-header-pack")).toBe("inline");
    expect(host!.querySelector("[data-testid=lane-VIS]")!.className).toContain("lane-header-compact");
    expect(host!.querySelector("[data-testid=lane-V1]")!.getAttribute("data-header-pack")).toBe("stack");
    expect(host!.querySelector("[data-testid=lane-A1]")!.getAttribute("data-header-pack")).toBe("stack");
    expect(host!.querySelector("[data-testid=mute-VIS]")!.closest("[data-header-slot=overflow]")).toBeNull();
    const scene = (host!.querySelector("[data-testid=visualizer-scene]") ??
      document.querySelector("[data-testid=visualizer-scene]")) as HTMLButtonElement;
    expect(scene.textContent).toMatch(/^(Wave|Scene · Wave)$/);

    act(() => {
      (host!.querySelector("[data-testid=mute-VIS]") as HTMLButtonElement).click();
      scene.click();
    });
    expect(muteVis).toBe(1);
    expect(cycleScene).toBe(1);
    expect(selectVis).toBe(0);

    act(() => {
      (host!.querySelector("[data-testid=lane-label-VIS]") as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(selectVis).toBe(1);
  });
});
