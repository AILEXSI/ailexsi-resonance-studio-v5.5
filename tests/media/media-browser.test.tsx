import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MediaBrowser } from "../../src/ui/media-browser/MediaBrowser";
import { createEmptyProject } from "../../src/core/project";
import { asset, clip } from "../helpers";

describe("MediaBrowser stills + drag", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
  });

  it("accepts image/* and marks items draggable", () => {
    const project = {
      ...createEmptyProject(),
      assets: [asset({ id: "still", kind: "image", name: "still.png", durationMs: 5000 })],
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <MediaBrowser
          project={project}
          targetTrackId="V1"
          selectedAssetId={null}
          onSelectAsset={() => undefined}
          onTargetTrack={() => undefined}
          onPlace={() => undefined}
        />,
      );
    });
    expect(host.querySelector('[data-testid="import-input-panel"]')).toBeNull();
    const item = host.querySelector('[data-testid="media-item-still"]') as HTMLElement;
    expect(item.draggable).toBe(true);
    expect(item.getAttribute("data-asset-kind")).toBe("image");
    expect(host.querySelector('[data-testid="media-search"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="media-kind-filter"]')).toBeTruthy();
  });

  it("shows Relink on a missing asset and calls existing onRelinkAsset", () => {
    const project = {
      ...createEmptyProject(),
      assets: [
        asset({ id: "gone", kind: "audio", name: "bed.mp3", missing: true }),
        asset({ id: "ok", kind: "audio", name: "ok.wav" }),
        asset({ id: "unused", kind: "audio", name: "dead.mp3", missing: true }),
      ],
      clips: [clip({ id: "c1", assetId: "gone", trackId: "A1" })],
    };
    const relinked: string[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <MediaBrowser
          project={project}
          targetTrackId="A1"
          selectedAssetId={null}
          onSelectAsset={() => undefined}
          onTargetTrack={() => undefined}
          onPlace={() => undefined}
          onRelinkAsset={(id) => relinked.push(id)}
        />,
      );
    });
    expect(host.querySelector('[data-testid="media-relink-gone"]')?.textContent).toMatch(/Relink/);
    expect(host.querySelector('[data-testid="media-relink-ok"]')).toBeNull();
    expect(host.querySelector('[data-testid="media-relink-unused"]')).toBeNull();
    act(() => {
      (host!.querySelector('[data-testid="media-relink-gone"]') as HTMLButtonElement).click();
    });
    expect(relinked).toEqual(["gone"]);
  });

  it("kind filter hides non-matching items", () => {
    const project = {
      ...createEmptyProject(),
      assets: [
        asset({ id: "still", kind: "image", name: "still.png", durationMs: 5000 }),
        asset({ id: "bed", kind: "audio", name: "bed.wav" }),
      ],
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <MediaBrowser
          project={project}
          targetTrackId="V1"
          selectedAssetId={null}
          onSelectAsset={() => undefined}
          onTargetTrack={() => undefined}
          onPlace={() => undefined}
        />,
      );
    });
    expect(host.querySelector('[data-testid="media-item-still"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="media-item-bed"]')).toBeTruthy();
    act(() => {
      (host!.querySelector('[data-testid="media-kind-audio"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="media-item-still"]')).toBeNull();
    expect(host.querySelector('[data-testid="media-item-bed"]')).toBeTruthy();
  });

  it("shows video/image posters from the timeline thumb helper; audio/missing stay empty", async () => {
    const project = {
      ...createEmptyProject(),
      assets: [
        asset({ id: "vid", kind: "video", name: "cut.mp4", objectUrl: "blob:vid", durationMs: 2000 }),
        asset({ id: "still", kind: "image", name: "still.png", objectUrl: "blob:still", durationMs: 5000 }),
        asset({ id: "bed", kind: "audio", name: "bed.wav", objectUrl: "blob:bed" }),
        asset({ id: "gone", kind: "video", name: "gone.mp4", missing: true }),
      ],
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <MediaBrowser
          project={project}
          targetTrackId="V1"
          selectedAssetId={null}
          onSelectAsset={() => undefined}
          onTargetTrack={() => undefined}
          onPlace={() => undefined}
          posterOf={async (a) =>
            a.kind === "video" || a.kind === "image" ? `data:image/png,${a.id}` : null
          }
        />,
      );
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="media-thumb-vid"]')?.getAttribute("src")).toBe(
      "data:image/png,vid",
    );
    expect(host.querySelector('[data-testid="media-thumb-still"]')?.getAttribute("src")).toBe(
      "data:image/png,still",
    );
    expect(host.querySelector('[data-testid="media-thumb-bed"]')).toBeNull();
    expect(host.querySelector('[data-testid="media-thumb-gone"]')).toBeNull();
  });
});
