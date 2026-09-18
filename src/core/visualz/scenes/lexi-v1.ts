/**
 * Scene: lexi-v1 — LEXI Flow V1 (PR #27 tip 37dfd7b).
 * Original cinematic horizon-flow: dark field + gold energy line + receding mesh.
 * Retained as a selectable library scene. Preview === Export (applyVisResponse).
 */

import { hexToRgba } from "../color";
import { cam3, project3 } from "../project3d";
import { lexiAccent, lexiGlow, lexiHorizonLift, lexiSheen } from "../scene-impact";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

/** Prepared later themes. V1 ships gold only. */
const LEXI_THEMES = {
  gold: { colorPrimary: "#e8a33a", colorSecondary: "#07060a", accent: "#2a6a7a" },
  cyan: { colorPrimary: "#3ec8e0", colorSecondary: "#05080c", accent: "#1a3a50" },
  red: { colorPrimary: "#e05a3a", colorSecondary: "#0a0606", accent: "#4a2030" },
  green: { colorPrimary: "#6ecb5a", colorSecondary: "#060a07", accent: "#1a4030" },
  violet: { colorPrimary: "#b06cff", colorSecondary: "#08060e", accent: "#2a2060" },
} as const;

/** Center-safe title band (layout only — no on-screen text/logo in V1). */
const LEXI_TITLE_SAFE = { x0: 0.3, x1: 0.7, y0: 0.36, y1: 0.5 };

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

function resetLexiV1State(): void {
  phase = 0;
  lastTimeMs = -1;
  sRms = 0;
  sBass = 0;
  sBeat = 0;
  primed = false;
}

export const lexiV1Scene: Scene = {
  id: "lexi-v1",
  name: "LEXI Flow V1",
  description: "Original V1 horizon flow — gold energy line and receding terrain",
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
    resetLexiV1State();
  },

  onExit() {
    resetLexiV1State();
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
    sky.addColorStop(0, hexToRgba(accentHex, 0.14 + backgroundLevel * 0.1));
    sky.addColorStop(0.38, secondary);
    sky.addColorStop(0.52, hexToRgba(primary, 0.04 + backgroundLevel * 0.04));
    sky.addColorStop(1, hexToRgba(primary, 0.07 + backgroundLevel * 0.08));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const camY = 0.72 + lift * 0.12;
    const cam = cam3({
      x: Math.sin(features.timeMs * 0.00007 * speed) * 0.1,
      y: camY,
      z: -0.2,
      yaw: Math.sin(features.timeMs * 0.00005 * speed) * 0.035,
      pitch: -0.28 - depthStrength * 0.05,
      fov: 1.05,
      far: 12 + depthStrength * 3,
    });

    const zNear = 1.35;
    const zFar = 3.1 + depthStrength * 6.4;
    const xSpan = 6.4 + depthStrength * 0.6;
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
      let hadPath = false;
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
          hadPath = true;
        } else ctx.lineTo(p.x, p.y);
      }
      if (!hadPath) continue;
      const cool = hexToRgba(accentHex, (0.12 + fog * 0.2) * intensity);
      const warm = hexToRgba(primary, (0.2 + fog * 0.38 + glow * 0.2) * intensity);
      ctx.strokeStyle = row % 2 === 0 ? warm : cool;
      ctx.lineWidth = 1 + fog * 0.8;
      ctx.stroke();
      ctx.lineTo(width + 8, height + 8);
      ctx.lineTo(-8, height + 8);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(row % 2 === 0 ? primary : accentHex, (0.03 + fog * 0.05 + glow * 0.03) * intensity);
      ctx.fill();
    }

    ctx.strokeStyle = hexToRgba(accentHex, 0.14 + glow * 0.1);
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

    const horizonZ = 3.8 + depthStrength * 0.8;
    const horizonY = lift * 0.22;
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
    const horizonScreenY = hCount ? hSumY / hCount : height * 0.46;
    const bloom = glowStrength * (0.55 + glow * 0.55 + accent * 0.4);
    const haze = ctx.createLinearGradient(0, horizonScreenY - height * 0.28, 0, horizonScreenY + height * 0.32);
    haze.addColorStop(0, hexToRgba(primary, 0));
    haze.addColorStop(0.42, hexToRgba(primary, 0.12 * bloom));
    haze.addColorStop(0.5, hexToRgba("#ffd27a", (0.2 + accent * 0.12) * bloom));
    haze.addColorStop(0.58, hexToRgba(primary, 0.1 * bloom));
    haze.addColorStop(1, hexToRgba(accentHex, 0.02));
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizonScreenY - height * 0.28, width, height * 0.6);

    ctx.beginPath();
    for (let x = 0; x <= width; x += 8) {
      const t = x / width;
      const sheen = lexiSheen(presented, t);
      const y =
        horizonScreenY +
        Math.sin(t * Math.PI * 2 + phase * 0.35) * (3 + wave * 10) +
        (sheen - 0.2) * 6 * reactivity;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const ribbon = 2.2 + lineThickness * 3.2 + accent * 2.2 + glow * 1.2;
    ctx.strokeStyle = hexToRgba(primary, 0.22 + bloom * 0.28);
    ctx.lineWidth = ribbon * 3.4;
    ctx.stroke();
    ctx.strokeStyle = hexToRgba("#ffe6a8", 0.42 + bloom * 0.38 + accent * 0.2);
    ctx.lineWidth = ribbon;
    ctx.stroke();
    ctx.strokeStyle = hexToRgba("#fff6df", 0.35 + accent * 0.22);
    ctx.lineWidth = Math.max(1.1, ribbon * 0.32);
    ctx.stroke();

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
      const thick = 1 + lineThickness * 1.6 + accent * 1.1 + glow * 0.5;
      strokeHorizon(hexToRgba(primary, 0.12 + bloom * 0.14), thick * 2.2);
      strokeHorizon(hexToRgba("#ffe6a8", 0.18 + bloom * 0.16), thick);
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
