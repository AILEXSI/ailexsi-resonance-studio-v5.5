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

function stubRect(el: Element, left = 0, top = 0, width = 800, height = 52) {
  el.getBoundingClientRect = () =>
    ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON() {
        return {};
      },
    }) as DOMRect;
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
    selectedClipId: null as string | null,
    selectedClipIds: [] as string[],
    onSelect: (_id: string | null) => {},
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

describe("timeline marquee", () => {
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
    const lane = host.querySelector('[data-testid="lane-A1-body"]')!;
    stubRect(lane);
    const timeline = host.querySelector('[data-testid="timeline"]')!;
    stubRect(timeline, 0, 0, 800, 400);
    return { lane, timeline };
  }

  it("empty-lane drag selects intersecting clips", () => {
    const boxed: string[][] = [];
    const { lane } = render(
      baseProps({
        onSelectClips: (ids: readonly string[]) => {
          boxed.push([...ids]);
        },
      }),
    );
    act(() => {
      lane.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 70, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 120, clientY: 24 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 120, clientY: 24 }));
    });
    expect(boxed.at(-1)).toEqual(["c1"]);
  });

  it("miss selects none; empty click clears", () => {
    const boxed: string[][] = [];
    let cleared = 0;
    const { lane } = render(
      baseProps({
        selectedClipId: "c1",
        selectedClipIds: ["c1"],
        onSelect: (id: string | null) => {
          if (id == null) cleared += 1;
        },
        onSelectClips: (ids: readonly string[]) => {
          boxed.push([...ids]);
        },
      }),
    );
    act(() => {
      lane.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 170, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 200, clientY: 22 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 200, clientY: 22 }));
    });
    expect(boxed.at(-1)).toEqual([]);

    act(() => {
      lane.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 80, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 80, clientY: 20 }));
    });
    expect(cleared).toBe(1);
  });

  it("Shift+marquee unions into the existing selection", () => {
    const unions: Array<{ ids: string[]; union?: boolean }> = [];
    const { lane } = render(
      baseProps({
        selectedClipId: "c1",
        selectedClipIds: ["c1"],
        onSelectClips: (ids: readonly string[], opts?: { union?: boolean }) => {
          unions.push({ ids: [...ids], union: opts?.union });
        },
      }),
    );
    act(() => {
      lane.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 220, clientY: 20, shiftKey: true }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 280, clientY: 24, shiftKey: true }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 280, clientY: 24, shiftKey: true }));
    });
    expect(unions.at(-1)).toEqual({ ids: ["c2"], union: true });
  });

  it("clip-body drag still moves and does not marquee", () => {
    const moves: number[] = [];
    const boxed: string[][] = [];
    render(
      baseProps({
        onMoveLive: () => {
          moves.push(1);
        },
        onSelectClips: (ids: readonly string[]) => {
          boxed.push([...ids]);
        },
      }),
    );
    const clipEl = host!.querySelector('[data-testid="clip-c1"]')!;
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 80, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 100, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 100, clientY: 20 }));
    });
    expect(moves.length).toBeGreaterThan(0);
    expect(boxed).toEqual([]);
  });

  it("trim and fade handles still win over marquee", () => {
    const boxed: string[][] = [];
    const fades: number[] = [];
    const trims: number[] = [];
    render(
      baseProps({
        project: {
          ...project(),
          clips: [
            clip({
              id: "c1",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 2000,
            }),
          ],
        },
        selectedClipId: "c1",
        selectedClipIds: ["c1"],
        onSelectClips: (ids: readonly string[]) => {
          boxed.push([...ids]);
        },
        onFadesLive: () => {
          fades.push(1);
        },
        onTrimLive: () => {
          trims.push(1);
        },
      }),
    );
    const fade = host!.querySelector('[data-testid="fade-handle-in-c1"]')!;
    const trim = host!.querySelector('[data-testid="trim-in-c1"]')!;
    act(() => {
      fade.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 70, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 90, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 90, clientY: 20 }));
    });
    act(() => {
      trim.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 56, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 70, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 70, clientY: 20 }));
    });
    expect(fades.length).toBeGreaterThan(0);
    expect(trims.length).toBeGreaterThan(0);
    expect(boxed).toEqual([]);
  });
});
