import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { Cutter } from "../../src/ui/cutter/Cutter";
import { tracksForScreen } from "../../src/app/screens";
import { asset, clip, projectWith } from "../helpers";
import type { TrackId } from "../../src/core/models";

const noop = () => {};
const noopMs = (_ms: number) => {};

function timelineProps(visibleTrackIds: TrackId[]) {
  const project = projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
    ],
    [
      asset({ id: "va", kind: "video", durationMs: 4000 }),
      asset({ id: "vb", kind: "video", durationMs: 4000 }),
      asset({ id: "aa", kind: "audio", durationMs: 1000 }),
    ],
  );
  return {
    project,
    visibleTrackIds,
    selectedClipId: "v1" as string | null,
    selectedClipIds: ["v1"],
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

describe("Cutter track stage", () => {
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

  it("cutter track list is V1/V2/VIS; compact strip shows the overlap", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const props = timelineProps(tracksForScreen("cutter"));
    act(() => {
      root!.render(
        <>
          <Cutter
            project={props.project}
            selectedClipId={props.selectedClipId}
            selectedClipIds={props.selectedClipIds}
            apply={() => {}}
          />
          <Timeline {...props} />
        </>,
      );
    });
    expect(host.querySelector("[data-testid=cutter]")).toBeTruthy();
    expect(host.querySelector("[data-testid=cutter-edit]")).toBeTruthy();
    expect(host.querySelector("[data-testid=timeline]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-V1]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-V2]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-VIS]")).toBeTruthy();
    expect(host.querySelector("[data-testid=lane-A1]")).toBeNull();
    expect(host.querySelector("[data-testid=lane-A2]")).toBeNull();
    expect(host.querySelector("[data-testid=vis-span]")).toBeTruthy();
  });
});
