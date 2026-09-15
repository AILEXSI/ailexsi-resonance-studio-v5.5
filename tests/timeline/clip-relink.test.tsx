import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { asset, clip, projectWith } from "../helpers";
import type { TrackId } from "../../src/core/models";

describe("missing clip Relink (P60)", () => {
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

  it("shows Relink on a missing clip and calls existing onRelink with that clip", () => {
    const project = projectWith(
      [
        clip({ id: "gone", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "ok", assetId: "vb", trackId: "V1", startMs: 2000, durationMs: 1000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000, missing: true }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    const relinked: string[][] = [];
    const noop = () => {};
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Timeline
          project={project}
          selectedClipId="gone"
          onSelect={() => {}}
          onPlayhead={noop}
          onMoveLive={noop}
          onMoveCommit={noop}
          onTrimLive={noop}
          onTrimCommit={noop}
          onToggleMute={(_id: TrackId) => {}}
          onToggleVisualizerMute={noop}
          onCycleVisualizerScene={noop}
          onSplitHere={noop}
          onCut={noop}
          onCopy={noop}
          onPaste={noop}
          onDelete={noop}
          onZoom={noop}
          onFit={noop}
          onScroll={noop}
          onLoopClick={noop}
          onLoopInLive={noop}
          onLoopOutLive={noop}
          onLoopMoveLive={noop}
          onLoopCommit={noop}
          onRelink={(ids) => {
            relinked.push([...(ids ?? [])]);
          }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="clip-gone"]')?.className).toContain("missing");
    expect(host.querySelector('[data-testid="clip-relink-gone"]')?.textContent).toMatch(/Relink/);
    expect(host.querySelector('[data-testid="clip-relink-ok"]')).toBeNull();
    act(() => {
      (host!.querySelector('[data-testid="clip-relink-gone"]') as HTMLButtonElement).click();
    });
    expect(relinked).toEqual([["gone"]]);
  });
});
