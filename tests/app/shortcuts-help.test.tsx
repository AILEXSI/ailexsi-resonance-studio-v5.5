import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/core/project";
import { SHORTCUT_ROWS } from "../../src/ui/shortcuts/labels";
import { ShortcutsOverlay } from "../../src/ui/shortcuts/ShortcutsOverlay";
import { Transport } from "../../src/ui/transport/Transport";
import "../../src/styles.css";

describe("shortcuts help (P75)", () => {
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

  it("transport Help opens the existing labels.ts sheet", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = () => {};
    let open = false;
    const render = () => {
      act(() => {
        root!.render(
          <>
            <Transport
              project={createEmptyProject()}
              playing={false}
              onPlay={noop}
              onPause={noop}
              onStop={noop}
              onStep={noop}
              onToggleLoop={noop}
              onIn={noop}
              onOut={noop}
              onClear={noop}
              onMarker={noop}
              onSplit={noop}
              onToggleShortcuts={() => {
                open = !open;
                render();
              }}
            />
            <ShortcutsOverlay open={open} onClose={() => { open = false; render(); }} />
          </>,
        );
      });
    };
    render();
    expect(host.querySelector('[data-testid="shortcuts"]')).toBeNull();
    act(() => {
      (host!.querySelector('[data-testid="shortcuts-help"]') as HTMLButtonElement).click();
    });
    const sheet = host.querySelector('[data-testid="shortcuts"]');
    expect(sheet).toBeTruthy();
    const text = sheet!.textContent ?? "";
    expect(text).toContain("Split is S");
    expect(text).toContain("Save is Ctrl+S");
    for (const row of SHORTCUT_ROWS) {
      expect(text).toContain(row.key);
      expect(text).toContain(row.action);
    }
  });

  it("× and backdrop close the same sheet (P76)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    let open = true;
    const render = () => {
      act(() => {
        root!.render(
          <ShortcutsOverlay
            open={open}
            onClose={() => {
              open = false;
              render();
            }}
          />,
        );
      });
    };
    render();
    expect(host.querySelector('[data-testid="shortcuts"]')).toBeTruthy();
    act(() => {
      (host!.querySelector('[data-testid="shortcuts-close"]') as HTMLButtonElement).click();
    });
    expect(host.querySelector('[data-testid="shortcuts"]')).toBeNull();
    open = true;
    render();
    act(() => {
      (host!.querySelector('[data-testid="shortcuts"]') as HTMLDivElement).click();
    });
    expect(host.querySelector('[data-testid="shortcuts"]')).toBeNull();
  });

  it("sheet stays inside the viewport and keeps every row including the last ones", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<ShortcutsOverlay open />);
    });
    const card = host.querySelector('[data-testid="shortcuts-sheet"]') as HTMLElement | null;
    const list = host.querySelector('[data-testid="shortcuts-list"]') as HTMLElement | null;
    expect(card).toBeTruthy();
    expect(list).toBeTruthy();
    expect(card!.getAttribute("data-fit-viewport")).toBe("true");
    expect(list!.getAttribute("data-scroll")).toBe("inner");
    expect(card!.className).toContain("shortcuts-card");
    expect(list!.className).toContain("shortcuts-list");
    const text = card!.textContent ?? "";
    expect(text).toContain("Shift+edge-drag");
    expect(text).toContain("Abutting edge-drag");
    expect(text).toContain("Alt+drag clip");
    expect(text).toContain("Toggle this sheet");
    expect(text).toContain("active/selected track");
    expect(SHORTCUT_ROWS.at(-1)?.key).toBe("?");
    expect(text).toContain(SHORTCUT_ROWS.at(-1)!.action);
    expect(list!.children.length).toBe(SHORTCUT_ROWS.length);
  });
});
