import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { RULER_PAD_PX } from "../../src/core/zoom";
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

const ZOOM = 80;
const CLICK_X = 80;

function visProject() {
  const project = projectWith(
    [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 8000 })],
    [asset({ id: "va", kind: "video", durationMs: 8000 })],
  );
  project.visualizer = {
    ...project.visualizer,
    events: [{ id: "ve-tunnel", sceneId: "tunnel-spiral", startMs: 0, durationMs: 4000 }],
  };
  project.zoomPxPerSec = ZOOM;
  project.scrollMs = 0;
  project.snap = false;
  project.playheadMs = 0;
  return project;
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    project: visProject(),
    selectedClipId: null as string | null,
    selectedClipIds: [] as string[],
    selectedVis: false,
    selectedVisEventId: null as string | null,
    onSelect: (_id: string | null) => {},
    onSelectVis: noop,
    onSelectVisEvent: (_id: string) => {},
    onPlayhead: noopMs,
    onMoveLive: (_id: string, _start: number, _track?: TrackId) => {},
    onMoveCommit: noop,
    onTrimLive: (_id: string, _edge: "in" | "out", _ms: number) => {},
    onTrimCommit: noop,
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

function expectedSeekMs(clientX: number): number {
  return ((clientX - RULER_PAD_PX) / ZOOM) * 1000;
}

describe("VIS lane click-to-seek", () => {
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
    const visBody = host.querySelector('[data-testid="lane-VIS-body"]')!;
    const v1Body = host.querySelector('[data-testid="lane-V1-body"]')!;
    const ruler = host.querySelector('[data-testid="ruler"]')!;
    stubRect(visBody);
    stubRect(v1Body);
    stubRect(ruler);
    return { visBody, v1Body, ruler };
  }

  it("VIS event click seeks the same ms as a V1 lane-body click at that x", () => {
    const seeks: number[] = [];
    const { v1Body } = render(
      baseProps({
        onPlayhead: (ms: number) => {
          seeks.push(ms);
        },
      }),
    );
    const eventEl = host!.querySelector('[data-testid="vis-event-ve-tunnel"]')!;
    expect(eventEl).toBeTruthy();
    act(() => {
      eventEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: CLICK_X, clientY: 12 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: CLICK_X, clientY: 12 }));
    });
    act(() => {
      v1Body.dispatchEvent(pointer("pointerdown", { button: 0, clientX: CLICK_X, clientY: 40 }));
    });
    expect(seeks).toEqual([expectedSeekMs(CLICK_X), expectedSeekMs(CLICK_X)]);
  });

  it("empty VIS body and a selected event both seek; VIS header does not", () => {
    const seeks: number[] = [];
    let headerPicks = 0;
    const { visBody } = render(
      baseProps({
        selectedVis: true,
        selectedVisEventId: "ve-tunnel",
        onPlayhead: (ms: number) => {
          seeks.push(ms);
        },
        onSelectVis: () => {
          headerPicks += 1;
        },
      }),
    );
    const header = host!.querySelector('[data-testid="lane-label-VIS"]')!;
    act(() => {
      header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(headerPicks).toBe(1);
    expect(seeks).toEqual([]);

    const emptyX = 400;
    act(() => {
      visBody.dispatchEvent(pointer("pointerdown", { button: 0, clientX: emptyX, clientY: 12 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: emptyX, clientY: 12 }));
    });
    expect(seeks).toEqual([expectedSeekMs(emptyX)]);

    const eventEl = host!.querySelector('[data-testid="vis-event-ve-tunnel"]')!;
    act(() => {
      eventEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: CLICK_X, clientY: 12 }));
    });
    expect(seeks).toEqual([expectedSeekMs(emptyX), expectedSeekMs(CLICK_X)]);
  });
});
