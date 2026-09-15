import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/core/project";
import { Mixer } from "../../src/ui/mixer/Mixer";
import { Timeline } from "../../src/ui/timeline/Timeline";
import type { TrackId } from "../../src/core/models";
import "../../src/styles.css";

const silentPeaks = { V1: 0, V2: 0, A1: 0, A2: 0, master: 0 };
const noop = () => {};
const noopMs = (_ms: number) => {};

describe("arrange overflow", () => {
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

  it("lanes scroll vertically; tools and ruler stay outside the scroller (P52)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <div className="lower-stage" style={{ height: 240 }}>
          <div className="arrange-row" data-testid="arrange-row" style={{ overflow: "hidden" }}>
            <Timeline
              project={createEmptyProject()}
              selectedClipId={null}
              onSelect={noop}
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
            <Mixer
              project={createEmptyProject()}
              selectedTrackId="A1"
              peaks={silentPeaks}
              onSelectTrack={noop}
              onVolume={noop}
              onMasterVolume={noop}
              onToggleMute={noop}
              onToggleSolo={noop}
            />
          </div>
        </div>,
      );
    });
    const row = host.querySelector('[data-testid="arrange-row"]') as HTMLElement;
    const timeline = host.querySelector('[data-testid="timeline"]') as HTMLElement;
    const lanes = host.querySelector('[data-testid="timeline-lanes"]') as HTMLElement;
    const tools = timeline?.querySelector(".timeline-tools") as HTMLElement;
    const ruler = host.querySelector('[data-testid="ruler"]') as HTMLElement;
    expect(row && timeline && lanes && tools && ruler).toBeTruthy();
    const rowOverflow = row.style.overflow || getComputedStyle(row).overflow;
    expect(rowOverflow === "hidden" || getComputedStyle(row).overflowY === "hidden").toBe(true);
    expect(lanes.contains(tools)).toBe(false);
    expect(lanes.contains(ruler)).toBe(false);
    expect(timeline.contains(tools)).toBe(true);
    expect(timeline.contains(ruler)).toBe(true);
    expect(lanes.contains(host.querySelector('[data-testid="lane-VIS"]')!)).toBe(true);
    expect(lanes.contains(host.querySelector('[data-testid="lane-A2"]')!)).toBe(true);
    expect(host.querySelector('[data-testid="mute-A2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mute-V2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="solo-A2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="solo-V1"]')).toBeTruthy();
    expect(lanes.classList.contains("timeline-lanes")).toBe(true);
    const lanesOverflow = lanes.style.overflowY || getComputedStyle(lanes).overflowY;
    expect(lanesOverflow === "auto" || lanesOverflow === "scroll").toBe(true);
  });

  it("short Arrange does not crush the time ruler (H lane lock must not steal ruler height)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <div className="lower-stage" style={{ height: 120 }}>
          <div
            className="arrange-row"
            data-testid="arrange-row"
            style={{ height: 120, minHeight: 0, overflow: "hidden" }}
          >
            <Timeline
              project={createEmptyProject()}
              selectedClipId={null}
              onSelect={noop}
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
            <Mixer
              project={createEmptyProject()}
              selectedTrackId="A1"
              peaks={silentPeaks}
              onSelectTrack={noop}
              onVolume={noop}
              onMasterVolume={noop}
              onToggleMute={noop}
              onToggleSolo={noop}
            />
          </div>
        </div>,
      );
    });
    const chrome = host.querySelector(".ruler") as HTMLElement;
    const tools = host.querySelector(".timeline-tools") as HTMLElement;
    const lanes = host.querySelector('[data-testid="timeline-lanes"]') as HTMLElement;
    expect(chrome && tools && lanes).toBeTruthy();
    expect(lanes.contains(chrome)).toBe(false);
    expect(lanes.contains(tools)).toBe(false);
    expect(chrome.nextElementSibling).toBe(lanes);
    expect(tools.nextElementSibling).toBe(chrome);
  });
});
