import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../../src/core/project";
import { Transport } from "../../src/ui/transport/Transport";
import "../../src/styles.css";

const noop = () => {};

describe("transport grouping (UI-TR)", () => {
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

  it("UI-TR-01 keeps muscle-memory order with calm group separators", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <Transport
          project={createEmptyProject()}
          playing={false}
          onPlay={noop}
          onPause={noop}
          onStop={noop}
          onStep={noop}
          onToggleLoop={noop}
          followPlayhead
          onToggleFollow={noop}
          onIn={noop}
          onOut={noop}
          onClear={noop}
          onMarker={noop}
          onSplit={noop}
          onSeek={noop}
          snap
          onToggleSnap={noop}
          onUndo={noop}
          onRedo={noop}
          onToggleShortcuts={noop}
        />,
      );
    });

    const bar = host.querySelector('[data-testid="transport"]') as HTMLElement;
    const groups = [...bar.querySelectorAll(".transport-group")].map((g) => g.getAttribute("data-group"));
    expect(groups).toEqual(["play", "loop", "marks", "edit", "time", "history", "opts"]);

    const labels = [...bar.querySelectorAll("button")].map((b) => b.textContent?.replace(/\s+/g, " ").trim());
    expect(labels[0]).toBe("Play");
    expect(labels[1]).toBe("Pause");
    expect(labels[2]).toBe("Stop");
    expect(labels).toContain("Loop");
    expect(labels).toContain("Follow");
    expect(labels).toContain("IN");
    expect(labels).toContain("OUT");
    expect(labels).toContain("Clear");
    expect(labels).toContain("Marker");
    expect(labels.some((t) => t?.startsWith("Split"))).toBe(true);
    expect(labels).toContain("Undo");
    expect(labels).toContain("Redo");
    expect(labels).toContain("Snap");
    expect(labels.some((t) => t?.startsWith("Help"))).toBe(true);
    expect(host.querySelector('[data-testid="timecode"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="goto-in"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="follow-playhead"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="transport-snap"]')).toBeTruthy();
  });
});
