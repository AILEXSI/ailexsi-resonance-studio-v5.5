import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { envelopeForWidth } from "../../src/core/clip-preview";
import { AudioClipWave, VideoClipStrip } from "../../src/ui/timeline/ClipPreview";
import { asset, clip } from "../helpers";

describe("clip preview DOM", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
  });

  it("draws a gapless waveform path from fixture samples", () => {
    const samples = new Float32Array(256);
    for (let i = 0; i < samples.length; i += 1) samples[i] = i % 16 === 0 ? 1 : 0.1;
    const envelope = envelopeForWidth(samples, {
      widthPx: 48,
      sourceInMs: 0,
      sourceOutMs: 1000,
      durationMs: 1000,
    });
    const c = clip({ id: "a1", assetId: "wav", trackId: "A1", startMs: 0, durationMs: 1000 });
    const a = asset({ id: "wav", kind: "audio", durationMs: 1000 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<AudioClipWave clip={c} asset={a} clipWidthPx={48} envelope={envelope} />);
    });
    const svg = host.querySelector('[data-testid="clip-wave-a1"]');
    const path = svg?.querySelector("path");
    expect(path).toBeTruthy();
    expect(svg!.getAttribute("data-peak-count")).toBe("48");
    const d = path!.getAttribute("d") ?? "";
    expect(d).toMatch(/^M /);
    expect(d.endsWith("Z")).toBe(true);
    const xs = [...d.matchAll(/[ML]\s+(-?[\d.]+)/g)].map((m) => Number(m[1]));
    for (let i = 1; i < xs.length; i += 1) {
      const gap = Math.abs(xs[i]! - xs[i - 1]!);
      expect(gap === 0 || Math.abs(gap - 1) < 1e-6).toBe(true);
    }
  });

  it("re-samples to more peaks when the same clip is wider (zoom-in)", () => {
    const samples = new Float32Array(8000);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = Math.sin((i / samples.length) * 40 * Math.PI * 2);
    }
    const c = clip({ id: "a2", assetId: "wav", trackId: "A1", startMs: 0, durationMs: 5000 });
    const a = asset({ id: "wav", kind: "audio", durationMs: 400_000 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<AudioClipWave clip={c} asset={a} clipWidthPx={100} samples={samples} />);
    });
    expect(host.querySelector('[data-testid="clip-wave-a2"]')?.getAttribute("data-peak-count")).toBe(
      "100",
    );
    act(() => {
      root!.render(<AudioClipWave clip={c} asset={a} clipWidthPx={400} samples={samples} />);
    });
    expect(host.querySelector('[data-testid="clip-wave-a2"]')?.getAttribute("data-peak-count")).toBe(
      "400",
    );
  });

  it("falls back to clip fill when samples are not ready", () => {
    const c = clip({ id: "a3", assetId: "wav", trackId: "A1", startMs: 0, durationMs: 1000 });
    const a = asset({ id: "wav", kind: "audio", durationMs: 1000 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<AudioClipWave clip={c} asset={a} clipWidthPx={200} />);
    });
    expect(host.querySelector('[data-testid="clip-wave-a3"]')).toBeNull();
  });

  it("paints stubbed filmstrip thumbs along the clip", async () => {
    const c = clip({
      id: "v1",
      assetId: "vid",
      trackId: "V1",
      startMs: 0,
      durationMs: 4000,
      sourceInMs: 0,
      sourceOutMs: 4000,
    });
    const a = asset({ id: "vid", kind: "video", durationMs: 4000 });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <VideoClipStrip
          clip={c}
          asset={a}
          clipWidthPx={192}
          fetchFrame={async (timeMs) => `data:image/gif;base64,R0lGODlhAQABAAAAACw=${timeMs}`}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const strip = host.querySelector('[data-testid="clip-filmstrip-v1"]');
    expect(strip).toBeTruthy();
    expect(strip!.querySelectorAll("img").length).toBe(4);
  });
});
