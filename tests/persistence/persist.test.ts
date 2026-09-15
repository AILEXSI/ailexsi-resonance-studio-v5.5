import { describe, expect, it } from "vitest";
import {
  createIndexedDbBlobStore,
  createMemoryBlobStore,
  hydrateProject,
  persistAssetBlob,
} from "../../src/core/persistence";
import { deserializeProject, serializeProject, createEmptyProject } from "../../src/core/project";
import { DEFAULT_VISUALIZER_SCENE_ID } from "../../src/core/models";
import { placeAsset } from "../../src/core/timeline";
import { asset, clip, projectWith } from "../helpers";
import { installFakeIndexedDB } from "../helpers/fake-indexeddb";

describe("project persist + reload", () => {
  it("serializes without durable blob URLs", () => {
    const p = projectWith(
      [clip({ id: "c1", assetId: "a1", trackId: "V1", startMs: 0, durationMs: 500 })],
      [asset({ id: "a1", kind: "video", objectUrl: "blob:http://localhost/abc", missing: false })],
    );
    p.inPointMs = 100;
    p.outPointMs = 400;
    const json = serializeProject(p);
    expect(json).not.toContain("blob:http");
    const loaded = deserializeProject(json);
    expect(loaded.assets[0]!.missing).toBe(true);
    expect(loaded.assets[0]!.objectUrl).toBeUndefined();
    expect(loaded.clips[0]!.startMs).toBe(0);
    expect(loaded.clips[0]!.fadeInMs).toBe(0);
    expect(loaded.clips[0]!.fadeOutMs).toBe(0);
    expect(loaded.clips[0]!.rate).toBe(1);
    expect(loaded.clips[0]!.linkId).toBeUndefined();
    expect(loaded.inPointMs).toBe(100);
    expect(loaded.outPointMs).toBe(400);
    expect(loaded.assets[0]!.blobId).toBe("a1");
  });

  it("keeps sourcePath on serialize and still strips objectUrl", () => {
    const p = projectWith(
      [],
      [
        asset({
          id: "clip",
          kind: "video",
          objectUrl: "blob:http://localhost/clip",
          sourcePath: "C:\\Users\\marti\\clip.mp4",
          missing: false,
        }),
      ],
    );
    const json = serializeProject(p);
    expect(json).not.toContain("blob:");
    expect(json).not.toContain("objectUrl");
    expect(json).toContain("sourcePath");
    expect(json).toContain("C:\\\\Users\\\\marti\\\\clip.mp4");
    const loaded = deserializeProject(json);
    expect(loaded.assets[0]!.objectUrl).toBeUndefined();
    expect(loaded.assets[0]!.missing).toBe(true);
    expect(loaded.assets[0]!.sourcePath).toBe("C:\\Users\\marti\\clip.mp4");
  });

  it("hydrates from sourcePath only when a reader is provided and the blob is missing", async () => {
    const store = createMemoryBlobStore();
    const media = asset({
      id: "disk",
      kind: "audio",
      blobId: "disk-blob",
      missing: true,
      sourcePath: "C:\\Users\\marti\\bed.wav",
    });
    const project = projectWith([], [media]);
    const withoutReader = await hydrateProject(project, store);
    expect(withoutReader.assets[0]!.missing).toBe(true);
    expect(withoutReader.assets[0]!.objectUrl).toBeUndefined();

    const withReader = await hydrateProject(project, store, async (path) => {
      expect(path).toBe("C:\\Users\\marti\\bed.wav");
      return new Blob([new Uint8Array([4, 5, 6])], { type: "audio/wav" });
    });
    expect(withReader.assets[0]!.missing).toBe(false);
    expect(withReader.assets[0]!.objectUrl).toBeDefined();
    expect(withReader.assets[0]!.sourcePath).toBe("C:\\Users\\marti\\bed.wav");
  });

  it("hydrates blobs from the store and marks missing otherwise", async () => {
    const store = createMemoryBlobStore();
    const media = asset({ id: "keep", kind: "audio", durationMs: 900, missing: true });
    await persistAssetBlob(store, media, new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }));
    const ghost = asset({ id: "gone", kind: "video", blobId: "nope", missing: true });
    const project = projectWith([], [media, ghost]);
    const hydrated = await hydrateProject(project, store);
    expect(hydrated.assets[0]!.missing).toBe(false);
    expect(hydrated.assets[1]!.missing).toBe(true);
  });

  it("round-trips import → asset → clip → serialize → deserialize", async () => {
    const store = createMemoryBlobStore();
    const media = asset({ id: "a1", kind: "audio", durationMs: 1200 });
    await persistAssetBlob(store, media, new Blob(["wav"], { type: "audio/wav" }));
    let project = { ...createEmptyProject("Song"), assets: [media] };
    const placed = placeAsset(project, "a1", "A2", 250);
    project = placed.project;
    const again = deserializeProject(serializeProject(project));
    const hydrated = await hydrateProject(again, store);
    expect(hydrated.clips[0]!.trackId).toBe("A2");
    expect(hydrated.clips[0]!.startMs).toBe(250);
    expect(hydrated.assets[0]!.missing).toBe(false);
    expect(hydrated.visualizer.sceneId).toBe(DEFAULT_VISUALIZER_SCENE_ID);
  });

  it("serializes visualizer and restores a missing visualizer field to the documented default", () => {
    const p = createEmptyProject("Viz");
    p.visualizer = { enabled: true, muted: true, sceneId: "lita-bloom" };
    const loaded = deserializeProject(serializeProject(p));
    expect(loaded.visualizer).toEqual({
      enabled: true,
      muted: true,
      sceneId: "lita-bloom",
      startMs: 0,
      durationMs: 0,
      events: [],
      cues: [],
    });
    const raw = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    delete raw.visualizer;
    const legacy = deserializeProject(JSON.stringify(raw));
    expect(legacy.visualizer).toEqual({
      enabled: true,
      muted: false,
      sceneId: DEFAULT_VISUALIZER_SCENE_ID,
      startMs: 0,
      durationMs: 0,
      events: [],
      cues: [],
    });
  });

  it("hydrates through createIndexedDbBlobStore against an in-process IDB shim (not a browser reload)", async () => {
    const restore = installFakeIndexedDB();
    try {
      const store = createIndexedDbBlobStore();
      await store.clear();
      const media = asset({ id: "idb1", kind: "audio", durationMs: 400, missing: true });
      await persistAssetBlob(store, media, new Blob([new Uint8Array([9, 8, 7])], { type: "audio/wav" }));
      const project = projectWith([], [media]);
      project.visualizer = { enabled: true, muted: false, sceneId: "tunnel-spiral" };
      const hydrated = await hydrateProject(deserializeProject(serializeProject(project)), store);
      expect(hydrated.assets[0]!.missing).toBe(false);
      expect(hydrated.visualizer.sceneId).toBe("tunnel-spiral");
    } finally {
      restore();
    }
  });

  it("round-trips a transition and treats missing transitions as empty", () => {
    const p = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    p.transitions = [
      {
        id: "tr1",
        type: "crossfade",
        startMs: 1000,
        durationMs: 800,
        sourceAClipId: "v1",
        sourceBClipId: "v2",
        audio: "keepA",
        audioMode: "keepA",
        audioDurationMs: 400,
        source: "auto",
      },
    ];
    const loaded = deserializeProject(serializeProject(p));
    expect(loaded.transitions).toEqual(p.transitions);
    const raw = JSON.parse(serializeProject(p)) as Record<string, unknown>;
    delete raw.transitions;
    const legacy = deserializeProject(JSON.stringify(raw));
    expect(legacy.transitions).toEqual([]);
  });

  it("rejects unknown schema", () => {
    expect(() => deserializeProject(JSON.stringify({ schemaVersion: 4, id: "x", name: "old" }))).toThrow(
      /schemaVersion/,
    );
  });
});
