import { describe, expect, it } from "vitest";
import { displayMediaName, filterMediaAssets, trackLabelFromFilename } from "../../src/core/media-display";
import { asset } from "../helpers";

describe("MEDIA display names", () => {
  it("shortens UUID-looking filenames and keeps the extension", () => {
    const raw = "a1b2c3d4-e5f6-7890-abcd-ef1234567890.mp4";
    expect(displayMediaName(raw)).toBe("a1b2c3….mp4");
    expect(displayMediaName(raw)).not.toBe(raw);
  });

  it("leaves short human names alone", () => {
    expect(displayMediaName("kick.wav")).toBe("kick.wav");
  });

  it("builds a short track label from a stem filename", () => {
    expect(trackLabelFromFilename("vocals.wav")).toBe("vocals");
    expect(trackLabelFromFilename("01_A Signal in the Dark_drums.wav")).toBe("01_A Signal in th…");
    expect(trackLabelFromFilename("folder/bass.mp3")).toBe("bass");
  });

  it("does not rewrite the original string used as a tooltip", () => {
    const disk = "asset_9c3e2b10-1111-2222-3333-444455556666.mp4";
    const shown = displayMediaName(disk);
    expect(shown.length).toBeLessThan(disk.length);
    expect(disk.endsWith(".mp4")).toBe(true);
    expect(shown.endsWith(".mp4")).toBe(true);
  });
});

describe("media bin filter", () => {
  const assets = [
    asset({ id: "v", kind: "video", name: "take-A.mp4" }),
    asset({ id: "a", kind: "audio", name: "kick.wav" }),
    asset({ id: "i", kind: "image", name: "poster.png", durationMs: 5000 }),
  ];

  it("empty query + all shows every asset", () => {
    expect(filterMediaAssets(assets, { query: "  ", kind: "all" }).map((a) => a.id)).toEqual([
      "v",
      "a",
      "i",
    ]);
  });

  it("filters by name substring and kind", () => {
    expect(filterMediaAssets(assets, { query: "kick" }).map((a) => a.id)).toEqual(["a"]);
    expect(filterMediaAssets(assets, { query: "png", kind: "image" }).map((a) => a.id)).toEqual(["i"]);
    expect(filterMediaAssets(assets, { kind: "video" }).map((a) => a.id)).toEqual(["v"]);
    expect(filterMediaAssets(assets, { query: "nope" })).toEqual([]);
  });
});
