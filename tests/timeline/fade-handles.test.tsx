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

function mountTimeline(
  opts: {
    durationMs?: number;
    zoomPxPerSec?: number;
    selected?: boolean;
    onFadesLive?: (clipId: string, fadeInMs: number, fadeOutMs: number) => void;
    onFadesCommit?: () => void;
    onTrimLive?: (clipId: string, edge: "in" | "out", ms: number) => void;
  } = {},
) {
  const project = {
    ...projectWith(
      [
        clip({
          id: "c1",
          assetId: "a",
          trackId: "A1",
          startMs: 0,
          durationMs: opts.durationMs ?? 2000,
          fadeInMs: 0,
          fadeOutMs: 0,
        }),
      ],
      [asset({ id: "a", kind: "audio", durationMs: 4000 })],
    ),
    zoomPxPerSec: opts.zoomPxPerSec ?? 80,
    snap: false,
  };
  const props = {
    project,
    selectedClipId: opts.selected === false ? null : "c1",
    selectedClipIds: opts.selected === false ? [] : ["c1"],
    onSelect: (_id: string | null) => {},
    onPlayhead: noopMs,
    onMoveLive: (_id: string, _start: number, _track?: TrackId) => {},
    onMoveCommit: noop,
    onTrimLive: opts.onTrimLive ?? ((_id: string, _edge: "in" | "out", _ms: number) => {}),
    onTrimCommit: noop,
    onFadesLive: opts.onFadesLive,
    onFadesCommit: opts.onFadesCommit,
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
  };
  return props;
}

describe("fade handle DOM", () => {
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

  function render(props: ReturnType<typeof mountTimeline>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<Timeline {...props} />);
    });
  }

  it("shows fade handles inset from trim on a wide selected clip", () => {
    render(mountTimeline());
    const fadeIn = host!.querySelector('[data-testid="fade-handle-in-c1"]');
    const fadeOut = host!.querySelector('[data-testid="fade-handle-out-c1"]');
    const trimIn = host!.querySelector('[data-testid="trim-in-c1"]');
    const trimOut = host!.querySelector('[data-testid="trim-out-c1"]');
    expect(fadeIn).toBeTruthy();
    expect(fadeOut).toBeTruthy();
    expect(trimIn).toBeTruthy();
    expect(trimOut).toBeTruthy();
    expect(getComputedStyle(fadeIn!).cursor).toBe("w-resize");
    expect(getComputedStyle(fadeOut!).cursor).toBe("e-resize");
    expect(trimIn!.className).toContain("trim-handle");
    expect(fadeIn!.className).toContain("fade-handle");
  });

  it("hides fade handles when the clip is too narrow and keeps trim", () => {
    render(mountTimeline({ durationMs: 200, zoomPxPerSec: 80 }));
    expect(host!.querySelector('[data-testid="fade-handle-in-c1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="fade-handle-out-c1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="trim-in-c1"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="trim-out-c1"]')).toBeTruthy();
  });

  it("drag maps pixels to fadeInMs via setClipFades live + commit", () => {
    const fades: Array<{ inMs: number; outMs: number }> = [];
    let commits = 0;
    render(
      mountTimeline({
        onFadesLive: (_id, fadeInMs, fadeOutMs) => {
          fades.push({ inMs: fadeInMs, outMs: fadeOutMs });
        },
        onFadesCommit: () => {
          commits += 1;
        },
      }),
    );
    const handle = host!.querySelector('[data-testid="fade-handle-in-c1"]')!;
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 40, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 56, clientY: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 56, clientY: 20 }));
    });
    expect(fades.length).toBeGreaterThan(0);
    expect(fades.at(-1)).toEqual({ inMs: 200, outMs: 0 });
    expect(commits).toBe(1);
  });

  it("does not steal Alt-slip from the fade handle", () => {
    const fades: number[] = [];
    render(
      mountTimeline({
        onFadesLive: () => {
          fades.push(1);
        },
      }),
    );
    const handle = host!.querySelector('[data-testid="fade-handle-in-c1"]')!;
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 40, altKey: true }));
    });
    expect(fades).toEqual([]);
  });
});
