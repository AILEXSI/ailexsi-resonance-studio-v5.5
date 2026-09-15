import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { unlinkClips } from "../../src/core/link";
import { createMemoryBlobStore } from "../../src/core/persistence";
import type { Project } from "../../src/core/models";
import { Inspector } from "../../src/ui/inspector/Inspector";
import { asset, clip, projectWith } from "../helpers";

describe("inspector selection", () => {
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

  function mount(
    selectedClipId: string | null,
    selectedClipIds: string[],
    project = projectWith(
      [
        clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
        clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 1000, durationMs: 500 }),
        clip({ id: "c3", assetId: "a", trackId: "A2", startMs: 0, durationMs: 400 }),
      ],
      [asset({ id: "a", kind: "audio", durationMs: 2000 })],
    ),
  ) {
    if (!host) {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
    }
    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId={selectedClipId}
          selectedClipIds={selectedClipIds}
          onChange={() => {}}
        />,
      );
    });
  }

  it("shows the clip fields for one selected clip", () => {
    mount("c1", ["c1"]);
    const text = host!.textContent ?? "";
    expect(text).toContain("Start (ms)");
    expect(text).toContain("Fade in (ms)");
    expect(text).toContain("Fade out (ms)");
    expect(text).toContain("Rate");
    expect(host!.querySelector('[data-testid="inspector-rate"]')).toBeTruthy();
    expect(text).not.toContain("3 clips");
    expect(host!.querySelector('[data-testid="inspector-selection-count"]')).toBeNull();
    expect(host!.querySelector('[data-testid="inspector-fade-in"]')).toBeTruthy();
    expect(host!.querySelector('[data-testid="inspector-fade-out"]')).toBeTruthy();
    expect(text).toContain("Enabled");
    expect(host!.querySelector('[data-testid="inspector-clip-enabled"]')).toBeTruthy();
    expect(text).toContain("Locked");
    expect(host!.querySelector('[data-testid="inspector-clip-locked"]')).toBeTruthy();
    expect(text).toContain("Asset");
    expect(text).toContain("a");
  });

  it("shows the asset filename — no second clip name (P70 KEEP)", () => {
    mount(
      "c1",
      ["c1"],
      projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 })],
        [asset({ id: "a", kind: "audio", name: "verse-01.wav", durationMs: 2000 })],
      ),
    );
    expect(host!.textContent ?? "").toContain("verse-01.wav");
    expect(host!.querySelector('[data-testid="inspector-clip-name"]')).toBeNull();
  });

  it("shows only a count when two or more clips are selected", () => {
    mount("c1", ["c1", "c2", "c3"]);
    const count = host!.querySelector('[data-testid="inspector-selection-count"]');
    expect(count?.textContent).toBe("3 clips");
    expect(host!.textContent ?? "").not.toContain("Start (ms)");
    expect(host!.textContent ?? "").not.toContain("Gain");
    expect(host!.textContent ?? "").not.toContain("Fade in (ms)");
    expect(host!.querySelector('[data-testid="inspector-rate"]')).toBeNull();
    expect(host!.querySelector('[data-testid="inspector-fade-in"]')).toBeNull();
  });

  it("shows a marker label field and commits rename on blur (P68)", () => {
    const project = {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 })],
        [asset({ id: "a", kind: "audio", durationMs: 2000 })],
      ),
      markers: [{ id: "mk1", timeMs: 400, label: "M1" }],
    };
    const renamed: Array<{ id: string; label: string }> = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId={null}
          selectedClipIds={[]}
          selectedMarkerId="mk1"
          onChange={() => {}}
          onRenameMarker={(id, label) => renamed.push({ id, label })}
        />,
      );
    });
    const input = host.querySelector('[data-testid="inspector-marker-label"]') as HTMLInputElement;
    expect(input.value).toBe("M1");
    expect(host.textContent ?? "").not.toContain("No clip selected.");
    act(() => {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      proto?.set?.call(input, "Chorus");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(renamed).toEqual([{ id: "mk1", label: "Chorus" }]);
  });

  it("shows the empty copy when nothing is selected", () => {
    mount(null, []);
    expect(host!.textContent ?? "").toContain("No clip selected.");
  });

  it("shows Relink for one clip or same-asset multi; hides for mixed / none", () => {
    mount("c1", ["c1"]);
    expect(host!.querySelector('[data-testid="inspector-relink"]')?.textContent).toBe("Relink");

    mount("c1", ["c1", "c2", "c3"]);
    expect(host!.querySelector('[data-testid="inspector-relink"]')).toBeTruthy();

    mount(null, []);
    expect(host!.querySelector('[data-testid="inspector-relink"]')).toBeNull();

    mount(
      "c1",
      ["c1", "c2"],
      projectWith(
        [
          clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
          clip({ id: "c2", assetId: "b", trackId: "A1", startMs: 1000, durationMs: 500 }),
        ],
        [
          asset({ id: "a", kind: "audio", durationMs: 2000 }),
          asset({ id: "b", kind: "audio", durationMs: 2000 }),
        ],
      ),
    );
    expect(host!.querySelector('[data-testid="inspector-relink"]')).toBeNull();
  });
});

describe("inspector unlink", () => {
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

  function linkedProject(): Project {
    return projectWith(
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
        clip({ id: "c3", assetId: "va", trackId: "V2", startMs: 0, durationMs: 400 }),
      ],
      [asset({ id: "va", kind: "video", durationMs: 2000, hasAudio: true })],
    );
  }

  function mount(
    project: Project,
    selectedClipId: string | null,
    selectedClipIds: string[],
    onUnlink: (clipId: string) => void = () => {},
  ) {
    if (!host) {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
    }
    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId={selectedClipId}
          selectedClipIds={selectedClipIds}
          onChange={() => {}}
          onUnlink={onUnlink}
        />,
      );
    });
  }

  it("shows Unlink iff a selected clip has a living mate", () => {
    const project = linkedProject();
    mount(project, "v1", ["v1"]);
    expect(host!.querySelector('[data-testid="inspector-unlink"]')?.textContent).toBe("Unlink");

    mount(project, "c3", ["c3"]);
    expect(host!.querySelector('[data-testid="inspector-unlink"]')).toBeNull();

    mount(project, "v1", ["c3", "v1"]);
    expect(host!.querySelector('[data-testid="inspector-selection-count"]')?.textContent).toBe("2 clips");
    expect(host!.querySelector('[data-testid="inspector-unlink"]')).toBeTruthy();
    expect(host!.textContent ?? "").not.toContain("Start (ms)");

    const orphan = {
      ...project,
      clips: project.clips.map((c) => (c.id === "a1" ? { ...c, linkId: undefined } : c)),
    };
    mount(orphan, "v1", ["v1"]);
    expect(host!.querySelector('[data-testid="inspector-unlink"]')).toBeNull();

    mount(project, null, []);
    expect(host!.querySelector('[data-testid="inspector-unlink"]')).toBeNull();
  });

  it("click dispatches unlinkClips and hides Unlink after the pair is cleared", () => {
    let session: Session = {
      ...createSession(createMemoryBlobStore()),
      project: linkedProject(),
      selectedClipId: "v1",
      selectedClipIds: ["v1"],
    };
    const render = () =>
      mount(session.project, session.selectedClipId, session.selectedClipIds, (clipId) => {
        session = applyCommand(session, { type: "unlinkClips", clipId });
      });
    render();
    const btn = host!.querySelector('[data-testid="inspector-unlink"]');
    expect(btn).toBeTruthy();
    act(() => {
      (btn as HTMLButtonElement).click();
    });
    expect(session.project.clips.every((c) => !c.linkId)).toBe(true);
    expect(session.status).toBe("Unlinked clips");
    render();
    expect(host!.querySelector('[data-testid="inspector-unlink"]')).toBeNull();
  });

  it("unlinkClips command clears linkId without inspector chrome", () => {
    const cleared = unlinkClips(linkedProject(), "a1");
    expect(cleared.project.clips.every((c) => !c.linkId)).toBe(true);
  });
});

describe("inspector VIS routing", () => {
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

  it("can set VIS scene id and from-to when the overlay is selected", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = projectWith([], []);
    const seen: Array<{ sceneId?: string; startMs?: number; durationMs?: number }> = [];
    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId={null}
          selectedClipIds={[]}
          selectedVis
          onChange={() => {}}
          onVisualizer={(patch) => seen.push(patch)}
        />,
      );
    });
    expect(host.querySelector("[data-testid=inspector-vis]")).toBeTruthy();
    const scene = host.querySelector<HTMLSelectElement>("[data-testid=inspector-vis-scene]");
    expect(scene).toBeTruthy();
    act(() => {
      scene!.value = "pulse-orb";
      scene!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(seen[0]?.sceneId).toBe("pulse-orb");
    expect(host.querySelector("[data-testid=inspector-vis-start]")).toBeTruthy();
    expect(host.querySelector("[data-testid=inspector-vis-duration]")).toBeTruthy();
  });
});

describe("inspector track control", () => {
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

  it("offers V1/V2 for a video clip and writes trackId", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = projectWith(
      [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "va", kind: "video", durationMs: 2000 })],
    );
    const patches: Array<{ trackId?: string }> = [];
    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId="v1"
          selectedClipIds={["v1"]}
          onChange={(_id, patch) => patches.push(patch)}
        />,
      );
    });
    const select = host.querySelector<HTMLSelectElement>("[data-testid=inspector-track]");
    expect(select).toBeTruthy();
    expect([...select!.options].map((o) => o.value)).toEqual(["V1", "V2"]);
    act(() => {
      select!.value = "V2";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(patches[0]?.trackId).toBe("V2");
  });

  it("offers A1/A2 for an audio clip", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = projectWith(
      [clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "aa", kind: "audio", durationMs: 2000 })],
    );
    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId="a1"
          selectedClipIds={["a1"]}
          onChange={() => {}}
        />,
      );
    });
    const select = host.querySelector<HTMLSelectElement>("[data-testid=inspector-track]");
    expect([...select!.options].map((o) => o.value)).toEqual(["A1", "A2"]);
  });
});
