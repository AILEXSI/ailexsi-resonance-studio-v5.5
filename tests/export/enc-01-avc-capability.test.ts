import { describe, expect, it } from "vitest";
import {
  AVC_BASELINE_LEVEL_3_1,
  DEFAULT_AVC_BITRATE,
  avcEncoderCandidates,
  frameMacroblocks,
  requiredAvcLevel,
  selectAvcEncoderConfig,
  type AvcSupportProbe,
} from "../../src/core/exporter/avc-capability";

const P720 = { width: 1280, height: 720, fps: 30 };
const P1080 = { width: 1920, height: 1080, fps: 30 };

function probeAllowing(codecs: string[]): AvcSupportProbe {
  const allow = new Set(codecs.map((c) => c.toLowerCase()));
  return async (config) => ({
    supported: allow.has(String(config.codec).toLowerCase()),
    config,
  });
}

describe("ENC-01 AVC encoder capability", () => {
  it("A. 720p30 still starts at Baseline Level 3.1 (avc1.42001f) and stays legal", () => {
    expect(frameMacroblocks(P720.width, P720.height)).toBe(3600);
    const level = requiredAvcLevel(P720.width, P720.height, P720.fps);
    expect(level?.label).toBe("3.1");
    const candidates = avcEncoderCandidates(P720.width, P720.height, P720.fps);
    expect(candidates[0]).toBe(AVC_BASELINE_LEVEL_3_1);
    expect(candidates[0]).toBe("avc1.42001f");
    expect(candidates).toContain("avc1.4d001f");
    expect(candidates).toContain("avc1.64001f");
  });

  it("B. 1080p30 no longer hardcodes avc1.42001f-only — Level 4.0+ candidates", () => {
    expect(frameMacroblocks(P1080.width, P1080.height)).toBe(8160);
    const level = requiredAvcLevel(P1080.width, P1080.height, P1080.fps);
    expect(level?.label).toBe("4.0");
    const candidates = avcEncoderCandidates(P1080.width, P1080.height, P1080.fps);
    expect(candidates.includes("avc1.42001f")).toBe(false);
    expect(candidates[0]).toBe("avc1.420028");
    expect(candidates).toContain("avc1.4d0028");
    expect(candidates).toContain("avc1.640028");
    expect(candidates).toContain("avc1.640029");
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates.length).toBeGreaterThan(1);
  });

  it("C. 720p selects avc1.42001f when the platform supports it", async () => {
    const selected = await selectAvcEncoderConfig(P720, probeAllowing(["avc1.42001f", "avc1.640028"]));
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.codec).toBe("avc1.42001f");
    expect(selected.config.codec).toBe("avc1.42001f");
    expect(selected.config.width).toBe(1280);
    expect(selected.config.height).toBe(720);
    expect(selected.config.framerate).toBe(30);
    expect(selected.config.bitrate).toBe(DEFAULT_AVC_BITRATE);
    expect(selected.config.avc).toEqual({ format: "avc" });
  });

  it("D. 1080p escalates off Level 3.1 to the first supported Level 4+ codec", async () => {
    const selected = await selectAvcEncoderConfig(
      P1080,
      probeAllowing(["avc1.42001f", "avc1.640028"]),
    );
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.codec).toBe("avc1.640028");
    expect(selected.config.width).toBe(1920);
    expect(selected.config.height).toBe(1080);
    expect(selected.tried[0]).toBe("avc1.420028");
    expect(selected.tried.includes("avc1.42001f")).toBe(false);
  });

  it("E. fails loudly when no H.264 config is supported — no WebM / silent skip", async () => {
    const none = await selectAvcEncoderConfig(P1080, async () => ({ supported: false }));
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.error).toMatch(/^FAIL: H\.264 encoder not supported for 1920x1080@30/);
    expect(none.error).toMatch(/tried avc1\.420028, avc1\.4d0028, avc1\.640028/);
    expect(none.error).toMatch(/WebM is not a fallback/);

    const oversized = await selectAvcEncoderConfig({ width: 7680, height: 4320, fps: 60 });
    expect(oversized.ok).toBe(false);
    if (oversized.ok) return;
    expect(oversized.tried).toEqual([]);
    expect(oversized.error).toMatch(/exceeds Level 5\.1/);
    expect(oversized.error).toMatch(/WebM is not a fallback/);
  });

  it("F. rejects a non-AVC substitution even if the probe claims support", async () => {
    const selected = await selectAvcEncoderConfig(P1080, async (config) => ({
      supported: true,
      config: { ...config, codec: "vp09.00.10.08" },
    }));
    expect(selected.ok).toBe(false);
    if (selected.ok) return;
    expect(selected.error).toMatch(/WebM is not a fallback/);
  });

  it("G. 720p still succeeds when Level 3.1 is absent by escalating to a supported codec", async () => {
    const selected = await selectAvcEncoderConfig(P720, probeAllowing(["avc1.640028"]));
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.codec).toBe("avc1.640028");
    expect(selected.tried[0]).toBe(AVC_BASELINE_LEVEL_3_1);
  });
});
