import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function oneClipSession(): Session {
  const va = asset({ id: "va", kind: "video", durationMs: 8000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: {
      ...projectWith(
        [clip({ id: "c1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 })],
        [va],
      ),
      playheadMs: 2500,
    },
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
  };
}

describe("duplicate", () => {
  it("is registered on applyCommand and clones one clip at the playhead with a new id", () => {
    const start = oneClipSession();
    const next = applyCommand(start, { type: "duplicate" });
    expect(next.project.clips).toHaveLength(2);
    const original = next.project.clips.find((c) => c.id === "c1")!;
    const clone = next.project.clips.find((c) => c.id !== "c1")!;
    expect(original.startMs).toBe(0);
    expect(clone.id).not.toBe("c1");
    expect(clone.startMs).toBe(2500);
    expect(clone.durationMs).toBe(1000);
    expect(clone.trackId).toBe("V1");
    expect(clone.assetId).toBe("va");
    expect(next.selectedClipId).toBe(clone.id);
    expect(next.selectedClipIds).toEqual([clone.id]);
    expect(next.clipboard).toEqual(start.clipboard);
    expect(next.status).toBe("Duplicated clip");
    expect(next.history.past.length).toBe(start.history.past.length + 1);
  });

  it("keeps relative offset for a two-clip block", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 500 }),
            clip({ id: "b", assetId: "va", trackId: "V1", startMs: 800, durationMs: 500 }),
          ],
          [va],
        ),
        playheadMs: 3000,
      },
      selectedClipId: "a",
      selectedClipIds: ["a", "b"],
    };
    const next = applyCommand(start, { type: "duplicate" });
    expect(next.project.clips).toHaveLength(4);
    const clones = next.project.clips.filter((c) => c.id !== "a" && c.id !== "b");
    expect(clones).toHaveLength(2);
    const starts = clones.map((c) => c.startMs).sort((x, y) => x - y);
    expect(starts).toEqual([3000, 3800]);
    expect(next.selectedClipIds).toEqual(clones.map((c) => c.id));
    expect(next.project.clips.find((c) => c.id === "a")!.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "b")!.startMs).toBe(800);
  });

  it("remaps linkId on a linked A/V pair and leaves the originals linked", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 8000 });
    const aa = asset({ id: "aa", kind: "audio", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "v1",
              assetId: "va",
              trackId: "V1",
              startMs: 0,
              durationMs: 1000,
              linkId: "pair-1",
            }),
            clip({
              id: "a1",
              assetId: "aa",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              linkId: "pair-1",
            }),
          ],
          [va, aa],
        ),
        playheadMs: 2000,
      },
      selectedClipId: "v1",
      selectedClipIds: ["v1", "a1"],
    };
    const next = applyCommand(start, { type: "duplicate" });
    const origV = next.project.clips.find((c) => c.id === "v1")!;
    const origA = next.project.clips.find((c) => c.id === "a1")!;
    expect(origV.linkId).toBe("pair-1");
    expect(origA.linkId).toBe("pair-1");
    const clones = next.project.clips.filter((c) => c.id !== "v1" && c.id !== "a1");
    expect(clones).toHaveLength(2);
    expect(clones[0]!.linkId).toBeTruthy();
    expect(clones[0]!.linkId).not.toBe("pair-1");
    expect(clones[1]!.linkId).toBe(clones[0]!.linkId);
    expect(clones.map((c) => c.trackId).sort()).toEqual(["A1", "V1"]);
  });

  it("does not replace the editor clipboard; Ctrl+V still pastes the old copy", () => {
    const start = applyCommand(oneClipSession(), { type: "copy" });
    expect(start.clipboard[0]?.id).toBe("c1");
    const duped = applyCommand(start, { type: "duplicate" });
    expect(duped.clipboard[0]?.id).toBe("c1");
    expect(duped.clipboard).toEqual(start.clipboard);
    const pasted = applyCommand(duped, { type: "paste" });
    expect(pasted.clipboard[0]?.id).toBe("c1");
    expect(pasted.project.clips).toHaveLength(3);
    const latest = pasted.project.clips.find((c) => c.id === pasted.selectedClipId)!;
    expect(latest.startMs).toBe(2500);
    expect(latest.id).not.toBe("c1");
  });

  it("paste/duplicate snap to nearby edges; playhead and Ctrl+V/D stay (P93)", () => {
    const start = oneClipSession();
    start.project = {
      ...start.project,
      playheadMs: 1070,
      markers: [{ id: "m1", timeMs: 2000, label: "M" }],
      snap: true,
    };
    const duped = applyCommand(start, { type: "duplicate" });
    const clone = duped.project.clips.find((c) => c.id !== "c1")!;
    expect(clone.startMs).toBe(1000);
    expect(duped.project.playheadMs).toBe(1070);

    const copied = applyCommand(start, { type: "copy" });
    const pasted = applyCommand(copied, { type: "paste" });
    const drop = pasted.project.clips.find((c) => c.id !== "c1")!;
    expect(drop.startMs).toBe(1000);
    expect(pasted.project.playheadMs).toBe(1070);

    const off = applyCommand(
      { ...start, project: { ...start.project, snap: false } },
      { type: "duplicate" },
    );
    expect(off.project.clips.find((c) => c.id !== "c1")!.startMs).toBe(1070);
    expect(off.project.playheadMs).toBe(1070);
  });

  it("duplicate of a disabled clip is enabled at the playhead (P118)", () => {
    const start = oneClipSession();
    start.project = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "c1" ? { ...c, enabled: false } : c)),
    };
    const next = applyCommand(start, { type: "duplicate" });
    const original = next.project.clips.find((c) => c.id === "c1")!;
    const clone = next.project.clips.find((c) => c.id !== "c1")!;
    expect(original.enabled).toBe(false);
    expect(clone.enabled).not.toBe(false);
    expect(clone.startMs).toBe(2500);
    expect(next.selectedClipId).toBe(clone.id);
  });

  it("empty selection is a no-op with no history", () => {
    const start = createSession(createMemoryBlobStore());
    const next = applyCommand(start, { type: "duplicate" });
    expect(next).toBe(start);
    expect(next.history.past.length).toBe(0);
    expect(next.project.clips).toHaveLength(0);
  });
});
