import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { upsertTransition, resolveEditPair } from "../../src/core/transition";
import { asset, clip, projectWith } from "../helpers";
import type { TrackId } from "../../src/core/models";

const noop = () => {};
const noopMs = (_ms: number) => {};

function baseProps() {
  return {
    selectedClipId: null as string | null,
    onSelect: (_id: string | null) => {},
    onPlayhead: noopMs,
    onMoveLive: (_id: string, _start: number, _track?: TrackId) => {},
    onMoveCommit: noop,
    onTrimLive: (_id: string, _edge: "in" | "out", _ms: number) => {},
    onTrimCommit: noop,
    onToggleMute: (_id: TrackId) => {},
    onToggleSolo: (_id: TrackId) => {},
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
}

describe("Arrange overlap mark", () => {
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
    project: ReturnType<typeof projectWith>,
    onSelectClips?: (ids: readonly string[]) => void,
    extra?: {
      onTransitionDurationLive?: (durationMs: number, clipIds: readonly string[]) => void;
      onTransitionDurationCommit?: () => void;
      onTransitionAudioDurationLive?: (audioDurationMs: number, clipIds: readonly string[]) => void;
      onTransitionAudioDurationCommit?: () => void;
    },
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Timeline
          {...baseProps()}
          project={project}
          onSelectClips={(ids) => onSelectClips?.(ids)}
          onTransitionDurationLive={extra?.onTransitionDurationLive}
          onTransitionDurationCommit={extra?.onTransitionDurationCommit}
          onTransitionAudioDurationLive={extra?.onTransitionAudioDurationLive}
          onTransitionAudioDurationCommit={extra?.onTransitionAudioDurationCommit}
        />,
      );
    });
  }

  it("shows a cut mark for a V1/V2 overlap with no stored transition", () => {
    const project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    mount(project);
    const mark = host!.querySelector('[data-testid="overlap-mark"]');
    expect(mark).toBeTruthy();
    expect(mark?.getAttribute("data-type")).toBe("cut");
    expect(mark?.textContent).toMatch(/cut/i);
    expect(mark?.getAttribute("data-a")).toBe("v1");
    expect(mark?.getAttribute("data-b")).toBe("v2");
  });

  it("shows a mark for a V2/V1 overlap (V2 ends first)", () => {
    const project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 3000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 500, durationMs: 1000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    mount(project);
    const mark = host!.querySelector('[data-testid="overlap-mark"]');
    expect(mark).toBeTruthy();
    expect(mark?.getAttribute("data-type")).toBe("cut");
    expect(mark?.getAttribute("data-a")).toBe("v2");
    expect(mark?.getAttribute("data-b")).toBe("v1");
  });

  it("clicking the mark selects both clip ids", () => {
    const project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    const picks: string[][] = [];
    mount(project, (ids) => picks.push([...ids]));
    act(() => {
      host!.querySelector<HTMLElement>('[data-testid="overlap-mark"]')!.click();
    });
    expect(picks[0]?.slice().sort()).toEqual(["v1", "v2"]);
  });

  it("stored transition type appears on the mark", () => {
    let project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    const pair = resolveEditPair(project, ["v1"]);
    project = upsertTransition(project, pair!, { type: "crossfade", durationMs: 400 }).project;
    mount(project);
    const mark = host!.querySelector('[data-testid="overlap-mark"]');
    expect(mark?.getAttribute("data-type")).toBe("crossfade");
    expect(mark?.getAttribute("data-duration-ms")).toBe("400");
    expect(mark?.textContent).toMatch(/crossfade/);
    expect(mark?.textContent).toMatch(/400/);
  });

  it("exposes a video duration handle that is not a clip fade handle", () => {
    const project = {
      ...projectWith(
        [
          clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
          clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
        ],
        [
          asset({ id: "va", kind: "video", durationMs: 4000 }),
          asset({ id: "vb", kind: "video", durationMs: 4000 }),
        ],
      ),
      snap: false,
    };
    mount(project);
    const video = host!.querySelector('[data-testid="overlap-duration-handle-video"]');
    expect(video).toBeTruthy();
    expect(video?.className).toContain("transition-duration-handle");
    expect(video?.className).not.toContain("fade-handle");
    expect(host!.querySelector('[data-testid="overlap-duration-handle-audio"]')).toBeNull();
  });

  it("shows an audio duration handle when audio is crossfade", () => {
    let project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    const pair = resolveEditPair(project, ["v1"]);
    project = upsertTransition(project, pair!, {
      type: "cut",
      durationMs: 400,
      audio: "crossfade",
      audioDurationMs: 200,
    }).project;
    mount({ ...project, snap: false });
    expect(host!.querySelector('[data-testid="overlap-duration-handle-audio"]')).toBeTruthy();
  });

  it("drag video duration handle live+commit writes durationMs only", () => {
    let project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    const pair = resolveEditPair(project, ["v1"]);
    project = upsertTransition(project, pair!, {
      type: "crossfade",
      durationMs: 400,
      audio: "crossfade",
      audioDurationMs: 200,
    }).project;
    project = { ...project, snap: false, zoomPxPerSec: 80 };
    const video: number[] = [];
    const audio: number[] = [];
    let commits = 0;
    mount(project, undefined, {
      onTransitionDurationLive: (ms) => video.push(ms),
      onTransitionDurationCommit: () => {
        commits += 1;
      },
      onTransitionAudioDurationLive: (ms) => audio.push(ms),
    });
    const handle = host!.querySelector('[data-testid="overlap-duration-handle-video"]')!;
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 40 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 48 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 48 }));
    });
    expect(video.at(-1)).toBe(500);
    expect(audio).toEqual([]);
    expect(commits).toBe(1);
  });

  it("drag audio duration handle live+commit writes audioDurationMs only", () => {
    let project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    const pair = resolveEditPair(project, ["v1"]);
    project = upsertTransition(project, pair!, {
      type: "cut",
      durationMs: 800,
      audio: "crossfade",
      audioDurationMs: 200,
    }).project;
    project = { ...project, snap: false, zoomPxPerSec: 80 };
    const video: number[] = [];
    const audio: number[] = [];
    mount(project, undefined, {
      onTransitionDurationLive: (ms) => video.push(ms),
      onTransitionAudioDurationLive: (ms) => audio.push(ms),
      onTransitionAudioDurationCommit: () => {},
    });
    const handle = host!.querySelector('[data-testid="overlap-duration-handle-audio"]')!;
    act(() => {
      handle.dispatchEvent(pointer("pointerdown", { button: 0, clientX: 20 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointermove", { clientX: 28 }));
    });
    act(() => {
      window.dispatchEvent(pointer("pointerup", { clientX: 28 }));
    });
    expect(audio.at(-1)).toBe(300);
    expect(video).toEqual([]);
  });
});

function pointer(type: string, init: MouseEventInit = {}): Event {
  const Ctor = typeof PointerEvent === "undefined" ? MouseEvent : PointerEvent;
  return new Ctor(type, { bubbles: true, cancelable: true, ...init });
}
