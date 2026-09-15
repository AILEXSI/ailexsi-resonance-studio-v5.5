import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyPlayhead, createSession } from "../../src/app/session";
import { dispatchEditorKey } from "../../src/app/keys";
import { formatTimecode } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject } from "../../src/core/project";
import { Transport } from "../../src/ui/transport/Transport";
import { asset, clip, projectWith } from "../helpers";

const noop = () => {};

function typeIn(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountTransport(
  playheadMs: number,
  onSeek?: (ms: number) => void,
  onSplit: () => void = noop,
  onPlay: () => void = noop,
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <Transport
        project={{ ...createEmptyProject(), playheadMs }}
        playing={false}
        onPlay={onPlay}
        onPause={noop}
        onStop={noop}
        onStep={noop}
        onToggleLoop={noop}
        onIn={noop}
        onOut={noop}
        onClear={noop}
        onMarker={noop}
        onSplit={onSplit}
        onSeek={onSeek}
      />,
    );
  });
  return { host, root };
}

describe("Transport jump-to-time (P47)", () => {
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

  it("shows the printed timecode and 1:02.00 seeks 62000 via applyPlayhead", () => {
    const mounted = mountTransport(1500);
    host = mounted.host;
    root = mounted.root;
    const field = host.querySelector('[data-testid="timecode"]') as HTMLInputElement;
    expect(field).toBeTruthy();
    expect(field.tagName).toBe("INPUT");
    expect(field.value).toBe(formatTimecode(1500));
    expect(field.value).toBe("00:01.50");

    let session = {
      ...createSession(createMemoryBlobStore()),
      project: { ...createEmptyProject(), playheadMs: 1500 },
    };
    act(() => {
      root!.render(
        <Transport
          project={session.project}
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
          onSeek={(ms) => {
            session = applyPlayhead(session, ms);
          }}
        />,
      );
    });
    const input = host.querySelector('[data-testid="timecode"]') as HTMLInputElement;
    act(() => {
      input.focus();
      typeIn(input, "1:02.00");
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(session.project.playheadMs).toBe(62_000);
  });

  it("invalid input is a no-op and restores the current playhead display", () => {
    const seeks: number[] = [];
    const mounted = mountTransport(2500, (ms) => seeks.push(ms));
    host = mounted.host;
    root = mounted.root;
    const input = host.querySelector('[data-testid="timecode"]') as HTMLInputElement;
    expect(input.value).toBe("00:02.50");
    act(() => {
      input.focus();
      typeIn(input, "nope");
    });
    act(() => {
      input.blur();
    });
    expect(seeks).toEqual([]);
    expect(input.value).toBe("00:02.50");
  });

  it("focus does not fire play or split; keys.ts skips Space and S", () => {
    let splits = 0;
    let plays = 0;
    const mounted = mountTransport(0, undefined, () => {
      splits += 1;
    }, () => {
      plays += 1;
    });
    host = mounted.host;
    root = mounted.root;
    const input = host.querySelector('[data-testid="timecode"]') as HTMLInputElement;
    act(() => {
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });
    expect(splits).toBe(0);
    expect(plays).toBe(0);

    const start = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 2000 })],
        [asset({ id: "a", kind: "audio", durationMs: 2000 })],
      ),
      selectedClipId: "c1",
    };
    expect(dispatchEditorKey(start, false, { key: "s", formFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(start, false, { key: " ", formFocus: true, textEditFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(start, false, { key: " ", formFocus: true }).type).toBe("session");
    expect(dispatchEditorKey(start, false, { key: "s" }).type).toBe("session");
  });

  it("click IN/OUT readout seeks via applyPlayhead; unset is a no-op", () => {
    const seeks: number[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = {
      ...createEmptyProject(),
      playheadMs: 100,
      inPointMs: 500,
      outPointMs: 4000,
    };
    act(() => {
      root!.render(
        <Transport
          project={project}
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
          onSeek={(ms) => seeks.push(ms)}
        />,
      );
    });
    const gotoIn = host.querySelector('[data-testid="goto-in"]') as HTMLButtonElement;
    const gotoOut = host.querySelector('[data-testid="goto-out"]') as HTMLButtonElement;
    expect(gotoIn.disabled).toBe(false);
    expect(gotoOut.disabled).toBe(false);
    expect(gotoIn.textContent).toContain(formatTimecode(500));
    act(() => {
      gotoIn.click();
    });
    act(() => {
      gotoOut.click();
    });
    expect(seeks).toEqual([500, 4000]);

    act(() => {
      root!.render(
        <Transport
          project={{ ...createEmptyProject(), playheadMs: 100 }}
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
          onSeek={(ms) => seeks.push(ms)}
        />,
      );
    });
    expect((host.querySelector('[data-testid="goto-in"]') as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector('[data-testid="goto-out"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      (host!.querySelector('[data-testid="goto-in"]') as HTMLButtonElement).click();
      (host!.querySelector('[data-testid="goto-out"]') as HTMLButtonElement).click();
    });
    expect(seeks).toEqual([500, 4000]);
  });

  it("Undo / Redo / Snap / Help sit on the transport row; Split is not duplicated", () => {
    let undos = 0;
    let redos = 0;
    let snaps = 0;
    let helps = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Transport
          project={{ ...createEmptyProject(), snap: true }}
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
          snap
          onToggleSnap={() => {
            snaps += 1;
          }}
          onUndo={() => {
            undos += 1;
          }}
          onRedo={() => {
            redos += 1;
          }}
          onToggleShortcuts={() => {
            helps += 1;
          }}
        />,
      );
    });
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    expect(labels.filter((t) => t === "Split" || t?.startsWith("Split")).length).toBe(1);
    expect(host.querySelector('[data-testid="transport-undo"]')?.textContent?.trim()).toBe("Undo");
    expect(host.querySelector('[data-testid="transport-redo"]')?.textContent?.trim()).toBe("Redo");
    expect(host.querySelector('[data-testid="transport-snap"]')?.textContent?.trim()).toBe("Snap");
    expect(host.querySelector('[data-testid="transport-snap"]')?.classList.contains("active")).toBe(true);
    expect(host.querySelector('[data-testid="shortcuts-help"]')?.textContent?.replace(/\s+/g, " ").trim().startsWith("Help")).toBe(true);
    act(() => {
      (host!.querySelector('[data-testid="transport-undo"]') as HTMLButtonElement).click();
      (host!.querySelector('[data-testid="transport-redo"]') as HTMLButtonElement).click();
      (host!.querySelector('[data-testid="transport-snap"]') as HTMLButtonElement).click();
      (host!.querySelector('[data-testid="shortcuts-help"]') as HTMLButtonElement).click();
    });
    expect(undos).toBe(1);
    expect(redos).toBe(1);
    expect(snaps).toBe(1);
    expect(helps).toBe(1);
  });
});
