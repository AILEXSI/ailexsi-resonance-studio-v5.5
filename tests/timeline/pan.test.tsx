import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { maxScrollMs } from "../../src/core/zoom";
import { asset, clip, projectWith } from "../helpers";
import type { TrackId } from "../../src/core/models";
import "../../src/styles.css";

const noop = () => {};
const noopMs = (_ms: number) => {};

describe("timeline pan at high zoom (P65)", () => {
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

  it("Pan slider max is duration minus visible window, not duration-4000", () => {
    const project = {
      ...projectWith(
        [clip({ id: "c1", assetId: "wav", trackId: "A1", startMs: 0, durationMs: 300_000 })],
        [asset({ id: "wav", kind: "audio", durationMs: 300_000, name: "long.wav" })],
      ),
      zoomPxPerSec: 12_000,
      scrollMs: 0,
    };
    const scrolls: number[] = [];
    const zooms: number[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Timeline
          project={project}
          selectedClipId={null}
          onSelect={noop}
          onPlayhead={noopMs}
          onMoveLive={(_id: string, _start: number, _track?: TrackId) => {}}
          onMoveCommit={noop}
          onTrimLive={() => {}}
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
          onZoom={(z) => zooms.push(z)}
          onFit={noopMs}
          onScroll={(ms) => scrolls.push(ms)}
          onLoopClick={noopMs}
          onLoopInLive={noopMs}
          onLoopOutLive={noopMs}
          onLoopMoveLive={noopMs}
          onLoopCommit={noop}
        />,
      );
    });
    const pan = host.querySelector('[data-testid="timeline-pan"]') as HTMLInputElement;
    expect(pan).toBeTruthy();
    const max = Number(pan.max);
    const expected = maxScrollMs(300_000, 12_000, 1000);
    expect(max).toBeCloseTo(expected, 5);
    expect(max).toBeGreaterThan(300_000 - 4000);

    const timeline = host.querySelector('[data-testid="timeline"]') as HTMLElement;
    act(() => {
      timeline.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80, shiftKey: true }),
      );
    });
    expect(scrolls.length).toBeGreaterThan(0);
    expect(zooms).toEqual([]);
  });
});
