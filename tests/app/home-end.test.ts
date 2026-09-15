import { describe, expect, it } from "vitest";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession, type Session } from "../../src/app/session";
import { projectDurationMs } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function sessionOf(action: ReturnType<typeof dispatchEditorKey>): Session {
  expect(action.type).toBe("session");
  if (action.type !== "session") throw new Error("expected session");
  return action.session;
}

function clipSession(): Session {
  const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
  const c = clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 1000, durationMs: 4000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), playheadMs: 2500 },
  };
}

describe("Home / End seek (P49)", () => {
  it("Home seeks to 0 via applyPlayhead", () => {
    const start = clipSession();
    const next = sessionOf(dispatchEditorKey(start, false, { key: "Home" }));
    expect(next.project.playheadMs).toBe(0);
    expect(next.history.past.length).toBe(start.history.past.length);
    const home = dispatchEditorKey(start, false, { key: "Home" });
    expect(home.type).toBe("session");
    if (home.type === "session") expect(home.preventDefault).toBe(true);
  });

  it("End seeks to projectDurationMs", () => {
    const start = clipSession();
    expect(projectDurationMs(start.project)).toBe(5000);
    const next = sessionOf(dispatchEditorKey(start, false, { key: "End" }));
    expect(next.project.playheadMs).toBe(5000);
    expect(next.project.playheadMs).toBe(projectDurationMs(start.project));
  });

  it("empty project End seeks to 0", () => {
    const empty = createSession(createMemoryBlobStore());
    expect(projectDurationMs(empty.project)).toBe(0);
    const next = sessionOf(dispatchEditorKey(empty, false, { key: "End" }));
    expect(next.project.playheadMs).toBe(0);
  });

  it("VIS-only End seeks to the last VIS event (P54)", () => {
    const empty = createSession(createMemoryBlobStore());
    const visOnly = {
      ...empty,
      project: {
        ...empty.project,
        playheadMs: 100,
        visualizer: {
          ...empty.project.visualizer,
          events: [
            {
              id: "e1",
              sceneId: empty.project.visualizer.sceneId,
              startMs: 0,
              durationMs: 8000,
            },
          ],
        },
      },
    };
    expect(projectDurationMs(visOnly.project)).toBe(8000);
    const next = sessionOf(dispatchEditorKey(visOnly, false, { key: "End" }));
    expect(next.project.playheadMs).toBe(8000);
  });

  it("focused TimecodeField Home/End do not seek", () => {
    const start = clipSession();
    expect(dispatchEditorKey(start, false, { key: "Home", formFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(start, false, { key: "End", formFocus: true }).type).toBe("none");
    expect(start.project.playheadMs).toBe(2500);
  });

  it("Shift+Home / Shift+End seek IN/OUT; unset is a no-op; I/O stay mark keys", () => {
    const base = clipSession();
    const marked = {
      ...base,
      project: { ...base.project, playheadMs: 2500, inPointMs: 800, outPointMs: 4200 },
    };
    expect(sessionOf(dispatchEditorKey(marked, false, { key: "Home", shiftKey: true })).project.playheadMs).toBe(
      800,
    );
    expect(sessionOf(dispatchEditorKey(marked, false, { key: "End", shiftKey: true })).project.playheadMs).toBe(
      4200,
    );
    const unset = clipSession();
    expect(unset.project.inPointMs).toBeNull();
    expect(unset.project.outPointMs).toBeNull();
    expect(dispatchEditorKey(unset, false, { key: "Home", shiftKey: true }).type).toBe("none");
    expect(dispatchEditorKey(unset, false, { key: "End", shiftKey: true }).type).toBe("none");
    expect(unset.project.playheadMs).toBe(2500);
    expect(
      dispatchEditorKey(marked, false, { key: "Home", shiftKey: true, formFocus: true }).type,
    ).toBe("none");
    const afterI = sessionOf(dispatchEditorKey(unset, false, { key: "i" }));
    expect(afterI.project.inPointMs).toBe(2500);
    const afterO = sessionOf(dispatchEditorKey(unset, false, { key: "o" }));
    expect(afterO.project.outPointMs).toBe(2500);
    const cleared = sessionOf(dispatchEditorKey(marked, false, { key: "i", shiftKey: true }));
    expect(cleared.project.inPointMs).toBeNull();
    expect(cleared.project.outPointMs).toBeNull();
    const jumpIn = dispatchEditorKey(marked, false, { key: "Home", shiftKey: true });
    expect(jumpIn.type).toBe("session");
    if (jumpIn.type === "session") expect(jumpIn.preventDefault).toBe(true);
    expect(dispatchEditorKey(marked, false, { key: "Home", ctrlKey: true }).type).toBe("none");
    expect(dispatchEditorKey(marked, false, { key: "End", metaKey: true }).type).toBe("none");
  });

  it("I/O snap the mark to nearby edges; playhead and Shift+I stay (P91)", () => {
    const start = clipSession();
    start.project = {
      ...start.project,
      playheadMs: 2070,
      markers: [{ id: "m1", timeMs: 2000, label: "M" }],
      snap: true,
    };
    const inn = sessionOf(dispatchEditorKey(start, false, { key: "i" }));
    expect(inn.project.inPointMs).toBe(2000);
    expect(inn.project.playheadMs).toBe(2070);
    const out = sessionOf(dispatchEditorKey(start, false, { key: "o" }));
    expect(out.project.outPointMs).toBe(2000);
    expect(out.project.playheadMs).toBe(2070);

    const off = sessionOf(
      dispatchEditorKey({ ...start, project: { ...start.project, snap: false } }, false, { key: "i" }),
    );
    expect(off.project.inPointMs).toBe(2070);

    const cleared = sessionOf(dispatchEditorKey(inn, false, { key: "i", shiftKey: true }));
    expect(cleared.project.inPointMs).toBeNull();
    expect(cleared.project.outPointMs).toBeNull();
  });
});
