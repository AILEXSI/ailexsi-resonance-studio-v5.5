import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { addMarker, deleteMarker, moveMarker } from "../../src/core/timeline";
import { createEmptyProject } from "../../src/core/project";
import type { Project, TrackId } from "../../src/core/models";
import "../../src/styles.css";

const noop = () => {};
const noopMs = (_ms: number) => {};

function pointer(type: string, init: MouseEventInit = {}): Event {
  const Ctor = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, ...init });
}

function seedProject(): Project {
  let p = { ...createEmptyProject(), zoomPxPerSec: 100, scrollMs: 0 };
  p = addMarker(p, 1000, "M1");
  p = addMarker(p, 2500, "M2");
  return p;
}

function MarkerHarness() {
  const [state, setState] = useState<{ project: Project; selectedMarkerId: string | null }>(() => {
    const project = seedProject();
    return { project, selectedMarkerId: project.markers[0]?.id ?? null };
  });
  const { project, selectedMarkerId } = state;
  return (
    <Timeline
      project={project}
      selectedClipId={null}
      selectedMarkerId={selectedMarkerId}
      onSelect={() => setState((s) => ({ ...s, selectedMarkerId: null }))}
      onSelectMarker={(id) => setState((s) => ({ ...s, selectedMarkerId: id }))}
      onMarkerMoveLive={(id, ms) => {
        setState((s) => ({ ...s, project: moveMarker(s.project, id, ms).project }));
      }}
      onMarkerMoveCommit={noop}
      onDeleteMarker={(id) => {
        setState((s) => ({
          project: deleteMarker(s.project, id).project,
          selectedMarkerId: s.selectedMarkerId === id ? null : s.selectedMarkerId,
        }));
      }}
      onPlayhead={noopMs}
      onMoveLive={(_id: string, _start: number, _track?: TrackId) => {}}
      onMoveCommit={noop}
      onTrimLive={(_id: string, _edge: "in" | "out", _ms: number) => {}}
      onTrimCommit={noop}
      onToggleMute={noop}
      onToggleSolo={noop}
      onToggleVisualizerMute={noop}
      onCycleVisualizerScene={noop}
      onSplitHere={noop}
      onCut={noop}
      onCopy={noop}
      onPaste={noop}
      onDelete={noop}
      onZoom={noop}
      onFit={noopMs}
      onScroll={noopMs}
      onLoopClick={noopMs}
      onLoopInLive={noopMs}
      onLoopOutLive={noopMs}
      onLoopMoveLive={noopMs}
      onLoopCommit={noop}
    />
  );
}

describe("marker DOM", () => {
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

  it("drag moves the marker time; x and context menu delete only that marker", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<MarkerHarness />);
    });

    const flags = host.querySelectorAll("[data-testid^='marker-mk'], [data-testid^='marker-']");
    const markers = [...host.querySelectorAll(".marker")] as HTMLElement[];
    expect(markers.length).toBe(2);
    const first = markers[0]!;
    const firstId = first.getAttribute("data-testid")!.slice("marker-".length);
    const secondId = markers[1]!.getAttribute("data-testid")!.slice("marker-".length);

    act(() => {
      first.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 200 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 300 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", {}));
    });

    const afterDrag = host.querySelector(`[data-testid="marker-${firstId}"]`) as HTMLElement;
    const left = Number.parseFloat(afterDrag.style.left);
    // zoom 100 px/s, pad 56, time should be ~2000ms → left ≈ 256
    expect(left).toBeGreaterThan(200);

    act(() => {
      (host!.querySelector(`[data-testid="marker-delete-${secondId}"]`) as HTMLButtonElement).click();
    });
    expect(host.querySelector(`[data-testid="marker-${secondId}"]`)).toBeNull();
    expect(host.querySelector(`[data-testid="marker-${firstId}"]`)).toBeTruthy();

    act(() => {
      host!
        .querySelector(`[data-testid="marker-${firstId}"]`)!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }));
    });
    expect(host.querySelector('[data-testid="marker-menu"]')).toBeTruthy();
    act(() => {
      (host!.querySelector('[data-testid="marker-menu-delete"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector(`[data-testid="marker-${firstId}"]`)).toBeNull();
    expect(flags.length).toBeGreaterThan(0);
  });
});
