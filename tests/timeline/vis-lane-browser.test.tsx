import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { asset, clip, projectWith } from "../helpers";
import { LEXI_SCENE_IDS } from "../../src/core/visualz/scene-catalog";
import type { Project, TrackId, VisualizerSceneId } from "../../src/core/models";
import "../../src/styles.css";

const noop = () => {};
const noopMs = (_ms: number) => {};

function baseProject(sceneId: VisualizerSceneId = "resonance-wave"): Project {
  const project = projectWith(
    [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 })],
    [asset({ id: "va", kind: "video", durationMs: 4000 })],
  );
  project.visualizer = { ...project.visualizer, enabled: true, muted: false, sceneId };
  return project;
}

function timelineProps(overrides: Record<string, unknown> = {}) {
  return {
    project: baseProject(),
    selectedClipId: null as string | null,
    onSelect: () => {},
    onPlayhead: noopMs,
    onMoveLive: () => {},
    onMoveCommit: noop,
    onTrimLive: () => {},
    onTrimCommit: noop,
    onToggleMute: (_id: TrackId) => {},
    onToggleVisualizerMute: noop,
    onCycleVisualizerScene: noop,
    onSelectVis: noop,
    onSplitHere: () => {},
    onCut: noop,
    onCopy: noop,
    onPaste: noop,
    onDelete: noop,
    onZoom: () => {},
    onFit: noopMs,
    onScroll: noopMs,
    onLoopClick: noopMs,
    onLoopInLive: noopMs,
    onLoopOutLive: noopMs,
    onLoopMoveLive: noopMs,
    onLoopCommit: noop,
    ...overrides,
  };
}

function Harness({ initial = "resonance-wave" as VisualizerSceneId }) {
  const [sceneId, setSceneId] = useState<VisualizerSceneId>(initial);
  return (
    <Timeline
      {...timelineProps({
        project: baseProject(sceneId),
        onSetVisualizerScene: setSceneId,
      })}
    />
  );
}

describe("VIS lane header scene browser", () => {
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

  function mount(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(node);
    });
  }

  it("opens the overall VIS styles panel from the VIS header (name + Wave)", () => {
    mount(<Harness />);
    expect(document.querySelector("[data-testid=vis-lane-browser]")).toBeNull();
    expect((host!.querySelector("[data-testid=visualizer-scene]") as HTMLButtonElement).textContent).toBe(
      "Wave",
    );

    act(() => {
      (host!.querySelector("[data-testid=vis-lane-name]") as HTMLElement).click();
    });
    const panel = document.querySelector("[data-testid=vis-lane-browser-panel]");
    expect(document.querySelector("[data-testid=vis-lane-browser]")).toBeTruthy();
    expect(panel).toBeTruthy();
    expect(document.querySelector("[data-testid=vis-lane-browser-title]")?.textContent).toBe("VIS styles");
    expect(document.querySelector("[data-testid=vis-lane-browser-categories]")).toBeTruthy();
    expect(document.querySelector("[data-testid=vis-lane-browser-category-ALL]")).toBeTruthy();
    expect(document.querySelector("[data-testid=vis-lane-browser-category-CLASSIC]")).toBeTruthy();
    expect(document.querySelector("[data-testid=vis-lane-browser-category-LEXI]")).toBeTruthy();

    act(() => {
      (host!.querySelector("[data-testid=visualizer-scene]") as HTMLButtonElement).click();
    });
    expect(document.querySelector("[data-testid=vis-lane-browser]")).toBeNull();
  });

  it("applies LEXI and another FLOW scene from the header browser and updates the label", () => {
    mount(<Harness />);
    act(() => {
      (host!.querySelector("[data-testid=visualizer-scene]") as HTMLButtonElement).click();
    });
    act(() => {
      (document.querySelector("[data-testid=vis-lane-browser-category-LEXI]") as HTMLButtonElement).click();
    });
    act(() => {
      (document.querySelector("[data-testid=vis-lane-browser-family-FLOW]") as HTMLButtonElement).click();
    });
    for (const id of LEXI_SCENE_IDS) {
      expect(document.querySelector(`[data-testid=vis-lane-browser-scene-${id}]`)).toBeTruthy();
    }
    act(() => {
      (document.querySelector("[data-testid=vis-lane-browser-scene-lexi]") as HTMLButtonElement).click();
    });
    expect((host!.querySelector("[data-testid=visualizer-scene]") as HTMLButtonElement).textContent).toBe(
      "LEXI",
    );
    expect(document.querySelector("[data-testid=vis-lane-browser]")).toBeNull();

    act(() => {
      (host!.querySelector("[data-testid=lane-label-VIS]") as HTMLElement).click();
    });
    act(() => {
      (document.querySelector("[data-testid=vis-lane-browser-category-LEXI]") as HTMLButtonElement).click();
    });
    act(() => {
      (document.querySelector("[data-testid=vis-lane-browser-family-FLOW]") as HTMLButtonElement).click();
    });
    act(() => {
      (document.querySelector("[data-testid=vis-lane-browser-scene-lexi-v3]") as HTMLButtonElement).click();
    });
    expect((host!.querySelector("[data-testid=visualizer-scene]") as HTMLButtonElement).textContent).toBe(
      "LEXI V3",
    );
  });

  it("keeps cycle as fallback when the scene setter is not wired", () => {
    let cycles = 0;
    mount(
      <Timeline
        {...timelineProps({
          onCycleVisualizerScene: () => {
            cycles += 1;
          },
        })}
      />,
    );
    act(() => {
      (host!.querySelector("[data-testid=visualizer-scene]") as HTMLButtonElement).click();
    });
    expect(cycles).toBe(1);
    expect(document.querySelector("[data-testid=vis-lane-browser]")).toBeNull();
  });
});
