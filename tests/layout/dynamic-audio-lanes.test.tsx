import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { addAudioTrack } from "../../src/core/audio-tracks";
import { createEmptyProject } from "../../src/core/project";
import { Mixer } from "../../src/ui/mixer/Mixer";
import { Timeline } from "../../src/ui/timeline/Timeline";
import type { TrackId } from "../../src/core/models";
import "../../src/styles.css";

const silentPeaks = { V1: 0, V2: 0, A1: 0, A2: 0, master: 0 };
const noop = () => {};
const noopMs = (_ms: number) => {};

function timelineNoops() {
  return {
    selectedClipId: null as string | null,
    onSelect: noop,
    onPlayhead: noopMs,
    onMoveLive: (_id: string, _start: number, _track?: TrackId) => {},
    onMoveCommit: noop,
    onTrimLive: (_id: string, _edge: "in" | "out", _ms: number) => {},
    onTrimCommit: noop,
    onToggleMute: noop,
    onToggleSolo: noop,
    onToggleVisualizerMute: noop,
    onCycleVisualizerScene: noop,
    onSplitHere: noop,
    onCut: noop,
    onCopy: noop,
    onPaste: noop,
    onDelete: noop,
    onZoom: noop,
    onFit: noopMs,
    onScroll: noopMs,
    onLoopClick: noopMs,
    onLoopInLive: noopMs,
    onLoopOutLive: noopMs,
    onLoopMoveLive: noopMs,
    onLoopCommit: noop,
  };
}

describe("dynamic audio lane chrome", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  function mountTimeline(
    project: ReturnType<typeof createEmptyProject>,
    opts: {
      canAdd?: boolean;
      canRemove?: boolean;
      onAdd?: () => void;
      onRemove?: () => void;
    } = {},
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <div className="lower-stage" style={{ height: 240 }}>
          <div className="arrange-row" data-testid="arrange-row" style={{ overflow: "hidden" }}>
            <Timeline
              project={project}
              {...timelineNoops()}
              onAddAudioTrack={opts.onAdd ?? (() => undefined)}
              onRemoveAudioTrack={opts.onRemove ?? (() => undefined)}
              canAddAudioTrack={opts.canAdd ?? true}
              canRemoveAudioTrack={opts.canRemove ?? false}
            />
            <Mixer
              project={project}
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
  }

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("reuses the A-lane template; +/− live on the last audio header, not next to Fit", () => {
    const added = addAudioTrack(createEmptyProject());
    const a3 = added.track!;
    const addedCalls: string[] = [];
    mountTimeline(added.project, {
      canAdd: true,
      canRemove: true,
      onAdd: () => addedCalls.push("add"),
      onRemove: () => addedCalls.push("remove"),
    });

    const lanes = host!.querySelector('[data-testid="timeline-lanes"]') as HTMLElement;
    const tools = host!.querySelector(".timeline-tools") as HTMLElement;
    const a1 = host!.querySelector('[data-testid="lane-A1"]') as HTMLElement;
    const extra = host!.querySelector(`[data-testid="lane-${a3.id}"]`) as HTMLElement;
    expect(a1).toBeTruthy();
    expect(extra).toBeTruthy();
    expect(extra.className).toContain("audio-lane");
    expect(extra.querySelector(`[data-testid="mute-${a3.id}"]`)).toBeTruthy();
    expect(extra.querySelector(`[data-testid="solo-${a3.id}"]`)).toBeTruthy();
    expect(extra.querySelector(`[data-testid="lane-${a3.id}-body"]`)).toBeTruthy();
    expect(extra.textContent).toContain("A3");
    expect(a1.className.split(" ").filter((c) => c === "audio-lane")).toEqual(
      extra.className.split(" ").filter((c) => c === "audio-lane"),
    );
    const lanesOverflow = lanes.style.overflowY || getComputedStyle(lanes).overflowY;
    expect(lanesOverflow === "scroll" || lanesOverflow === "auto").toBe(true);

    expect(tools.textContent).not.toContain("+A");
    expect(tools.textContent).not.toContain("−A");
    expect(tools.querySelector('[data-testid="add-audio-track"]')).toBeNull();
    expect(tools.querySelector('[data-testid="remove-audio-track"]')).toBeNull();
    expect(a1.querySelector('[data-testid="add-audio-track"]')).toBeNull();
    expect(a1.querySelector('[data-testid="lane-audio-count-A1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="lane-A2"]')!.querySelector('[data-testid="add-audio-track"]')).toBeNull();

    const add = extra.querySelector('[data-testid="add-audio-track"]') as HTMLButtonElement;
    const remove = extra.querySelector('[data-testid="remove-audio-track"]') as HTMLButtonElement;
    expect(add).toBeTruthy();
    expect(remove).toBeTruthy();
    expect(add.className).toContain("lane-audio-count-btn");
    expect(remove.className).toContain("lane-audio-count-btn");
    expect(add.textContent).toBe("+");
    expect(remove.textContent).toBe("−");
    expect(add.disabled).toBe(false);

    const mixScroll = host!.querySelector('[data-testid="mixer-channel-scroll"]') as HTMLElement;
    expect(mixScroll).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-A1"]')).toBeTruthy();
    expect(host!.querySelector(`[data-testid="mix-${a3.id}"]`)).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    const mixOverflow = getComputedStyle(mixScroll).overflowX || mixScroll.style.overflowX;
    expect(mixOverflow === "auto" || mixOverflow === "scroll").toBe(true);

    act(() => {
      add.click();
      remove.click();
    });
    expect(addedCalls).toEqual(["add", "remove"]);
  });

  it("shows only + on the last audio header at the two-track floor", () => {
    mountTimeline(createEmptyProject(), { canAdd: true, canRemove: false });
    const a2 = host!.querySelector('[data-testid="lane-A2"]') as HTMLElement;
    expect(a2.querySelector('[data-testid="add-audio-track"]')).toBeTruthy();
    expect(a2.querySelector('[data-testid="remove-audio-track"]')).toBeNull();
    expect(host!.querySelector('[data-testid="lane-A1"]')!.querySelector('[data-testid="add-audio-track"]')).toBeNull();
    expect(
      (a2.querySelector('[data-testid="add-audio-track"]') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("disables + at the 64-track cap on the last audio header", () => {
    const added = addAudioTrack(createEmptyProject());
    mountTimeline(added.project, { canAdd: false, canRemove: true });
    const extra = host!.querySelector(`[data-testid="lane-${added.track!.id}"]`) as HTMLElement;
    const add = extra.querySelector('[data-testid="add-audio-track"]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(extra.querySelector('[data-testid="remove-audio-track"]')).toBeTruthy();
  });

  it("auto-scrolls the lane list to the new last audio header after +", () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      const id = (this as HTMLElement).getAttribute("data-testid");
      if (id) scrolled.push(id);
    };
    function Harness() {
      const [project, setProject] = useState(() => createEmptyProject());
      return (
        <div className="lower-stage" style={{ height: 160 }}>
          <Timeline
            project={project}
            {...timelineNoops()}
            onAddAudioTrack={() => setProject((p) => addAudioTrack(p).project)}
            canAddAudioTrack
            canRemoveAudioTrack
          />
        </div>
      );
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<Harness />);
    });
    const add = host.querySelector('[data-testid="add-audio-track"]') as HTMLButtonElement;
    act(() => {
      add.click();
    });
    const last = [...host.querySelectorAll(".audio-lane")].at(-1) as HTMLElement;
    expect(last).toBeTruthy();
    expect(last.querySelector('[data-testid="add-audio-track"]')).toBeTruthy();
    expect(scrolled.some((id) => id === last.getAttribute("data-testid"))).toBe(true);
    expect(scrolled.length).toBeGreaterThan(0);
    Element.prototype.scrollIntoView = original;
  });
});
