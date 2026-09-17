import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LEXI_FAMILIES, LEXI_SCENE_IDS } from "../../src/core/visualz/scene-catalog";
import { VisSceneBrowser } from "../../src/ui/inspector/VisSceneBrowser";
import { Inspector } from "../../src/ui/inspector/Inspector";
import { projectWith } from "../helpers";

describe("VIS scene browser", () => {
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

  it("walks LEXI → family → scene by click and applies immediately", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const seen: string[] = [];
    act(() => {
      root!.render(
        <VisSceneBrowser value="resonance-wave" onSelect={(id) => seen.push(id)} testIdPrefix="vis-browser" />,
      );
    });
    expect(host.querySelector("[data-testid=vis-browser-categories]")).toBeTruthy();
    act(() => {
      (host!.querySelector("[data-testid=vis-browser-category-LEXI]") as HTMLButtonElement).click();
    });
    const familyRow = host.querySelector("[data-testid=vis-browser-families]");
    expect(familyRow).toBeTruthy();
    for (const family of LEXI_FAMILIES) {
      expect(host.querySelector(`[data-testid=vis-browser-family-${family}]`)).toBeTruthy();
    }
    act(() => {
      (host!.querySelector("[data-testid=vis-browser-family-FLOW]") as HTMLButtonElement).click();
    });
    for (const id of LEXI_SCENE_IDS) {
      expect(host.querySelector(`[data-testid=vis-browser-scene-${id}]`)).toBeTruthy();
    }
    act(() => {
      (host!.querySelector("[data-testid=vis-browser-scene-lexi-v3]") as HTMLButtonElement).click();
    });
    expect(seen).toEqual(["lexi-v3"]);
    act(() => {
      (host!.querySelector("[data-testid=vis-browser-family-GEOMETRY]") as HTMLButtonElement).click();
    });
    expect(host.querySelector("[data-testid=vis-browser-empty]")).toBeTruthy();
    expect(host.querySelector("[data-testid=vis-browser-scene-lexi-v3]")).toBeNull();
  });

  it("Inspector catalog select and browser both write the same scene id", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const seen: string[] = [];
    act(() => {
      root!.render(
        <Inspector
          project={projectWith([], [])}
          selectedClipId={null}
          selectedClipIds={[]}
          selectedVis
          onChange={() => {}}
          onVisualizer={(patch) => {
            if (patch.sceneId) seen.push(patch.sceneId);
          }}
        />,
      );
    });
    expect(host.querySelector("[data-testid=vis-browser]")).toBeTruthy();
    const native = host.querySelector<HTMLSelectElement>("[data-testid=inspector-vis-scene]");
    expect(native).toBeTruthy();
    expect([...native!.options].map((o) => o.value)).toContain("lexi-2036");
    act(() => {
      native!.value = "lexi-ref";
      native!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      (host!.querySelector("[data-testid=vis-browser-category-LEXI]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=vis-browser-family-FLOW]") as HTMLButtonElement).click();
      (host!.querySelector("[data-testid=vis-browser-scene-lexi-v1]") as HTMLButtonElement).click();
    });
    expect(seen).toEqual(["lexi-ref", "lexi-v1"]);
  });
});
