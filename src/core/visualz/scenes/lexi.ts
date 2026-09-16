/**
 * Scene: lexi — AILEXSI signature horizon flow.
 * Dark field + glowing energy line + receding terrain. Not a Lattice/Wave clone.
 * Preview and Export both read presented AudioFeatures (applyVisResponse).
 */

import { hexToRgba } from "../color";
import { cam3, project3 } from "../project3d";
import { lexiAccent, lexiGlow, lexiHorizonLift, lexiSheen } from "../scene-impact";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

/** Prepared later themes. V1 ships gold only. */
export const LEXI_THEMES = {
  gold: { colorPrimary: "#e8a33a", colorSecondary: "#07060a", accent: "#2a6a7a" },
  cyan: { colorPrimary: "#3ec8e0", colorSecondary: "#05080c", accent: "#1a3a50" },
  red: { colorPrimary: "#e05a3a", colorSecondary: "#0a0606", accent: "#4a2030" },
  green: { colorPrimary: "#6ecb5a", colorSecondary: "#060a07", accent: "#1a4030" },
  violet: { colorPrimary: "#b06cff", colorSecondary: "#08060e", accent: "#2a2060" },
} as const;

export const LEXI_DEFAULT_THEME = "gold" as const;

/** Center-safe title band (layout only — no on-screen text/logo in V1). */
export const LEXI_TITLE_SAFE = { x0: 0.3, x1: 0.7, y0: 0.36, y1: 0.5 };

const COLS = 36;
const ROWS = 10;
const MERIDIANS = 5;
const PARTICLE_CAP = 28;
const xs = new Float32Array(COLS);
const zs = new Float32Array(ROWS);
const hx = new Float32Array(COLS);
const hy = new Float32Array(COLS);
const hOk = new Uint8Array(COLS);

const DEFAULT_GOLD = LEXI_THEMES.gold;

let phase = 0;
let lastTimeMs = -1;
let sRms = 0;
let sBass = 0;
let sBeat = 0;
let primed = false;

function num(value: number | string | boolean | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash01(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function resetLexiState(): void {
  phase = 0;
  lastTimeMs = -1;
  sRms = 0;
  sBass = 0;
  sBeat = 0;
  primed = false;
}

export const lexiScene: Scene = {
  id: "lexi",
  name: "LEXI",
  description: "Cinematic horizon flow — signal, light, quiet energy",
  defaultParams: {
    intensity: 0.82,
    colorPrimary: DEFAULT_GOLD.colorPrimary,
    colorSecondary: DEFAULT_GOLD.colorSecondary,
    speed: 0.85,
    complexity: 0.48,
    glowStrength: 0.72,
    lineThickness: 0.55,
    waveAmplitude: 0.62,
    depthStrength: 0.7,
    reactivity: 0.78,
    smoothing: 0.68,
    particleAmount: 0.35,
    backgroundLevel: 0.12,
  },

  onEnter() {
    resetLexiState();
  },

  onExit() {
    resetLexiState();
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, dt: number) {
    const { ctx, width, height } = ctxWrap;
    const intensity = num(params.intensity, 0.82);
    const glowStrength = num(params.glowStrength, 0.72);
    const lineThickness = num(params.lineThickness, 0.55);
    const waveAmplitude = num(params.waveAmplitude, 0.62);
    const depthStrength = num(params.depthStrength, 0.7);
    const reactivity = num(params.reactivity, 0.78);
    const smoothing = clamp01(num(params.smoothing, 0.68));
    const particleAmount = clamp01(num(params.particleAmount, 0.35));
    const backgroundLevel = clamp01(num(params.backgroundLevel, 0.12));
    const speed = num(params.speed, 0.85);
    const primary = (params.colorPrimary as string) || DEFAULT_GOLD.colorPrimary;
    const secondary = (params.colorSecondary as string) || DEFAULT_GOLD.colorSecondary;
    const accentHex = DEFAULT_GOLD.accent;

    const jumped = lastTimeMs < 0 || features.timeMs + 1e-3 < lastTimeMs || features.timeMs - lastTimeMs > 280;
    const follow = jumped || !primed ? 1 : 1 - Math.pow(0.22 + smoothing * 0.72, Math.max(0.016, dt) * 48);
    sRms = lerp(sRms, features.rms, follow);
    sBass = lerp(sBass, features.bass, follow);
    sBeat = lerp(sBeat, features.beatPulse, follow);
    lastTimeMs = features.timeMs;
    primed = true;

    const presented: AudioFeatures = {
      ...features,
      rms: sRms,
      bass: sBass,
      beatPulse: sBeat,
    };

    const lift = lexiHorizonLift(presented, intensity) * reactivity;
    const glow = lexiGlow(presented, intensity) * reactivity;
    const accent = lexiAccent(presented) * reactivity;
    const idle = 0.22 + (1 - reactivity) * 0.08;

    phase += dt * speed * (0.32 + sRms * 0.55);

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, hexToRgba(accentHex, 0.1 + backgroundLevel * 0.08));
    sky.addColorStop(0.42, secondary);
    sky.addColorStop(1, hexToRgba(primary, 0.035 + backgroundLevel * 0.05));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const camY = 0.92 + lift * 0.18;
    const cam = cam3({
      x: Math.sin(features.timeMs * 0.00007 * speed) * 0.1,
      y: camY,
      z: -0.35,
      yaw: Math.sin(features.timeMs * 0.00005 * speed) * 0.035,
      pitch: -0.2 - depthStrength * 0.06,
      fov: 1.12,
      far: 12 + depthStrength * 3,
    });

    const zNear = 1.7;
    const zFar = 3.4 + depthStrength * 7.2;
    const xSpan = 5.6 + depthStrength * 0.8;
    const wave = waveAmplitude * (idle + glow * 0.85 + lift * 0.55);

    for (let col = 0; col < COLS; col++) {
      xs[col] = -xSpan + (2 * xSpan * col) / (COLS - 1);
    }
    for (let row = 0; row < ROWS; row++) {
      zs[row] = zNear + ((zFar - zNear) * row) / (ROWS - 1);
    }

    for (let row = ROWS - 1; row >= 0; row--) {
      const z = zs[row]!;
      const fog = 1 - row / (ROWS - 1);
      let started = false;
      ctx.beginPath();
      for (let col = 0; col < COLS; col++) {
        const x = xs[col]!;
        const t = col / (COLS - 1);
        const sheen = lexiSheen(presented, t);
        const y =
          Math.sin(x * 0.82 + z * 0.48 + phase) * wave * (0.55 + sheen * 0.4) +
          Math.sin(x * 1.65 - z * 0.9 + phase * 0.68) * wave * 0.26 +
          lift * (0.22 + fog * 0.38);
        const p = project3(x, y, z, cam, width, height);
        if (!p.ok) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      }
      const cool = hexToRgba(accentHex, (0.05 + fog * 0.1) * intensity);
      const warm = hexToRgba(primary, (0.1 + fog * 0.22 + glow * 0.12) * intensity);
      ctx.strokeStyle = row % 2 === 0 ? warm : cool;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.strokeStyle = hexToRgba(accentHex, 0.07 + glow * 0.06);
    ctx.lineWidth = 1;
    for (let m = 0; m < MERIDIANS; m++) {
      const x = -xSpan * 0.72 + ((xSpan * 1.44) * m) / (MERIDIANS - 1);
      ctx.beginPath();
      let started = false;
      for (let row = 0; row < ROWS; row++) {
        const z = zs[row]!;
        const t = 0.5;
        const sheen = lexiSheen(presented, t);
        const y =
          Math.sin(x * 0.82 + z * 0.48 + phase) * wave * (0.55 + sheen * 0.4) +
          lift * (0.18 + (1 - row / (ROWS - 1)) * 0.28);
        const p = project3(x, y, z, cam, width, height);
        if (!p.ok) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
      }
      if (started) ctx.stroke();
    }

    const horizonZ = 4.6 + depthStrength * 1.1;
    const horizonY = lift * 0.28;
    let hCount = 0;
    let hSumY = 0;
    for (let col = 0; col < COLS; col++) {
      const x = xs[col]!;
      const t = col / (COLS - 1);
      const sheen = lexiSheen(presented, t);
      const y = horizonY + Math.sin(x * 0.35 + phase * 0.4) * wave * 0.12 + sheen * 0.04;
      const p = project3(x, y, horizonZ, cam, width, height);
      hx[col] = p.x;
      hy[col] = p.y;
      hOk[col] = p.ok ? 1 : 0;
      if (!p.ok) continue;
      hSumY += p.y;
      hCount += 1;
    }
    const horizonScreenY = hCount ? hSumY / hCount : height * 0.44;
    const bloom = glowStrength * (0.45 + glow * 0.55 + accent * 0.35);
    const haze = ctx.createLinearGradient(0, horizonScreenY - height * 0.22, 0, horizonScreenY + height * 0.28);
    haze.addColorStop(0, hexToRgba(primary, 0));
    haze.addColorStop(0.45, hexToRgba(primary, 0.07 * bloom));
    haze.addColorStop(0.52, hexToRgba("#ffd27a", (0.1 + accent * 0.08) * bloom));
    haze.addColorStop(0.62, hexToRgba(primary, 0.06 * bloom));
    haze.addColorStop(1, hexToRgba(accentHex, 0));
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizonScreenY - height * 0.22, width, height * 0.5);

    const strokeHorizon = (color: string, widthPx: number) => {
      ctx.beginPath();
      let started = false;
      for (let col = 0; col < COLS; col++) {
        if (!hOk[col]) {
          started = false;
          continue;
        }
        if (!started) {
          ctx.moveTo(hx[col]!, hy[col]!);
          started = true;
        } else ctx.lineTo(hx[col]!, hy[col]!);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.stroke();
    };

    if (hCount > 1) {
      const thick = 1.2 + lineThickness * 2.4 + accent * 1.6 + glow * 0.8;
      strokeHorizon(hexToRgba(primary, 0.16 + bloom * 0.22), thick * 3.2);
      strokeHorizon(hexToRgba("#ffe6a8", 0.28 + bloom * 0.35 + accent * 0.18), thick);
      strokeHorizon(hexToRgba("#fff6df", 0.22 + accent * 0.2), Math.max(1, thick * 0.35));
    }

    const nDust = Math.round(PARTICLE_CAP * particleAmount * (0.45 + glow * 0.55));
    const safeX0 = width * LEXI_TITLE_SAFE.x0;
    const safeX1 = width * LEXI_TITLE_SAFE.x1;
    const safeY0 = height * LEXI_TITLE_SAFE.y0;
    const safeY1 = height * LEXI_TITLE_SAFE.y1;
    for (let i = 0; i < nDust; i++) {
      const a = hash01(i + 3);
      const b = hash01(i + 19);
      const drift = features.timeMs * 0.000018 * speed * (0.6 + a);
      const u = (a + drift) % 1;
      const v = 0.4 + b * 0.52;
      const x = u * width;
      const y = v * height + Math.sin(phase * 0.7 + i) * (2 + glow * 4);
      if (x > safeX0 && x < safeX1 && y > safeY0 && y < safeY1) continue;
      const alpha = (0.12 + glow * 0.18 + accent * 0.08) * intensity * (0.4 + hash01(i + 41));
      ctx.fillStyle = hexToRgba(i % 5 === 0 ? "#fff3d0" : primary, alpha);
      ctx.beginPath();
      ctx.arc(x, y, 0.7 + b * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
