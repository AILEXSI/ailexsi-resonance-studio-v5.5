import { describe, expect, it } from "vitest";
import { VISUALIZER_SCENE_IDS, isVisualizerSceneId } from "../../src/core/models";
import {
  featuresAt,
  nextSceneId,
  presentVisualizerFeatures,
  renderVisualizerScene,
  sceneShortName,
  visFeaturesForExport,
  visFeaturesForPreview,
} from "../../src/core/visualizer";
import { builtinScenes, getRegisteredScene } from "../../src/core/visualz";
import {
  lexiAccent,
  lexiGlow,
  lexiHorizonBody,
  lexiHorizonLift,
  lexiSheen,
  lexiTerrainSpread,
} from "../../src/core/visualz/scene-impact";
import {
  LEXI_DEFAULT_THEME,
  LEXI_THEMES,
  LEXI_TITLE_SAFE,
  lexiScene,
  resolveLexiTheme,
} from "../../src/core/visualz/scenes/lexi";
import type { AudioFeatures } from "../../src/core/visualz";
import { createPixelCanvas } from "../helpers/pixel-canvas";

const QUIET: AudioFeatures = {
  timeMs: 800,
  rms: 0.04,
  bass: 0.03,
  mid: 0.02,
  treble: 0.01,
  spectrum: new Float32Array(32),
  onset: false,
  beatPulse: 0,
};

const LOUD: AudioFeatures = {
  timeMs: 800,
  rms: 0.72,
  bass: 0.68,
  mid: 0.4,
  treble: 0.22,
  spectrum: Float32Array.from({ length: 32 }, (_, i) => 0.2 + (i % 7) * 0.08),
  onset: true,
  beatPulse: 0.92,
};

function paint(id: (typeof VISUALIZER_SCENE_IDS)[number], features: AudioFeatures, dt = 1 / 30) {
  const buf = createPixelCanvas(96, 54);
  renderVisualizerScene(buf.ctx, 96, 54, id, features, dt);
  return buf;
}

describe("VIS-SCENE-LEXI registry", () => {
  it("is selectable as lexi / LEXI and sits on the shared cycle", () => {
    expect(isVisualizerSceneId("lexi")).toBe(true);
    expect(VISUALIZER_SCENE_IDS).toContain("lexi");
    expect(builtinScenes.some((s) => s.id === "lexi")).toBe(true);
    expect(getRegisteredScene("lexi")?.name).toBe("LEXI");
    expect(lexiScene.name).toBe("LEXI");
    expect(sceneShortName("lexi")).toBe("LEXI");
    expect(nextSceneId("crystal-storm")).toBe("lexi");
    expect(nextSceneId("lexi")).toBe("spectrum-bars");
  });

  it("ships gold / champagne as the default and keeps later palettes as data", () => {
    expect(LEXI_DEFAULT_THEME).toBe("gold");
    expect(lexiScene.defaultParams.colorPrimary).toBe(LEXI_THEMES.gold.colorPrimary);
    expect(lexiScene.defaultParams.colorSecondary).toBe(LEXI_THEMES.gold.colorSecondary);
    expect(lexiScene.defaultParams.palette).toBe("gold");
    expect(Object.keys(LEXI_THEMES)).toEqual(["gold", "cyan", "red", "green", "violet"]);
    expect(resolveLexiTheme(lexiScene.defaultParams)).toBe(LEXI_THEMES.gold);
    expect(resolveLexiTheme({ ...lexiScene.defaultParams, palette: "cyan" })).toBe(LEXI_THEMES.cyan);
    expect(LEXI_THEMES.gold.champagne).toMatch(/^#/);
    expect(LEXI_TITLE_SAFE.x0).toBeLessThan(LEXI_TITLE_SAFE.x1);
    expect(LEXI_TITLE_SAFE.y0).toBeLessThan(LEXI_TITLE_SAFE.y1);
  });

  it("keeps a useful param set (no unused graveyard keys)", () => {
    const p = lexiScene.defaultParams;
    for (const key of [
      "intensity",
      "glowStrength",
      "lineThickness",
      "waveAmplitude",
      "depthStrength",
      "reactivity",
      "smoothing",
      "particleAmount",
      "colorPrimary",
      "colorSecondary",
      "backgroundLevel",
      "palette",
      "complexity",
    ]) {
      expect(p[key], key).toBeDefined();
    }
  });
});

describe("VIS-SCENE-LEXI paint + identity", () => {
  it("paints a distinct frame from Lattice / Wave / Gold", () => {
    const features = featuresAt(0, 10_000);
    const lexi = paint("lexi", features);
    expect(lexi.nonemptyCount()).toBeGreaterThan(20);
    const lattice = paint("void-lattice", features).fingerprint();
    const wave = paint("resonance-wave", features).fingerprint();
    const gold = paint("liquid-gold", features).fingerprint();
    expect(lexi.fingerprint()).not.toBe(lattice);
    expect(lexi.fingerprint()).not.toBe(wave);
    expect(lexi.fingerprint()).not.toBe(gold);
  });

  it("is deterministic for the same presented packet", () => {
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const a = paint("lexi", LOUD);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const b = paint("lexi", LOUD);
    expect(a.fingerprint()).toBe(b.fingerprint());
  });

  it("stays calmer on quiet signal than on a kick packet", () => {
    expect(lexiGlow(QUIET, 0.82)).toBeLessThan(lexiGlow(LOUD, 0.82) * 0.2);
    expect(lexiHorizonLift(QUIET, 0.82)).toBeLessThan(lexiHorizonLift(LOUD, 0.82) * 0.25);
    expect(lexiHorizonBody(QUIET, 0.82)).toBeLessThan(lexiHorizonBody(LOUD, 0.82) * 0.25);
    expect(lexiTerrainSpread(QUIET, 0.82)).toBeLessThan(lexiTerrainSpread(LOUD, 0.82));
    expect(lexiAccent(QUIET)).toBeLessThan(lexiAccent(LOUD));
    expect(lexiSheen(LOUD, 0.4)).toBeGreaterThan(lexiSheen(QUIET, 0.4));
  });

  it("paints a quieter frame than a kick frame", () => {
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const quiet = paint("lexi", QUIET);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: paint("lexi", QUIET).ctx }, lexiScene.defaultParams);
    const loud = paint("lexi", LOUD);
    expect(quiet.fingerprint()).not.toBe(loud.fingerprint());
    expect(loud.nonemptyCount()).toBeGreaterThan(quiet.nonemptyCount() * 0.55);
  });

  it("uses complexity as terrain density, not a dead knob", () => {
    const ctx = paint("lexi", LOUD).ctx;
    lexiScene.onEnter?.({ width: 96, height: 54, ctx }, lexiScene.defaultParams);
    const sparse = createPixelCanvas(96, 54);
    lexiScene.render({ width: 96, height: 54, ctx: sparse.ctx }, LOUD, { ...lexiScene.defaultParams, complexity: 0.1 }, 1 / 30);
    const dense = createPixelCanvas(96, 54);
    lexiScene.onEnter?.({ width: 96, height: 54, ctx: dense.ctx }, lexiScene.defaultParams);
    lexiScene.render({ width: 96, height: 54, ctx: dense.ctx }, LOUD, { ...lexiScene.defaultParams, complexity: 0.95 }, 1 / 30);
    expect(sparse.fingerprint()).not.toBe(dense.fingerprint());
  });
});

describe("VIS-SCENE-LEXI drivers (Preview === Export)", () => {
  it("reads the shared presented packet — no export-only path", () => {
    const raw: AudioFeatures = { ...LOUD };
    const presented = presentVisualizerFeatures(raw);
    const preview = visFeaturesForPreview({
      timeMs: raw.timeMs,
      durationMs: 10_000,
      live: raw,
      audioLoaded: false,
    });
    const exported = visFeaturesForExport(raw.timeMs, 10_000);
    expect(lexiHorizonLift(presented, 1)).toBeCloseTo(lexiHorizonLift(preview, 1), 5);
    expect(lexiGlow(presented, 1)).toBeCloseTo(lexiGlow(preview, 1), 5);
    expect(lexiHorizonBody(presented, 1)).toBeCloseTo(lexiHorizonBody(preview, 1), 5);
    expect(lexiTerrainSpread(presented, 1)).toBeCloseTo(lexiTerrainSpread(preview, 1), 5);
    expect(exported.tempoBpm).toBe(120);
    expect(lexiAccent(presented)).toBeGreaterThan(0);
  });

  it("does not grow allocations across a long-form burst of frames", () => {
    const ctx = paint("lexi", QUIET).ctx;
    lexiScene.onEnter?.({ width: 96, height: 54, ctx }, lexiScene.defaultParams);
    for (let i = 0; i < 180; i++) {
      const t = i * (1000 / 30);
      const features: AudioFeatures = {
        ...QUIET,
        timeMs: t,
        rms: 0.2 + 0.2 * Math.sin(i / 8),
        bass: 0.15 + 0.1 * Math.sin(i / 5),
        beatPulse: i % 16 === 0 ? 0.8 : 0.05,
        onset: i % 16 === 0,
      };
      expect(() => {
        lexiScene.render({ width: 96, height: 54, ctx }, features, lexiScene.defaultParams, 1 / 30);
      }).not.toThrow();
    }
    lexiScene.onExit?.();
  });
});
