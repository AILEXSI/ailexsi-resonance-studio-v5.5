import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { collectEditPoints, nearestEditPointMs } from "../../src/core/timeline";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject } from "../../src/core/project";
import { currentCutTickMs } from "../../src/ui/cutter/CutStrip";
import { Cutter } from "../../src/ui/cutter/Cutter";
import { RULER_PAD_PX } from "../../src/core/zoom";
import { upsertTransition } from "../../src/core/transition";
import { asset, clip, projectWith } from "../helpers";

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function mappedProject() {
  return {
    ...projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
        clip({ id: "v2", assetId: "va", trackId: "V1", startMs: 3000, durationMs: 1500 }),
      ],
      [asset({ id: "va", kind: "video", durationMs: 8000 })],
    ),
    playheadMs: 500,
    inPointMs: 200,
    outPointMs: 4500,
    markers: [{ id: "m1", timeMs: 2000, label: "M1" }],
    zoomPxPerSec: 80,
    scrollMs: 0,
  };
}

describe("Cutter cut strip", () => {
  it("ticks match collectEditPoints order: clip edges, marker, IN/OUT", () => {
    const project = mappedProject();
    const points = collectEditPoints(project);
    expect(points).toEqual([0, 200, 1000, 2000, 3000, 4500]);
    render(<Cutter project={project} selectedClipId={null} selectedClipIds={[]} apply={() => {}} />);
    const ticks = [...host!.querySelectorAll("[data-testid=cut-strip-tick]")];
    expect(ticks.map((el) => Number(el.getAttribute("data-ms")))).toEqual(points);
  });

  it("click seeks to that edit ms via onPlayhead", () => {
    const project = mappedProject();
    const seeks: number[] = [];
    render(
      <Cutter
        project={project}
        selectedClipId={null}
        selectedClipIds={[]}
        apply={() => {}}
        onPlayhead={(ms) => seeks.push(ms)}
      />,
    );
    const tick = host!.querySelector('[data-testid=cut-strip-tick][data-ms="2000"]') as HTMLButtonElement;
    act(() => {
      tick.click();
    });
    expect(seeks).toEqual([2000]);
  });

  it("empty project has an empty strip", () => {
    const project = createEmptyProject("Empty");
    expect(collectEditPoints(project)).toEqual([]);
    render(<Cutter project={project} selectedClipId={null} selectedClipIds={[]} apply={() => {}} />);
    expect(host!.querySelector("[data-testid=cut-strip]")).toBeTruthy();
    expect(host!.querySelectorAll("[data-testid=cut-strip-tick]")).toHaveLength(0);
  });

  it("marks the nearest collectEditPoints tick current (gold)", () => {
    const project = { ...mappedProject(), playheadMs: 1900 };
    expect(currentCutTickMs(project)).toBe(2000);
    render(<Cutter project={project} selectedClipId={null} selectedClipIds={[]} apply={() => {}} />);
    const current = host!.querySelector("[data-testid=cut-strip-tick].current");
    expect(current?.getAttribute("data-ms")).toBe("2000");
  });

  it("prefers the transition-under-playhead start when that time is a collected point", () => {
    let project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    project = upsertTransition(
      project,
      {
        sourceA: project.clips[0]!,
        sourceB: project.clips[1]!,
        overlapStartMs: 1000,
        overlapDurationMs: 1000,
      },
      { type: "cut", durationMs: 400, startMs: 1000 },
    ).project;
    project = { ...project, playheadMs: 1200 };
    expect(collectEditPoints(project)).toContain(1000);
    expect(currentCutTickMs(project)).toBe(1000);
  });

  it("off-grid playhead still prefers the thin-cut transition start (P95)", () => {
    let project = projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1001 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 1000, durationMs: 1000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000 }),
        asset({ id: "vb", kind: "video", durationMs: 4000 }),
      ],
    );
    project = upsertTransition(
      project,
      {
        sourceA: project.clips[0]!,
        sourceB: project.clips[1]!,
        overlapStartMs: 1000,
        overlapDurationMs: 1,
      },
      { type: "cut", durationMs: 1, startMs: 1000 },
    ).project;
    project = { ...project, playheadMs: 1070, snap: true };
    expect(currentCutTickMs(project)).toBe(1000);
  });

  it("ticks include VIS event edges (same collectEditPoints as ArrowUp/Down)", () => {
    const project = {
      ...mappedProject(),
      visualizer: {
        ...mappedProject().visualizer,
        events: [
          { id: "e1", sceneId: mappedProject().visualizer.sceneId, startMs: 1500, durationMs: 500 },
        ],
      },
    };
    expect(collectEditPoints(project)).toEqual([0, 200, 1000, 1500, 2000, 3000, 4500]);
    render(<Cutter project={project} selectedClipId={null} selectedClipIds={[]} apply={() => {}} />);
    const ticks = [...host!.querySelectorAll("[data-testid=cut-strip-tick]")];
    expect(ticks.map((el) => Number(el.getAttribute("data-ms")))).toEqual(collectEditPoints(project));
  });

  it("tick offset uses the live lane label width", () => {
    const project = { ...mappedProject(), zoomPxPerSec: 80, scrollMs: 0 };
    render(
      <Cutter
        project={project}
        selectedClipId={null}
        selectedClipIds={[]}
        apply={() => {}}
        laneLabelPx={140}
      />,
    );
    expect(host!.querySelector("[data-testid=cut-strip]")?.getAttribute("data-label-px")).toBe("140");
    const tick0 = host!.querySelector('[data-testid=cut-strip-tick][data-ms="0"]') as HTMLElement;
    expect(tick0.style.left).toBe(`${140 + RULER_PAD_PX}px`);
  });
});

describe("P28 next/prev still uses collectEditPoints", () => {
  it("Arrow path gotoNextEdit / gotoPrevEdit is unchanged", () => {
    const project = mappedProject();
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: { ...project, playheadMs: 0 },
    };
    expect(collectEditPoints(start.project)).toEqual([0, 200, 1000, 2000, 3000, 4500]);
    const next = applyCommand(start, { type: "gotoNextEdit" });
    expect(next.project.playheadMs).toBe(200);
    const prev = applyCommand({ ...start, project: { ...start.project, playheadMs: 2000 } }, { type: "gotoPrevEdit" });
    expect(prev.project.playheadMs).toBe(1000);
    expect(nearestEditPointMs(start.project, 1900)).toBe(2000);
    expect(nearestEditPointMs(createEmptyProject("x"), 0)).toBeUndefined();
  });
});
