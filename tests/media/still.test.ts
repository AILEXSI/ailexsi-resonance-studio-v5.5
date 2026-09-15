import { describe, expect, it } from "vitest";
import { applyPlaceAsset, createSession } from "../../src/app/session";
import {
  classifyFile,
  importMediaFile,
  ImportError,
  mediaDropPlace,
  preferredTrackForAsset,
  readAssetDrag,
  writeAssetDrag,
} from "../../src/core/media";
import { DEFAULT_IMAGE_DURATION_MS } from "../../src/core/still";
import { filmstripTimes } from "../../src/core/clip-preview";
import { clipEndMs } from "../../src/core/models";
import { createMemoryBlobStore, hydrateProject, persistAssetBlob } from "../../src/core/persistence";
import { createEmptyProject, deserializeProject, serializeProject } from "../../src/core/project";
import { placeAsset } from "../../src/core/timeline";
import { compositeVideoAt, contextFromProject, resolvePictureSource } from "../../src/core/transition";
import { jobFromProject } from "../../src/core/exporter/job";
import { asset, clip, projectWith } from "../helpers";

function fakeFile(name: string, type: string, size = 128): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("still images (P41)", () => {
  it("classifies png and jpg; rejects pdf", () => {
    expect(classifyFile(fakeFile("photo.png", "image/png"))).toBe("image");
    expect(classifyFile(fakeFile("shot.jpg", "image/jpeg"))).toBe("image");
    expect(classifyFile(fakeFile("shot.jpeg", "image/jpeg"))).toBe("image");
    expect(classifyFile(fakeFile("tile.webp", "image/webp"))).toBe("image");
    expect(classifyFile(fakeFile("loop.gif", "image/gif"))).toBe("image");
    expect(classifyFile(fakeFile("no-mime.png", ""))).toBe("image");
    expect(() => classifyFile(fakeFile("brief.pdf", "application/pdf"))).toThrowError(ImportError);
    expect(() => classifyFile(fakeFile("notes.txt", "text/plain"))).toThrowError(ImportError);
  });

  it("imports an image asset with duration 5000 and places on V1", async () => {
    const file = fakeFile("still.png", "image/png");
    const media = await importMediaFile(file, async () => ({
      durationMs: 0,
      width: 64,
      height: 48,
    }));
    expect(media.kind).toBe("image");
    expect(media.durationMs).toBe(DEFAULT_IMAGE_DURATION_MS);
    expect(media.durationMs).toBe(5000);
    expect(media.width).toBe(64);
    expect(media.height).toBe(48);
    expect(media.hasAudio).toBeUndefined();
    const placed = placeAsset({ ...createEmptyProject(), assets: [media] }, media.id, "V1", 0);
    expect(placed.error).toBeUndefined();
    expect(placed.clip?.trackId).toBe("V1");
    expect(placed.clip?.durationMs).toBe(5000);
    expect(placed.clip?.sourceOutMs).toBe(5000);
    expect(placed.audioClip).toBeUndefined();
    expect(preferredTrackForAsset("image", "A1")).toBe("V1");
    expect(preferredTrackForAsset("image", "V2")).toBe("V2");
  });

  it("refuses placing an image on an audio track", async () => {
    const media = await importMediaFile(fakeFile("still.png", "image/png"), async () => ({
      durationMs: 5000,
      width: 16,
      height: 16,
    }));
    const result = placeAsset({ ...createEmptyProject(), assets: [media] }, media.id, "A1");
    expect(result.error).toMatch(/cannot go on A1/);
  });

  it("video/audio place regression still holds", async () => {
    const video = await importMediaFile(fakeFile("clip.mp4", "video/mp4"), async () => ({
      durationMs: 2000,
      width: 16,
      height: 16,
    }));
    const audio = await importMediaFile(fakeFile("bed.wav", "audio/wav"), async () => ({
      durationMs: 900,
    }));
    expect(video.kind).toBe("video");
    expect(audio.kind).toBe("audio");
    const v1 = placeAsset({ ...createEmptyProject(), assets: [video, audio] }, video.id, "V1");
    expect(v1.error).toBeUndefined();
    const a1 = placeAsset(v1.project, audio.id, "A1");
    expect(a1.error).toBeUndefined();
    expect(placeAsset(a1.project, video.id, "A2").error).toMatch(/cannot go on A2/);
    expect(placeAsset(a1.project, audio.id, "V2").error).toMatch(/cannot go on V2/);
  });

  it("compositor at t inside a still returns that clip", async () => {
    const media = asset({
      id: "still",
      kind: "image",
      durationMs: 5000,
      width: 64,
      height: 48,
    });
    const p = projectWith(
      [clip({ id: "s1", assetId: "still", trackId: "V1", startMs: 0, durationMs: 5000 })],
      [media],
    );
    const ctx = contextFromProject(p);
    expect(resolvePictureSource(ctx, 2500)).toEqual({
      source: "auto",
      kind: "V1",
      clipId: "s1",
    });
    expect(compositeVideoAt(ctx, 2500).layers).toEqual([{ clipId: "s1", alpha: 1 }]);
    expect(compositeVideoAt(ctx, 6000).layers).toEqual([]);
    const job = jobFromProject(p);
    const stillClip = job.tracks.find((t) => t.id === "V1")?.clips[0];
    expect(stillClip?.still).toBe(true);
  });

  it("persist reload keeps image kind and 5000ms duration", async () => {
    const store = createMemoryBlobStore();
    const media = asset({
      id: "still",
      kind: "image",
      durationMs: 5000,
      mimeType: "image/png",
      width: 32,
      height: 24,
    });
    await persistAssetBlob(store, media, new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    let project = { ...createEmptyProject("Stills"), assets: [media] };
    const placed = placeAsset(project, "still", "V1", 100);
    project = placed.project;
    const json = serializeProject(project);
    expect(json).toContain('"kind": "image"');
    const again = deserializeProject(json);
    expect(again.assets[0]!.kind).toBe("image");
    expect(again.assets[0]!.durationMs).toBe(5000);
    expect(again.clips[0]!.trackId).toBe("V1");
    expect(again.clips[0]!.startMs).toBe(100);
    expect(again.clips[0]!.durationMs).toBe(5000);
    const hydrated = await hydrateProject(again, store);
    expect(hydrated.assets[0]!.missing).toBe(false);
    expect(hydrated.assets[0]!.kind).toBe("image");
  });

  it("drag/drop handler places image on a video lane and audio on an audio lane", () => {
    const image = mediaDropPlace({
      assetId: "still",
      assetKind: "image",
      overTrackId: "V1",
      startMs: 1234.6,
    });
    expect(image).toEqual({ assetId: "still", trackId: "V1", startMs: 1235 });
    expect(mediaDropPlace({ assetId: "still", assetKind: "image", overTrackId: "A1", startMs: 0 })).toBeUndefined();
    expect(
      mediaDropPlace({ assetId: "vid", assetKind: "video", overTrackId: "V2", startMs: 0 }),
    ).toEqual({ assetId: "vid", trackId: "V2", startMs: 0 });
    expect(
      mediaDropPlace({ assetId: "wav", assetKind: "audio", overTrackId: "A2", startMs: 400 }),
    ).toEqual({ assetId: "wav", trackId: "A2", startMs: 400 });
    expect(
      mediaDropPlace({ assetId: "wav", assetKind: "audio", overTrackId: "V1", startMs: 0 }),
    ).toBeUndefined();

    const bag = new Map<string, string>();
    const types: string[] = [];
    const dt = {
      types,
      effectAllowed: "none",
      setData(type: string, value: string) {
        bag.set(type, value);
        if (!types.includes(type)) types.push(type);
      },
      getData(type: string) {
        return bag.get(type) ?? "";
      },
    } as unknown as DataTransfer;
    writeAssetDrag(dt, "still");
    expect(readAssetDrag(dt)).toBe("still");

    const session = createSession(createMemoryBlobStore());
    session.project = projectWith(
      [],
      [asset({ id: "still", kind: "image", durationMs: 5000 })],
    );
    const drop = mediaDropPlace({
      assetId: "still",
      assetKind: "image",
      overTrackId: "V2",
      startMs: 800,
    })!;
    const next = applyPlaceAsset(session, drop.assetId, drop.trackId, drop.startMs);
    expect(next.error).toBeNull();
    expect(next.project.clips[0]!.trackId).toBe("V2");
    expect(next.project.clips[0]!.startMs).toBe(800);
    expect(next.project.clips[0]!.durationMs).toBe(5000);
    expect(clipEndMs(next.project.clips[0]!)).toBe(5800);
    expect(next.project.playheadMs).toBe(800);
  });

  it("parks playhead on bin-drop place so preview is not empty (P83)", () => {
    const session = createSession(createMemoryBlobStore());
    session.project = {
      ...projectWith([], [asset({ id: "still", kind: "image", durationMs: 5000 })]),
      playheadMs: 5000,
    };
    const placed = applyPlaceAsset(session, "still", "V1", 800);
    expect(placed.error).toBeNull();
    expect(placed.project.clips[0]!.startMs).toBe(800);
    expect(placed.project.playheadMs).toBe(800);

    const atHead = applyPlaceAsset(placed, "still", "V2");
    expect(atHead.project.clips[1]!.startMs).toBe(800);
    expect(atHead.project.playheadMs).toBe(800);

    const failed = applyPlaceAsset(
      { ...session, project: { ...session.project, playheadMs: 5000 } },
      "still",
      "A1",
      1200,
    );
    expect(failed.error).toMatch(/cannot go on A1/);
    expect(failed.project.playheadMs).toBe(5000);
    expect(failed.project.clips).toHaveLength(0);
  });

  it("snaps bin-drop place to existing clip edges when snap is on (P84)", () => {
    const session = createSession(createMemoryBlobStore());
    session.project = {
      ...projectWith(
        [clip({ id: "old", assetId: "still", trackId: "V1", startMs: 0, durationMs: 2000 })],
        [asset({ id: "still", kind: "image", durationMs: 5000 })],
      ),
      playheadMs: 9000,
      snap: true,
    };
    const snapped = applyPlaceAsset(session, "still", "V2", 2070);
    expect(snapped.project.clips.find((c) => c.id !== "old")!.startMs).toBe(2000);
    expect(snapped.project.playheadMs).toBe(2000);

    const off = applyPlaceAsset(
      { ...session, project: { ...session.project, snap: false } },
      "still",
      "V2",
      2070,
    );
    expect(off.project.clips.find((c) => c.id !== "old")!.startMs).toBe(2070);
    expect(off.project.playheadMs).toBe(2070);
  });

  it("bin place-at-playhead snaps like paste; drop-at-click stays P84 (P97)", () => {
    const session = createSession(createMemoryBlobStore());
    session.project = {
      ...projectWith(
        [clip({ id: "old", assetId: "still", trackId: "V1", startMs: 0, durationMs: 2000 })],
        [asset({ id: "still", kind: "image", durationMs: 5000 })],
      ),
      playheadMs: 2070,
      snap: true,
    };
    const atHead = applyPlaceAsset(session, "still", "V2");
    expect(atHead.project.clips.find((c) => c.id !== "old")!.startMs).toBe(2000);
    expect(atHead.project.playheadMs).toBe(2000);

    const drop = applyPlaceAsset(
      { ...session, project: { ...session.project, playheadMs: 9000 } },
      "still",
      "V2",
      2070,
    );
    expect(drop.project.clips.find((c) => c.id !== "old")!.startMs).toBe(2000);

    const off = applyPlaceAsset(
      { ...session, project: { ...session.project, snap: false } },
      "still",
      "V2",
    );
    expect(off.project.clips.find((c) => c.id !== "old")!.startMs).toBe(2070);
    expect(off.project.playheadMs).toBe(2070);
  });

  it("filmstrip for a still is one thumb, not a video strip", () => {
    const times = filmstripTimes({
      sourceInMs: 0,
      sourceOutMs: 5000,
      clipWidthPx: 240,
      thumbWidthPx: 48,
      kind: "image",
    });
    expect(times).toEqual([0]);
    expect(
      filmstripTimes({
        sourceInMs: 0,
        sourceOutMs: 10_000,
        clipWidthPx: 240,
        thumbWidthPx: 48,
      }),
    ).toHaveLength(5);
  });
});
