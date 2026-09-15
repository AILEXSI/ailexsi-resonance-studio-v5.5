import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { clipById, isTrackId, type TrackId } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { asset, clip, projectWith } from "../helpers";
import "../../src/styles.css";

function pointer(type: string, init: MouseEventInit = {}): Event {
  const Ctor = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, ...init });
}

const noop = () => {};
const noopMs = (_ms: number) => {};

function videoProject() {
  return {
    ...projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "v2", assetId: "va", trackId: "V2", startMs: 2000, durationMs: 800 }),
      ],
      [asset({ id: "va", kind: "video", durationMs: 4000 })],
    ),
    zoomPxPerSec: 80,
    scrollMs: 0,
    snap: false,
  };
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    project: videoProject(),
    selectedClipId: "v1" as string | null,
    selectedClipIds: ["v1"] as string[],
    onSelect: (_id: string | null) => {},
    onPlayhead: noopMs,
    onMoveLive: (_id: string, _start: number, _track?: TrackId, _ids?: string[]) => {},
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

function stubFromPoint(el: Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: () => el,
  });
}

describe("timeline drag to other video lane", () => {
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
    return host;
  }

  it("drag onto the other video lane fires moveClips with that trackId", () => {
    let session: Session = {
      ...createSession(createMemoryBlobStore()),
      project: videoProject(),
      selectedClipId: "v1",
      selectedClipIds: ["v1"],
    };
    const commands: Array<{ type: string; trackId?: TrackId; clipIds: readonly string[] }> = [];
    const el = render(
      baseProps({
        onMoveLive: (clipId: string, startMs: number, trackId?: TrackId, clipIds?: string[]) => {
          const leader = clipById(session.project, clipId);
          if (!leader) return;
          const command = {
            type: "moveClips" as const,
            clipIds: clipIds?.length ? clipIds : [clipId],
            deltaMs: startMs - leader.startMs,
            trackId,
          };
          commands.push(command);
          session = applyCommand(session, command);
        },
      }),
    );
    const clipEl = el.querySelector('[data-testid="clip-v1"]')!;
    stubFromPoint(el.querySelector('[data-testid="lane-V2-body"]'));
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 40, clientY: 10 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 80 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 40, clientY: 80 }));
    });
    expect(commands.some((c) => c.type === "moveClips" && c.trackId === "V2")).toBe(true);
    expect(session.project.clips.find((c) => c.id === "v1")!.trackId).toBe("V2");
  });

  it("V2 drag onto V1 lane fires moveClips V1", () => {
    const seen: Array<TrackId | undefined> = [];
    const el = render(
      baseProps({
        selectedClipId: "v2",
        selectedClipIds: ["v2"],
        onMoveLive: (_id: string, _start: number, trackId?: TrackId) => {
          seen.push(trackId);
        },
      }),
    );
    const clipEl = el.querySelector('[data-testid="clip-v2"]')!;
    stubFromPoint(el.querySelector('[data-testid="lane-V1-body"]'));
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 200, clientY: 80 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 200, clientY: 10 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 200, clientY: 10 }));
    });
    expect(seen).toContain("V1");
  });

  it("video drag onto an A-track does not pass A1", () => {
    const seen: Array<TrackId | undefined> = [];
    const el = render(
      baseProps({
        selectedClipId: "v2",
        selectedClipIds: ["v2"],
        onMoveLive: (_id: string, _start: number, trackId?: TrackId) => {
          seen.push(trackId);
        },
      }),
    );
    const clipEl = el.querySelector('[data-testid="clip-v2"]')!;
    stubFromPoint(el.querySelector('[data-testid="lane-A1-body"]'));
    act(() => {
      clipEl.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 200, clientY: 80 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 200, clientY: 160 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 200, clientY: 160 }));
    });
    expect(seen.some((t) => t === "A1" || t === "A2")).toBe(false);
  });

  it("VIS span drag does not fire moveClips", () => {
    expect(isTrackId("VIS")).toBe(false);
    const moves: number[] = [];
    const el = render(
      baseProps({
        onMoveLive: () => {
          moves.push(1);
        },
      }),
    );
    const vis = el.querySelector('[data-testid="vis-span"]')!;
    act(() => {
      vis.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 40, clientY: 8 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 40, clientY: 80 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 40, clientY: 80 }));
    });
    expect(moves).toEqual([]);
  });

  it("fallback VIS span click parks playhead then inserts (P94)", () => {
    const seeks: number[] = [];
    let inserts = 0;
    const el = render(
      baseProps({
        onPlayhead: (ms: number) => {
          seeks.push(ms);
        },
        onInsertVisEvent: () => {
          inserts += 1;
        },
      }),
    );
    const vis = el.querySelector('[data-testid="vis-span"]')!;
    act(() => {
      vis.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 80, clientY: 8 }));
    });
    expect(seeks).toHaveLength(1);
    expect(inserts).toBe(1);
  });
});
