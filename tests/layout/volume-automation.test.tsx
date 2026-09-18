import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { addVolumeAutomationPoint } from "../../src/core/volume-automation";
import { DEFAULT_LANE_HEIGHT_PX, GROUP_LANE_HEIGHT_PX, VOLUME_LANE_HEIGHT_PX } from "../../src/core/layout-prefs";
import { createEmptyProject } from "../../src/core/project";
import { createTrackGroup } from "../../src/core/track-groups";
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

describe("volume automation lane chrome", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  function q(sel: string): Element | null {
    return host?.querySelector(sel) ?? document.querySelector(sel);
  }

  function mount(
    project: ReturnType<typeof createEmptyProject>,
    opts: {
      open?: string[];
      playing?: boolean;
      onToggle?: (id: TrackId) => void;
      onAdd?: (id: TrackId, timeMs: number, value: number) => void;
      writeArmed?: string[];
      onToggleWrite?: (id: TrackId) => void;
    } = {},
  ) {
    if (root) {
      act(() => {
        root!.unmount();
      });
    }
    host?.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <div className="lower-stage" style={{ height: 280 }}>
          <div className="arrange-row" data-testid="arrange-row">
            <Timeline
              project={project}
              {...timelineNoops()}
              openVolumeLaneIds={opts.open}
              onToggleVolumeLane={opts.onToggle ?? (() => undefined)}
              onAddVolumeAutomationPoint={opts.onAdd}
              volumeWriteArmedIds={opts.writeArmed}
              onToggleVolumeWriteArm={opts.onToggleWrite}
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
              playing={opts.playing}
              volumeWriteArmedIds={opts.writeArmed}
              onToggleVolumeWriteArm={opts.onToggleWrite}
            />
          </div>
        </div>,
      );
    });
  }

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it("does not permanently double audio lane height; VOL toggle opens a sub-lane", () => {
    const toggled: string[] = [];
    mount(createEmptyProject(), { onToggle: (id) => toggled.push(id) });
    expect(host!.querySelector('[data-testid="volume-lane-A1"]')).toBeNull();
    const toggle = q('[data-testid="volume-lane-toggle-A1"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toMatch(/VOL|Volume automation/);
    expect(toggle.getAttribute("aria-label")).toBe("Show volume automation");
    expect(host!.querySelector('[data-testid="volume-lane-toggle-V1"]')).toBeNull();
    act(() => {
      (q('[data-testid="volume-lane-toggle-A1"]') as HTMLButtonElement).click();
    });
    expect(toggled).toEqual(["A1"]);

    mount(createEmptyProject(), { open: ["A1"] });
    const audio = host!.querySelector('[data-testid="lane-A1"]') as HTMLElement;
    const vol = host!.querySelector('[data-testid="volume-lane-A1"]') as HTMLElement;
    expect(vol).toBeTruthy();
    expect(audio.style.height).not.toBe(vol.style.height);
    expect(host!.querySelector('[data-testid="volume-lane-A2"]')).toBeNull();
  });

  it("renders envelope points on the open lane", () => {
    const project = addVolumeAutomationPoint(createEmptyProject(), "A1", 0, 1).project;
    const withTwo = addVolumeAutomationPoint(project, "A1", 1000, 0.25).project;
    mount(withTwo, { open: ["A1"] });
    expect(host!.querySelector('[data-testid="volume-point-A1-0"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="volume-point-A1-1000"]')).toBeTruthy();
  });

  it("mixer keeps the static fader and shows an automation readout", () => {
    let project = addVolumeAutomationPoint(createEmptyProject(), "A1", 0, 0.5).project;
    project = {
      ...project,
      playheadMs: 0,
      tracks: project.tracks.map((t) => (t.id === "A1" ? { ...t, volume: 1 } : t)),
    };
    mount(project, { playing: true });
    const fader = host!.querySelector('[data-testid="mix-fader-A1"]') as HTMLInputElement;
    expect(fader).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-db-A1"]')?.textContent).toMatch(/0\.0 dB/);
    expect(host!.querySelector('[data-testid="mix-auto-db-A1"]')?.textContent).toMatch(/dB/);
    expect(host!.querySelector('[data-testid="mix-auto-ghost-A1"]')).toBeTruthy();
  });

  it("W sits with M/S/VOL and shows armed state without a mixer redesign", () => {
    const armed: TrackId[] = [];
    mount(createEmptyProject(), {
      writeArmed: [],
      onToggleWrite: (id) => armed.push(id),
    });
    const laneW = q('[data-testid="write-arm-A1"]') as HTMLButtonElement;
    const mixW = host!.querySelector('[data-testid="mix-write-A1"]') as HTMLButtonElement;
    expect(laneW?.textContent).toMatch(/W|Write automation/);
    expect(mixW?.textContent).toBe("W");
    expect(host!.querySelector('[data-testid="write-arm-V1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mix-write-master"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mute-A1"]')).toBeTruthy();
    expect(q('[data-testid="volume-lane-toggle-A1"]')?.textContent).toMatch(
      /VOL|Volume automation/,
    );
    act(() => {
      laneW.click();
      mixW.click();
    });
    expect(armed).toEqual(["A1", "A1"]);

    mount(createEmptyProject(), { writeArmed: ["A1"], onToggleWrite: () => undefined });
    expect(q('[data-testid="write-arm-A1"]')?.className).toMatch(/active/);
    expect(host!.querySelector('[data-testid="mix-A1"]')?.getAttribute("data-write-armed")).toBe("true");
    expect(host!.querySelector('[data-testid="mix-db-A1"]')?.textContent).toMatch(/0\.0 dB/);
  });

  it("clip / VIS / video lanes stay a shared fixed height; VOL is a 48px add-on", () => {
    mount(createEmptyProject());
    const vis = host!.querySelector('[data-testid="lane-VIS"]') as HTMLElement;
    const v1 = host!.querySelector('[data-testid="lane-V1"]') as HTMLElement;
    const v2 = host!.querySelector('[data-testid="lane-V2"]') as HTMLElement;
    const a1 = host!.querySelector('[data-testid="lane-A1"]') as HTMLElement;
    const a2 = host!.querySelector('[data-testid="lane-A2"]') as HTMLElement;
    expect(v1.style.height).toBe(v2.style.height);
    expect(v1.style.minHeight).toBe(v1.style.height);
    expect(v1.style.maxHeight).toBe(v1.style.height);
    expect(a1.style.height).toBe(a2.style.height);
    expect(a1.style.height).toBe(`${DEFAULT_LANE_HEIGHT_PX}px`);
    expect(vis.style.height).toBe(`${DEFAULT_LANE_HEIGHT_PX}px`);
    expect(host!.querySelector('[data-testid="write-arm-VIS"]')).toBeNull();
    expect(host!.querySelector('[data-testid="volume-lane-toggle-VIS"]')).toBeNull();

    const closedA1 = a1.style.height;
    const closedA2 = a2.style.height;
    const closedV1 = v1.style.height;
    mount(createEmptyProject(), { open: ["A1"] });
    const openA1 = host!.querySelector('[data-testid="lane-A1"]') as HTMLElement;
    const openA2 = host!.querySelector('[data-testid="lane-A2"]') as HTMLElement;
    const openV1 = host!.querySelector('[data-testid="lane-V1"]') as HTMLElement;
    const vol = host!.querySelector('[data-testid="volume-lane-A1"]') as HTMLElement;
    expect(openA1.style.height).toBe(closedA1);
    expect(openA2.style.height).toBe(closedA2);
    expect(openV1.style.height).toBe(closedV1);
    expect(vol.style.height).toBe(`${VOLUME_LANE_HEIGHT_PX}px`);
    expect(vol.style.minHeight).toBe(`${VOLUME_LANE_HEIGHT_PX}px`);
    expect(vol.style.maxHeight).toBe(`${VOLUME_LANE_HEIGHT_PX}px`);
    expect((host!.querySelector('[data-testid="volume-lane-label-A1"]') as HTMLElement).textContent).toMatch(/VOL/);

    mount(createEmptyProject());
    expect(host!.querySelector('[data-testid="volume-lane-A1"]')).toBeNull();
    expect((host!.querySelector('[data-testid="lane-A1"]') as HTMLElement).style.height).toBe(closedA1);
  });

  it("VOL sub-lane header packs title/close and On/dB without changing the 48px lock", () => {
    mount(createEmptyProject(), { open: ["A1"] });
    const label = host!.querySelector('[data-testid="volume-lane-label-A1"]') as HTMLElement;
    const vol = host!.querySelector('[data-testid="volume-lane-A1"]') as HTMLElement;
    expect(label.getAttribute("data-header-pack")).toBe("pack");
    expect(label.querySelector(".volume-lane-head")?.querySelector(".volume-lane-title")?.textContent).toBe("VOL");
    expect(label.querySelector(".volume-lane-head")?.querySelector(".volume-lane-close")).toBeTruthy();
    expect(label.querySelector(".volume-lane-meta")?.querySelector(".volume-lane-enable")).toBeTruthy();
    expect(label.querySelector(".volume-lane-meta")?.querySelector(".volume-lane-db")).toBeTruthy();
    expect(vol.style.height).toBe(`${VOLUME_LANE_HEIGHT_PX}px`);
    expect(label.querySelector(".volume-lane-head")?.nextElementSibling?.classList.contains("volume-lane-meta")).toBe(
      true,
    );
  });

  it("chapter group rows use a fixed height and do not stretch clip lanes", () => {
    const grouped = createTrackGroup(createEmptyProject(), { name: "Chapter I", trackIds: ["A1", "A2"] });
    mount(grouped.project);
    const header = host!.querySelector(`[data-testid="lane-group-${grouped.group!.id}"]`) as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.height).toBe(`${GROUP_LANE_HEIGHT_PX}px`);
    expect(header.style.maxHeight).toBe(`${GROUP_LANE_HEIGHT_PX}px`);
    expect((host!.querySelector('[data-testid="lane-A1"]') as HTMLElement).style.height).toBe(
      `${DEFAULT_LANE_HEIGHT_PX}px`,
    );
  });
});
