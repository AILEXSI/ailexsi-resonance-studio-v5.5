import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession, type Session } from "../../src/app/session";
import { clipEndMs, clipIsLocked, type TrackId } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { Inspector } from "../../src/ui/inspector/Inspector";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { asset, clip, projectWith } from "../helpers";

function clipSession(locked?: boolean): Session {
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith(
      [
        clip({
          id: "c1",
          assetId: "a",
          trackId: "A1",
          startMs: 1000,
          durationMs: 2000,
          ...(locked ? { locked: true } : {}),
        }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 4000, durationMs: 1000 }),
      ],
      [asset({ id: "a", kind: "audio", durationMs: 8000 })],
    ),
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
  };
}

describe("clip lock (P53)", () => {
  it("locked clip rejects move; unlocked still moves", () => {
    const locked = clipSession(true);
    const rejected = applyCommand(locked, { type: "moveClips", clipIds: ["c1"], deltaMs: 500 });
    expect(rejected.project.clips.find((c) => c.id === "c1")?.startMs).toBe(1000);
    expect(rejected.error).toBe("Clip is locked");
    expect(rejected.history.past.length).toBe(locked.history.past.length);

    const free = clipSession();
    expect(clipIsLocked(free.project.clips.find((c) => c.id === "c1")!)).toBe(false);
    const moved = applyCommand(free, { type: "moveClips", clipIds: ["c1"], deltaMs: 500 });
    expect(moved.project.clips.find((c) => c.id === "c1")?.startMs).toBe(1500);
    expect(moved.error).toBeNull();
  });

  it("missing locked = unlocked", () => {
    const start = clipSession();
    const c1 = start.project.clips.find((c) => c.id === "c1")!;
    expect(c1.locked).toBeUndefined();
    expect(clipIsLocked(c1)).toBe(false);
    const moved = applyCommand(start, { type: "moveClips", clipIds: ["c1"], deltaMs: 250 });
    expect(moved.project.clips.find((c) => c.id === "c1")?.startMs).toBe(1250);
  });

  it("enable/disable still works on a locked clip; L stays shuttle", () => {
    const start = clipSession(true);
    const off = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    expect(off.project.clips.find((c) => c.id === "c1")?.enabled).toBe(false);
    expect(off.project.clips.find((c) => c.id === "c1")?.locked).toBe(true);
    const shuttle = dispatchEditorKey(start, false, { key: "l" });
    expect(shuttle.type).toBe("session");
    if (shuttle.type === "session") {
      expect(shuttle.session.project.clips.find((c) => c.id === "c1")?.startMs).toBe(1000);
    }
  });

  it("persist/reload keeps locked: true; missing field stays unlocked", () => {
    const start = clipSession();
    const next = applyCommand(start, { type: "setClipsLocked", locked: true });
    const loaded = deserializeProject(serializeProject(next.project));
    expect(loaded.clips.find((c) => c.id === "c1")?.locked).toBe(true);
    expect(loaded.clips.find((c) => c.id === "c2")?.locked).toBeUndefined();
    expect(
      JSON.parse(serializeProject(next.project)).clips.find((c: { id: string }) => c.id === "c2")
        .locked,
    ).toBeUndefined();
  });

  it("locking one linked clip does not lock or freeze the mate", () => {
    const a = clip({
      id: "v",
      assetId: "va",
      trackId: "V1",
      startMs: 0,
      durationMs: 2000,
      linkId: "pair",
      locked: true,
    });
    const b = clip({
      id: "au",
      assetId: "aa",
      trackId: "A1",
      startMs: 0,
      durationMs: 2000,
      linkId: "pair",
    });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith(
        [a, b],
        [
          asset({ id: "va", kind: "video", durationMs: 4000 }),
          asset({ id: "aa", kind: "audio", durationMs: 4000 }),
        ],
      ),
      selectedClipId: "au",
      selectedClipIds: ["au"],
    };
    const moved = applyCommand(start, { type: "moveClips", clipIds: ["au"], deltaMs: 400 });
    expect(moved.project.clips.find((c) => c.id === "au")?.startMs).toBe(400);
    expect(moved.project.clips.find((c) => c.id === "v")?.startMs).toBe(0);
    expect(moved.project.clips.find((c) => c.id === "v")?.locked).toBe(true);
    expect(moved.project.clips.find((c) => c.id === "au")?.locked).not.toBe(true);

    const split = applyCommand(
      { ...start, project: { ...start.project, playheadMs: 1000, snap: false } },
      { type: "split" },
    );
    expect(split.project.clips.find((c) => c.id === "v")?.durationMs).toBe(2000);
    expect(split.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(2);
    expect(split.error).toBeNull();
  });

  it("liftRange keeps a locked clip fully inside IN/OUT (P110)", () => {
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 3000,
              sourceInMs: 0,
              sourceOutMs: 3000,
            }),
            clip({
              id: "parked",
              assetId: "a",
              trackId: "A2",
              startMs: 1200,
              durationMs: 600,
              locked: true,
            }),
          ],
          [asset({ id: "a", kind: "audio", durationMs: 8000 })],
        ),
        inPointMs: 1000,
        outPointMs: 2000,
        snap: false,
      },
      selectedClipId: null,
      selectedClipIds: [],
    };
    const lifted = applyCommand(start, { type: "liftRange" });
    expect(lifted.project.clips.find((c) => c.id === "parked")).toBeTruthy();
    expect(lifted.project.clips.find((c) => c.id === "parked")?.startMs).toBe(1200);
    const a1 = lifted.project.clips.filter((c) => c.trackId === "A1");
    expect(a1.every((c) => c.startMs >= 2000 || clipEndMs(c) <= 1000)).toBe(true);
    expect(lifted.history.past.length).toBe(start.history.past.length + 1);
  });

  it("extractRange refuses to slide a locked clip after OUT (P109)", () => {
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 3000,
              sourceInMs: 0,
              sourceOutMs: 3000,
            }),
            clip({
              id: "parked",
              assetId: "a",
              trackId: "A1",
              startMs: 4000,
              durationMs: 500,
              locked: true,
            }),
          ],
          [asset({ id: "a", kind: "audio", durationMs: 8000 })],
        ),
        inPointMs: 1000,
        outPointMs: 2000,
        snap: false,
      },
      selectedClipId: null,
      selectedClipIds: [],
    };
    const blocked = applyCommand(start, { type: "extractRange" });
    expect(blocked.project.clips.find((c) => c.id === "parked")?.startMs).toBe(4000);
    expect(blocked.project.clips.find((c) => c.id === "c1")?.durationMs).toBe(3000);
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.history.past.length).toBe(start.history.past.length);
  });

  it("extractRange refuses when a locked clip straddles IN/OUT (P111)", () => {
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "locked",
              assetId: "a",
              trackId: "A1",
              startMs: 500,
              durationMs: 2500,
              locked: true,
            }),
            clip({
              id: "later",
              assetId: "a",
              trackId: "A1",
              startMs: 4000,
              durationMs: 500,
            }),
          ],
          [asset({ id: "a", kind: "audio", durationMs: 8000 })],
        ),
        inPointMs: 1000,
        outPointMs: 2000,
        snap: false,
      },
      selectedClipId: null,
      selectedClipIds: [],
    };
    const blocked = applyCommand(start, { type: "extractRange" });
    expect(blocked.project.clips.find((c) => c.id === "later")?.startMs).toBe(4000);
    expect(blocked.project.clips.find((c) => c.id === "locked")?.durationMs).toBe(2500);
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.history.past.length).toBe(start.history.past.length);
  });

  it("extractRange refuses when a locked clip sits fully inside IN/OUT (P112)", () => {
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 3000,
              sourceInMs: 0,
              sourceOutMs: 3000,
            }),
            clip({
              id: "parked",
              assetId: "a",
              trackId: "A2",
              startMs: 1200,
              durationMs: 600,
              locked: true,
            }),
            clip({
              id: "later",
              assetId: "a",
              trackId: "A2",
              startMs: 3000,
              durationMs: 500,
            }),
          ],
          [asset({ id: "a", kind: "audio", durationMs: 8000 })],
        ),
        inPointMs: 1000,
        outPointMs: 2000,
        snap: false,
      },
      selectedClipId: null,
      selectedClipIds: [],
    };
    const blocked = applyCommand(start, { type: "extractRange" });
    expect(blocked.project.clips.find((c) => c.id === "later")?.startMs).toBe(3000);
    expect(blocked.project.clips.find((c) => c.id === "parked")?.startMs).toBe(1200);
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.history.past.length).toBe(start.history.past.length);
  });

  it("rippleDelete refuses to pack a later locked clip (P128)", () => {
    const start = clipSession();
    start.project = projectWith(
      [
        clip({
          id: "c1",
          assetId: "va",
          trackId: "V1",
          startMs: 0,
          durationMs: 1000,
        }),
        clip({
          id: "wall",
          assetId: "va",
          trackId: "V1",
          startMs: 1000,
          durationMs: 500,
          locked: true,
        }),
      ],
      [asset({ id: "va", kind: "video", durationMs: 4000 })],
    );
    start.selectedClipId = "c1";
    start.selectedClipIds = ["c1"];
    const blocked = applyCommand(start, { type: "rippleDelete" });
    expect(blocked.error).toBe("Clip is locked");
    expect(blocked.project.clips.find((c) => c.id === "c1")?.startMs).toBe(0);
    expect(blocked.project.clips.find((c) => c.id === "wall")?.startMs).toBe(1000);
    expect(blocked.history.past.length).toBe(start.history.past.length);
  });

  it("setClipsLocked writes history and undo restores", () => {
    const start = clipSession();
    const viaCommand = applyCommand(start, { type: "setClipsLocked", locked: true });
    expect(viaCommand.project.clips.find((c) => c.id === "c1")?.locked).toBe(true);
    expect(viaCommand.history.past.length).toBe(start.history.past.length + 1);
    const undone = applyCommand(viaCommand, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "c1")?.locked).not.toBe(true);
  });
});

let host: HTMLDivElement | undefined;
let root: Root | undefined;

describe("clip lock UI", () => {
  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  it("Inspector toggle writes setClipsLocked", () => {
    const start = clipSession();
    const locked: boolean[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Inspector
          project={start.project}
          selectedClipId="c1"
          selectedClipIds={["c1"]}
          onChange={() => {}}
          onSetLocked={(next) => locked.push(next)}
        />,
      );
    });
    const box = host.querySelector('[data-testid="inspector-clip-locked"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.checked).toBe(false);
    act(() => {
      box.click();
    });
    expect(locked).toEqual([true]);
  });

  it("clip menu Lock/Unlock and locked class", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = clipSession().project;
    const noop = () => {};
    let last: boolean | undefined;
    act(() => {
      root!.render(
        <Timeline
          project={project}
          selectedClipId="c1"
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
          onSetClipsLocked={(value) => {
            last = value;
          }}
        />,
      );
    });
    const clipEl = host.querySelector('[data-testid="clip-c1"]');
    expect(clipEl?.className).not.toContain("locked");
    act(() => {
      clipEl!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
      );
    });
    const lock = host.querySelector('[data-testid="clip-menu-toggle-locked"]');
    expect(lock?.textContent).toContain("Lock");
    act(() => {
      (lock as HTMLButtonElement).click();
    });
    expect(last).toBe(true);

    const on = {
      ...project,
      clips: project.clips.map((c) => (c.id === "c1" ? { ...c, locked: true } : c)),
    };
    act(() => {
      root!.render(
        <Timeline
          project={on}
          selectedClipId="c1"
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
          onSetClipsLocked={(value) => {
            last = value;
          }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="clip-c1"]')?.className).toContain("locked");
    expect(host.querySelector('[data-testid="clip-c1"]')?.getAttribute("data-locked")).toBe("true");
  });
});
