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

function project() {
  return {
    ...projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 2000, durationMs: 800 }),
        clip({ id: "c3", assetId: "a", trackId: "A2", startMs: 0, durationMs: 400 }),
      ],
      [asset({ id: "a", kind: "audio", durationMs: 4000 })],
    ),
    zoomPxPerSec: 80,
    scrollMs: 0,
    snap: false,
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    project: project(),
    selectedClipId: "c1" as string | null,
    selectedClipIds: ["c1"] as string[],
    onSelect: (_id: string | null, _opts?: { toggle?: boolean; range?: boolean }) => {},
    onSelectClips: (_ids: readonly string[], _opts?: { union?: boolean }) => {},
    onPlayhead: noopMs,
    onMoveLive: (_id: string, _start: number, _track?: TrackId) => {},
    onMoveCommit: noop,
    onTrimLive: (_id: string, _edge: "in" | "out", _ms: number) => {},
    onTrimCommit: noop,
    onFadesLive: (_id: string, _a: number, _b: number) => {},
    onFadesCommit: noop,
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

describe("timeline Shift+click range", () => {
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
  }

  it("Shift+click a clip requests a range and does not start a move", () => {
    const selects: Array<{ id: string | null; opts?: { toggle?: boolean; range?: boolean } }> = [];
    const moves: number[] = [];
    render(
      baseProps({
        onSelect: (id: string | null, opts?: { toggle?: boolean; range?: boolean }) => {
          selects.push({ id, opts });
        },
        onMoveLive: () => {
          moves.push(1);
        },
      }),
    );
    const clipEl = host!.querySelector('[data-testid="clip-c2"]')!;
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 200, clientY: 20, shiftKey: true }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 240, clientY: 20, shiftKey: true }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 240, clientY: 20, shiftKey: true }));
    });
    expect(selects).toEqual([{ id: "c2", opts: { range: true } }]);
    expect(moves).toEqual([]);
  });

  it("Ctrl/Cmd+click still toggles and does not range", () => {
    const selects: Array<{ id: string | null; opts?: { toggle?: boolean; range?: boolean } }> = [];
    render(
      baseProps({
        onSelect: (id: string | null, opts?: { toggle?: boolean; range?: boolean }) => {
          selects.push({ id, opts });
        },
      }),
    );
    const clipEl = host!.querySelector('[data-testid="clip-c2"]')!;
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 200, clientY: 20, ctrlKey: true }));
    });
    expect(selects).toEqual([{ id: "c2", opts: { toggle: true } }]);
  });
});
