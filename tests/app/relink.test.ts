import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, ingestRelinkFile, type Session } from "../../src/app/session";
import { relinkClipsOnProject, relinkSelectionForAsset, relinkSelectionOf } from "../../src/core/relink";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function fakeFile(name: string, type: string, size = 128): File {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

function probeMs(file: File) {
  const m = file.name.match(/(\d+)ms/);
  return Promise.resolve({ durationMs: m ? Number(m[1]) : 4000 });
}

function linkedAvRelinkSession(): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 2000, missing: true, hasAudio: true });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith(
      [
        clip({
          id: "v1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
        }),
        clip({
          id: "a1",
          assetId: "va",
          trackId: "A1",
          startMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
          linkId: "lnk1",
        }),
      ],
      [va],
    ),
    selectedClipId: "v1",
    selectedClipIds: ["v1"],
  };
}

function relinkSession(): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 4000, missing: true });
  const vb = asset({ id: "vb", kind: "video", durationMs: 4000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith(
      [
        clip({
          id: "c1",
          assetId: "va",
          trackId: "V1",
          startMs: 250,
          durationMs: 2000,
          sourceInMs: 0,
          sourceOutMs: 2000,
        }),
        clip({
          id: "c2",
          assetId: "va",
          trackId: "V2",
          startMs: 800,
          durationMs: 1500,
          sourceInMs: 100,
          sourceOutMs: 1600,
        }),
        clip({
          id: "c3",
          assetId: "vb",
          trackId: "V1",
          startMs: 0,
          durationMs: 400,
          sourceInMs: 0,
          sourceOutMs: 400,
        }),
      ],
      [va, vb],
    ),
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
  };
}

describe("relinkSelectionForAsset (P59)", () => {
  it("returns every clip that shares the missing asset", () => {
    const start = relinkSession();
    const sel = relinkSelectionForAsset(start.project, "va");
    expect(sel?.kind).toBe("video");
    expect(sel?.assetId).toBe("va");
    expect(sel?.clipIds.sort()).toEqual(["c1", "c2"]);
    expect(relinkSelectionForAsset(start.project, "vb")?.clipIds).toEqual(["c3"]);
    expect(relinkSelectionForAsset(start.project, "nope")).toBeNull();
    const unused = {
      ...start.project,
      assets: [...start.project.assets, asset({ id: "ghost", kind: "video", missing: true })],
    };
    expect(relinkSelectionForAsset(unused, "ghost")).toBeNull();
  });
});

describe("relinkClips", () => {
  it("relinks one clip: assetId changes, startMs unchanged, missing false", async () => {
    const start = relinkSession();
    const ingested = await ingestRelinkFile(start, fakeFile("new-3000ms.mp4", "video/mp4"), "video", probeMs);
    expect("assetId" in ingested).toBe(true);
    if (!("assetId" in ingested)) return;
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["c1"],
      assetId: ingested.assetId,
    });
    const clip1 = next.project.clips.find((c) => c.id === "c1")!;
    const asset = next.project.assets.find((a) => a.id === ingested.assetId)!;
    expect(clip1.assetId).toBe(ingested.assetId);
    expect(clip1.assetId).not.toBe("va");
    expect(clip1.startMs).toBe(250);
    expect(clip1.durationMs).toBe(2000);
    expect(clip1.sourceOutMs).toBe(2000);
    expect(asset.missing).toBe(false);
    expect(next.project.assets.some((a) => a.id === "va")).toBe(true);
    expect(next.status).toBe("Relinked clip");
  });

  it("updates two clips that share an assetId and leaves a third alone", async () => {
    const start = { ...relinkSession(), selectedClipIds: ["c1", "c2"], selectedClipId: "c1" };
    const ingested = await ingestRelinkFile(start, fakeFile("pair-3000ms.mp4", "video/mp4"), "video", probeMs);
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["c1", "c2"],
      assetId: ingested.assetId,
    });
    expect(next.project.clips.find((c) => c.id === "c1")!.assetId).toBe(ingested.assetId);
    expect(next.project.clips.find((c) => c.id === "c2")!.assetId).toBe(ingested.assetId);
    expect(next.project.clips.find((c) => c.id === "c3")!.assetId).toBe("vb");
    expect(next.project.clips.find((c) => c.id === "c1")!.startMs).toBe(250);
    expect(next.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
    expect(next.status).toBe("Relinked clips");
  });

  it("mixed selection is a no-op", () => {
    const start = relinkSession();
    const past = start.history.past.length;
    const next = applyCommand(start, { type: "relinkClips", clipIds: ["c1", "c3"], assetId: "vb" });
    expect(next).toBe(start);
    expect(next.history.past.length).toBe(past);
    expect(next.project.clips.find((c) => c.id === "c1")!.assetId).toBe("va");
  });

  it("clamps sourceOut and duration when the new file is shorter, startMs unchanged", async () => {
    const start = relinkSession();
    const ingested = await ingestRelinkFile(start, fakeFile("short-800ms.mp4", "video/mp4"), "video", probeMs);
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["c1"],
      assetId: ingested.assetId,
    });
    const clip1 = next.project.clips.find((c) => c.id === "c1")!;
    expect(clip1.startMs).toBe(250);
    expect(clip1.sourceOutMs).toBe(800);
    expect(clip1.sourceInMs).toBe(0);
    expect(clip1.durationMs).toBe(800);
  });

  it("refuses a trimmed clip whose sourceIn is past the new file (P130)", () => {
    const start = relinkSession();
    const short = asset({ id: "short", kind: "video", durationMs: 800 });
    const project = {
      ...start.project,
      assets: [...start.project.assets, short],
      clips: start.project.clips.map((c) =>
        c.id === "c1" ? { ...c, sourceInMs: 1500, sourceOutMs: 2000, durationMs: 500 } : c,
      ),
    };
    const result = relinkClipsOnProject(project, ["c1"], "short");
    expect(result).toEqual({ error: "Relink would empty the clip" });
    expect(project.clips.find((c) => c.id === "c1")!.assetId).toBe("va");
    expect(project.clips.find((c) => c.id === "c1")!.durationMs).toBe(500);
    expect(project.clips.find((c) => c.id === "c1")!.sourceInMs).toBe(1500);
  });

  it("still relinks an unlocked mate when only the trimmed clip would empty (P130)", () => {
    const start = linkedAvRelinkSession();
    const short = asset({ id: "short", kind: "video", durationMs: 800 });
    const project = {
      ...start.project,
      assets: [...start.project.assets, short],
      clips: start.project.clips.map((c) =>
        c.id === "v1" ? { ...c, sourceInMs: 1500, sourceOutMs: 2000, durationMs: 500 } : c,
      ),
    };
    const result = relinkClipsOnProject(project, ["v1"], "short");
    expect("project" in result).toBe(true);
    if (!("project" in result)) return;
    const v1 = result.project.clips.find((c) => c.id === "v1")!;
    const a1 = result.project.clips.find((c) => c.id === "a1")!;
    expect(v1.assetId).toBe("va");
    expect(v1.durationMs).toBe(500);
    expect(v1.sourceInMs).toBe(1500);
    expect(a1.assetId).toBe("short");
    expect(a1.sourceOutMs).toBe(800);
    expect(a1.durationMs).toBe(800);
    expect(a1.startMs).toBe(0);
  });

  it("rejects the wrong kind in the ingest helper and does not call the command", async () => {
    const start = relinkSession();
    const rejected = await ingestRelinkFile(start, fakeFile("nope.wav", "audio/wav"), "video", probeMs);
    expect(rejected).toEqual({ error: "Relink rejected: expected video, got audio" });
    expect(start.project.assets).toHaveLength(2);
    expect(start.project.clips.find((c) => c.id === "c1")!.assetId).toBe("va");
  });

  it("linked A/V: relink video selection remaps living same-asset audio (P63)", async () => {
    const start = linkedAvRelinkSession();
    expect(relinkSelectionOf(start.project, ["v1"])?.clipIds.sort()).toEqual(["a1", "v1"]);
    const ingested = await ingestRelinkFile(start, fakeFile("pair-3000ms.mp4", "video/mp4"), "video", probeMs);
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["v1"],
      assetId: ingested.assetId,
    });
    const v1 = next.project.clips.find((c) => c.id === "v1")!;
    const a1 = next.project.clips.find((c) => c.id === "a1")!;
    expect(v1.assetId).toBe(ingested.assetId);
    expect(a1.assetId).toBe(ingested.assetId);
    expect(v1.startMs).toBe(0);
    expect(a1.startMs).toBe(0);
    expect(v1.durationMs).toBe(2000);
    expect(a1.durationMs).toBe(2000);
    expect(next.status).toBe("Relinked clips");
  });

  it("linked A/V: relink of a disabled clip does not remap a living mate (P152)", () => {
    const start = linkedAvRelinkSession();
    const short = asset({ id: "short", kind: "video", durationMs: 800 });
    const project = {
      ...start.project,
      assets: [...start.project.assets, short],
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, enabled: false } : c)),
    };
    expect(relinkSelectionOf(project, ["v1"])?.clipIds).toEqual(["v1"]);
    const result = relinkClipsOnProject(project, ["v1"], "short");
    expect("project" in result).toBe(true);
    if (!("project" in result)) return;
    const v1 = result.project.clips.find((c) => c.id === "v1")!;
    const a1 = result.project.clips.find((c) => c.id === "a1")!;
    expect(v1.assetId).toBe("short");
    expect(v1.enabled).toBe(false);
    expect(v1.sourceOutMs).toBe(800);
    expect(v1.durationMs).toBe(800);
    expect(a1.assetId).toBe("va");
    expect(a1.durationMs).toBe(2000);
    expect(a1.sourceOutMs).toBe(2000);
    expect(a1.startMs).toBe(0);
  });

  it("linked A/V: relink audio selection remaps living same-asset video (P63)", async () => {
    const start = { ...linkedAvRelinkSession(), selectedClipId: "a1", selectedClipIds: ["a1"] };
    expect(relinkSelectionOf(start.project, ["a1"])?.clipIds.sort()).toEqual(["a1", "v1"]);
    const ingested = await ingestRelinkFile(start, fakeFile("pair-3000ms.mp4", "video/mp4"), "video", probeMs);
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["a1"],
      assetId: ingested.assetId,
    });
    expect(next.project.clips.find((c) => c.id === "v1")!.assetId).toBe(ingested.assetId);
    expect(next.project.clips.find((c) => c.id === "a1")!.assetId).toBe(ingested.assetId);
    expect(next.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
  });

  it("linked A/V: shorter replacement clamps both mates; startMs unchanged (P63)", async () => {
    const start = linkedAvRelinkSession();
    const ingested = await ingestRelinkFile(start, fakeFile("short-800ms.mp4", "video/mp4"), "video", probeMs);
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["v1"],
      assetId: ingested.assetId,
    });
    const v1 = next.project.clips.find((c) => c.id === "v1")!;
    const a1 = next.project.clips.find((c) => c.id === "a1")!;
    expect(v1.assetId).toBe(ingested.assetId);
    expect(a1.assetId).toBe(ingested.assetId);
    expect(v1.startMs).toBe(0);
    expect(a1.startMs).toBe(0);
    expect(v1.sourceOutMs).toBe(800);
    expect(a1.sourceOutMs).toBe(800);
    expect(v1.durationMs).toBe(800);
    expect(a1.durationMs).toBe(800);
  });

  it("does not shrink a locked clip when the replacement is shorter (P127)", () => {
    const start = linkedAvRelinkSession();
    const short = asset({ id: "short", kind: "video", durationMs: 800 });
    const project = {
      ...start.project,
      assets: [...start.project.assets, short],
      clips: start.project.clips.map((c) => (c.id === "v1" ? { ...c, locked: true } : c)),
    };
    const result = relinkClipsOnProject(project, ["v1"], "short");
    expect("project" in result).toBe(true);
    if (!("project" in result)) return;
    const v1 = result.project.clips.find((c) => c.id === "v1")!;
    const a1 = result.project.clips.find((c) => c.id === "a1")!;
    expect(v1.assetId).toBe("va");
    expect(v1.durationMs).toBe(2000);
    expect(v1.sourceOutMs).toBe(2000);
    expect(v1.startMs).toBe(0);
    expect(v1.locked).toBe(true);
    expect(a1.assetId).toBe("short");
    expect(a1.durationMs).toBe(800);
    expect(a1.sourceOutMs).toBe(800);
    expect(a1.startMs).toBe(0);
  });

  it("refuses when every clip that would shrink is locked (P127)", async () => {
    const start = relinkSession();
    const locked = applyCommand(start, { type: "setClipsLocked", locked: true });
    const ingested = await ingestRelinkFile(
      locked,
      fakeFile("short-800ms.mp4", "video/mp4"),
      "video",
      probeMs,
    );
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["c1"],
      assetId: ingested.assetId,
    });
    expect(next.error).toBe("Clip is locked");
    expect(next.status).toBe("Relink failed");
    const c1 = next.project.clips.find((c) => c.id === "c1")!;
    expect(c1.assetId).toBe("va");
    expect(c1.durationMs).toBe(2000);
    expect(c1.sourceOutMs).toBe(2000);
    expect(c1.startMs).toBe(250);
    expect(next.history.past.length).toBe(ingested.session.history.past.length);
  });

  it("still remaps a locked clip when the replacement is long enough (P127)", () => {
    const start = relinkSession();
    const long = asset({ id: "long", kind: "video", durationMs: 4000 });
    const project = {
      ...start.project,
      assets: [...start.project.assets, long],
      clips: start.project.clips.map((c) => (c.id === "c1" ? { ...c, locked: true } : c)),
    };
    const result = relinkClipsOnProject(project, ["c1"], "long");
    expect("project" in result).toBe(true);
    if (!("project" in result)) return;
    const c1 = result.project.clips.find((c) => c.id === "c1")!;
    expect(c1.assetId).toBe("long");
    expect(c1.durationMs).toBe(2000);
    expect(c1.sourceOutMs).toBe(2000);
    expect(c1.startMs).toBe(250);
    expect(c1.locked).toBe(true);
  });

  it("unlinked same-asset mate is not auto-included (P63)", async () => {
    const start = linkedAvRelinkSession();
    const unlinked = applyCommand(start, { type: "unlinkClips", clipId: "v1" });
    expect(relinkSelectionOf(unlinked.project, ["v1"])?.clipIds).toEqual(["v1"]);
    const ingested = await ingestRelinkFile(unlinked, fakeFile("solo-3000ms.mp4", "video/mp4"), "video", probeMs);
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const next = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["v1"],
      assetId: ingested.assetId,
    });
    expect(next.project.clips.find((c) => c.id === "v1")!.assetId).toBe(ingested.assetId);
    expect(next.project.clips.find((c) => c.id === "a1")!.assetId).toBe("va");
  });

  it("living mate with a different assetId is not pulled in (P63)", () => {
    const start = linkedAvRelinkSession();
    const aa = asset({ id: "aa", kind: "audio", durationMs: 2000 });
    const project = {
      ...start.project,
      assets: [...start.project.assets, aa],
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, assetId: "aa" } : c)),
    };
    expect(relinkSelectionOf(project, ["v1"])?.clipIds).toEqual(["v1"]);
    expect(relinkSelectionOf(project, ["a1"])?.clipIds).toEqual(["a1"]);
    expect(relinkSelectionOf(project, ["v1"])?.kind).toBe("video");
    expect(relinkSelectionOf(project, ["a1"])?.kind).toBe("audio");
  });

  it("undo restores previous assetId and source window", async () => {
    const start = relinkSession();
    const ingested = await ingestRelinkFile(start, fakeFile("short-800ms.mp4", "video/mp4"), "video", probeMs);
    if (!("assetId" in ingested)) throw new Error("ingest failed");
    const relinked = applyCommand(ingested.session, {
      type: "relinkClips",
      clipIds: ["c1"],
      assetId: ingested.assetId,
    });
    expect(relinked.project.clips.find((c) => c.id === "c1")!.sourceOutMs).toBe(800);
    const undone = applyCommand(relinked, { type: "undo" });
    const clip1 = undone.project.clips.find((c) => c.id === "c1")!;
    expect(clip1.assetId).toBe("va");
    expect(clip1.sourceOutMs).toBe(2000);
    expect(clip1.durationMs).toBe(2000);
    expect(clip1.startMs).toBe(250);
  });
});
