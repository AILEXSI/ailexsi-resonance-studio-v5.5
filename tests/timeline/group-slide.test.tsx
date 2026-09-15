import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { asset, clip, projectWith } from "../helpers";
import type { TrackId } from "../../src/core/models";
import "../../src/styles.css";

function pointer(type: string, init: MouseEventInit = {}): Event {
  const Ctor = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, ...init });
}

const noop = () => {};
const noopMs = (_ms: number) => {};

function blockProject() {
  return {
    ...projectWith(
      [
        clip({ id: "L", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "A", assetId: "a", trackId: "A1", startMs: 1000, durationMs: 1000 }),
        clip({ id: "B", assetId: "a", trackId: "A1", startMs: 2000, durationMs: 1000 }),
        clip({ id: "R", assetId: "a", trackId: "A1", startMs: 3000, durationMs: 1000 }),
      ],
      [asset({ id: "a", kind: "audio", durationMs: 8000 })],
    ),
    zoomPxPerSec: 80,
    scrollMs: 0,
    snap: false,
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    project: blockProject(),
    selectedClipId: "A" as string | null,
    selectedClipIds: ["A", "B"] as string[],
    onSelect: (_id: string | null) => {},
    onPlayhead: noopMs,
    onMoveLive: (_id: string, _start: number, _track?: TrackId, _ids?: string[]) => {},
    onMoveCommit: noop,
    onTrimLive: (_id: string, _edge: "in" | "out", _ms: number) => {},
    onTrimCommit: noop,
    onSlideLive: (_id: string, _delta: number, _ids?: readonly string[]) => {},
    onSlideCommit: noop,
    onToggleMute: (_id: TrackId) => {},
    onToggleVisualizerMute: noop,
    onCycleVisualizerScene: noop,
    onSplitHere: (_id: string, _ms: number) => {},
    onCut: noop,
    onCopy: noop,
    onPaste: noop,
    onDelete: noop,
    onZoom: (_z: number, _w: number) => {},
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

describe("timeline group slide gesture", () => {
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

  function render(props: ReturnType<typeof baseProps>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<Timeline {...props} />);
    });
    return host.querySelector('[data-testid="clip-A"]')!;
  }

  it("Ctrl+Alt+drag on a selected block clip slides the block, not move", () => {
    const slides: Array<{ id: string; ids?: readonly string[] }> = [];
    const moves: number[] = [];
    const clipEl = render(
      baseProps({
        onSlideLive: (id: string, _delta: number, ids?: readonly string[]) => {
          slides.push({ id, ids });
        },
        onMoveLive: () => {
          moves.push(1);
        },
      }),
    );
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 160, clientY: 20, ctrlKey: true, altKey: true }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 180, clientY: 20, ctrlKey: true, altKey: true }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 180, clientY: 20 }));
    });
    expect(slides.at(-1)?.ids).toEqual(["A", "B"]);
    expect(moves).toEqual([]);
  });

  it("plain drag on the selected block still group-moves", () => {
    const slides: number[] = [];
    const moves: Array<string[] | undefined> = [];
    const clipEl = render(
      baseProps({
        onSlideLive: () => {
          slides.push(1);
        },
        onMoveLive: (_id: string, _start: number, _track?: TrackId, ids?: string[]) => {
          moves.push(ids);
        },
      }),
    );
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 160, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 180, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 180, clientY: 20 }));
    });
    expect(slides).toEqual([]);
    expect(moves.at(-1)).toEqual(["A", "B"]);
  });
});
