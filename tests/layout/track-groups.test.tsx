import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { addAudioTrack } from "../../src/core/audio-tracks";
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

describe("track group collapse chrome", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  function mount(
    project: ReturnType<typeof createEmptyProject>,
    opts: {
      collapsed?: string[];
      onToggle?: (id: string) => void;
      onCreate?: (ids?: TrackId[]) => void;
      onAssign?: (ids: TrackId[], groupId: string | null) => void;
    } = {},
  ) {
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
              onAddAudioTrack={() => undefined}
              onRemoveAudioTrack={() => undefined}
              canAddAudioTrack
              canRemoveAudioTrack
              collapsedGroupIds={opts.collapsed}
              onToggleGroupCollapsed={opts.onToggle}
              onCreateTrackGroup={opts.onCreate}
              onAssignTracksToGroup={opts.onAssign}
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
              collapsedGroupIds={opts.collapsed}
              onToggleGroupCollapsed={opts.onToggle}
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
  });

  it("shows the same group in Timeline + Mixer and hides children when collapsed", () => {
    const extra = addAudioTrack(createEmptyProject()).project;
    const created = createTrackGroup(extra, {
      name: "Chapter IV — New Reality",
      trackIds: ["A1", "A2"],
    });
    const gid = created.group!.id;
    const toggled: string[] = [];
    mount(created.project, { onToggle: (id) => toggled.push(id), onCreate: () => undefined, onAssign: () => undefined });

    expect(host!.querySelector(`[data-testid="lane-group-${gid}"]`)?.textContent).toContain(
      "Chapter IV — New Reality",
    );
    expect(host!.querySelector(`[data-testid="mix-group-${gid}"]`)?.textContent).toContain(
      "Chapter IV — New Reality",
    );
    expect(host!.querySelector('[data-testid="lane-A1"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="mix-A1"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="lane-A2"]')).toBeTruthy();
    expect(
      host!.querySelector('[data-testid="create-track-group"]') ??
        document.querySelector('[data-testid="create-track-group"]'),
    ).toBeTruthy();
    expect(
      host!.querySelector('[data-testid="add-audio-track"]') ??
        document.querySelector('[data-testid="add-audio-track"]'),
    ).toBeTruthy();

    act(() => {
      (host!.querySelector(`[data-testid="lane-group-collapse-${gid}"]`) as HTMLButtonElement).click();
    });
    expect(toggled).toEqual([gid]);

    act(() => {
      root!.render(
        <div className="lower-stage" style={{ height: 280 }}>
          <div className="arrange-row">
            <Timeline
              project={created.project}
              {...timelineNoops()}
              onAddAudioTrack={() => undefined}
              canAddAudioTrack
              canRemoveAudioTrack
              collapsedGroupIds={[gid]}
              onToggleGroupCollapsed={() => undefined}
              onCreateTrackGroup={() => undefined}
              onAssignTracksToGroup={() => undefined}
            />
            <Mixer
              project={created.project}
              selectedTrackId="A1"
              peaks={silentPeaks}
              onSelectTrack={noop}
              onVolume={noop}
              onMasterVolume={noop}
              onToggleMute={noop}
              onToggleSolo={noop}
              collapsedGroupIds={[gid]}
              onToggleGroupCollapsed={() => undefined}
            />
          </div>
        </div>,
      );
    });

    expect(host!.querySelector('[data-testid="lane-A1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="lane-A2"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mix-A1"]')).toBeNull();
    expect(host!.querySelector('[data-testid="mix-A2"]')).toBeNull();
    expect(host!.querySelector(`[data-testid="lane-group-${gid}"]`)).toBeTruthy();
    expect(host!.querySelector(`[data-testid="mix-group-${gid}"]`)).toBeTruthy();
    expect(
      host!.querySelector('[data-testid="lane-A2"]')
        ? true
        : host!.querySelector('[data-testid="add-audio-track"]') ??
            document.querySelector('[data-testid="add-audio-track"]'),
    ).toBeTruthy();
    const extraLane = extra.tracks.find((t) => t.kind === "audio" && t.id !== "A1" && t.id !== "A2")!;
    expect(host!.querySelector(`[data-testid="lane-${extraLane.id}"]`)).toBeTruthy();
  });
});
