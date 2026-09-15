import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/core/project";
import { loadMixerCollapsed, saveMixerCollapsed, type StorageLike } from "../../src/core/layout-prefs";
import { Mixer } from "../../src/ui/mixer/Mixer";
import "../../src/styles.css";

const silentPeaks = { V1: 0, V2: 0, A1: 0, A2: 0, master: 0 };

function Harness({ storage }: { storage: StorageLike }) {
  const [collapsed, setCollapsed] = useState(() => loadMixerCollapsed(storage));
  return (
    <Mixer
      project={createEmptyProject()}
      selectedTrackId="A1"
      peaks={silentPeaks}
      collapsed={collapsed}
      onToggleCollapsed={() => {
        setCollapsed((prev) => {
          const next = !prev;
          saveMixerCollapsed(storage, next);
          return next;
        });
      }}
      onSelectTrack={() => {}}
      onVolume={() => {}}
      onMasterVolume={() => {}}
      onToggleMute={() => {}}
      onToggleSolo={() => {}}
    />
  );
}

describe("mixer collapse", () => {
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

  it("hides V1–A2 and leaves Master; expand restores; persist round-trips", () => {
    const map = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => (map.has(k) ? map.get(k)! : null),
      setItem: (k, v) => {
        map.set(k, v);
      },
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<Harness storage={storage} />);
    });

    expect(host.querySelector('[data-testid="mixer-collapse"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-V1"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-V2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-A1"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-A2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-solo-V1"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-solo-A2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-solo-master"]')).toBeNull();
    expect(host.querySelector('[data-testid="mix-pan-V1"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-pan-A2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-pan-master"]')).toBeNull();
    expect(host.querySelector('[data-testid="mixer"]')?.getAttribute("data-collapsed")).toBe("false");

    act(() => {
      (host!.querySelector('[data-testid="mixer-collapse"]') as HTMLButtonElement).click();
    });

    expect(host.querySelector('[data-testid="mix-V1"]')).toBeNull();
    expect(host.querySelector('[data-testid="mix-V2"]')).toBeNull();
    expect(host.querySelector('[data-testid="mix-A1"]')).toBeNull();
    expect(host.querySelector('[data-testid="mix-A2"]')).toBeNull();
    expect(host.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mixer"]')?.getAttribute("data-collapsed")).toBe("true");
    expect(loadMixerCollapsed(storage)).toBe(true);
    expect(getComputedStyle(host.querySelector('[data-testid="mixer"]')!).minWidth).not.toBe("0px");

    act(() => {
      (host!.querySelector('[data-testid="mixer-collapse"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="mix-V1"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-A2"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="mix-master"]')).toBeTruthy();
    expect(loadMixerCollapsed(storage)).toBe(false);
  });
});
