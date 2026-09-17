/**
 * Scene: lexi — AILEXSI signature horizon flow (Polish V2).
 * Layered energy horizon + receding terrain + volumetric haze.
 * Preview and Export both read presented AudioFeatures (applyVisResponse).
 */

import { hexToRgba } from "../color";
import { cam3, project3 } from "../project3d";
import {
  lexiAccent,
  lexiGlow,
  lexiHorizonBody,
  lexiHorizonLift,
  lexiSheen,
  lexiTerrainSpread,
} from "../scene-impact";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

/** Prepared palettes. Default ships gold / champagne. */
export const LEXI_THEMES = {
  gold: {
    colorPrimary: "#e8a33a",
    colorSecondary: "#07060a",
    accent: "#1a3c48",
    champagne: "#ffd27a",
    highlight: "#fff4d4",
  },
  cyan: {
    colorPrimary: "#3ec8e0",
    colorSecondary: "#05080c",
    accent: "#143048",
    champagne: "#9ae8f2",
    highlight: "#e8fbff",
  },
  red: {
    colorPrimary: "#e05a3a",
    colorSecondary: "#0a0606",
    accent: "#3a1820",
    champagne: "#ffb08a",
    highlight: "#ffe8dc",
  },
  green: {
    colorPrimary: "#6ecb5a",
    colorSecondary: "#060a07",
    accent: "#163428",
    champagne: "#b8e89a",
    highlight: "#eef8e4",
  },
  violet: {
    colorPrimary: "#b06cff",
    colorSecondary: "#08060e",
    accent: "#241848",
    champagne: "#d4b0ff",
    highlight: "#f4ecff",
  },
} as const;

export type LexiThemeId = keyof typeof LEXI_THEMES;
export const LEXI_DEFAULT_THEME: LexiThemeId = "gold";

/** Center-safe title band (layout only — no on-screen text/logo). */
export const LEXI_TITLE_SAFE = { x0: 0.3, x1: 0.7, y0: 0.36, y1: 0.5 };

const MAX_COLS = 56;
const MAX_ROWS = 18;
const MAX_PLANES = 3;
const PARTICLE_CAP = 36;
const xs = new Float32Array(MAX_COLS);
const zs = new Float32Array(MAX_ROWS);
const hx = new Float32Array(MAX_COLS);
const hy = new Float32Array(MAX_COLS);
const hOk = new Uint8Array(MAX_COLS);

const DEFAULT_GOLD = LEXI_THEMES.gold;

let phase = 0;
let lastTimeMs = -1;
let sRms = 0;
let sBass = 0;
let sMid = 0;
let sTreble = 0;
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

export function isLexiThemeId(value: string): value is LexiThemeId {
  return Object.prototype.hasOwnProperty.call(LEXI_THEMES, value);
}

export function resolveLexiTheme(params: SceneParams): (typeof LEXI_THEMES)[LexiThemeId] {
  const key = typeof params.palette === "string" ? params.palette : LEXI_DEFAULT_THEME;
  return isLexiThemeId(key) ? LEXI_THEMES[key] : LEXI_THEMES[LEXI_DEFAULT_THEME];
}

function resetLexiState(): void {
  phase = 0;
  lastTimeMs = -1;
  sRms = 0;
  sBass = 0;
  sMid = 0;
  sTreble = 0;
  sBeat = 0;
  primed = false;
}

function ridgeY(
  x: number,
  z: number,
  fog: number,
  wave: number,
  lift: number,
  spread: number,
  sheen: number,
  localPhase: number,
): number {
  const freq = 0.62 + spread * 0.9;
  return (
    Math.sin(x * freq + z * 0.42 + localPhase) * wave * (0.52 + sheen * 0.38) +
    Math.sin(x * (1.45 + spread * 0.55) - z * 0.82 + localPhase * 0.66) * wave * 0.24 +
    Math.sin(x * 0.28 + z * 0.18 + localPhase * 0.31) * wave * 0.14 +
    lift * (0.2 + fog * 0.4)
  );
}

function strokePoly(
  ctx: CanvasRenderingContext2D,
  count: number,
  color: string,
  widthPx: number,
): boolean {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < count; i++) {
    if (!hOk[i]) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(hx[i]!, hy[i]!);
      started = true;
    } else ctx.lineTo(hx[i]!, hy[i]!);
  }
  if (!started) return false;
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx;
  ctx.stroke();
  return true;
}

export const lexiScene: Scene = {
  id: "lexi",
  name: "LEXI",
  description: "Cinematic horizon flow — signal, light, quiet energy",
  defaultParams: {
    intensity: 0.82,
    colorPrimary: DEFAULT_GOLD.colorPrimary,
    colorSecondary: DEFAULT_GOLD.colorSecondary,
    speed: 0.82,
    complexity: 0.52,
    glowStrength: 0.76,
    lineThickness: 0.58,
    waveAmplitude: 0.64,
    depthStrength: 0.74,
    reactivity: 0.8,
    smoothing: 0.7,
    particleAmount: 0.32,
    backgroundLevel: 0.14,
    palette: LEXI_DEFAULT_THEME,
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
    const glowStrength = num(params.glowStrength, 0.76);
    const lineThickness = num(params.lineThickness, 0.58);
    const waveAmplitude = num(params.waveAmplitude, 0.64);
    const depthStrength = num(params.depthStrength, 0.74);
    const reactivity = num(params.reactivity, 0.8);
    const smoothing = clamp01(num(params.smoothing, 0.7));
    const particleAmount = clamp01(num(params.particleAmount, 0.32));
    const backgroundLevel = clamp01(num(params.backgroundLevel, 0.14));
    const speed = num(params.speed, 0.82);
    const complexity = clamp01(num(params.complexity, 0.52));
    const theme = resolveLexiTheme(params);
    const primary = (params.colorPrimary as string) || theme.colorPrimary;
    const secondary = (params.colorSecondary as string) || theme.colorSecondary;
    const accentHex = theme.accent;
    const champagne = theme.champagne;
    const highlight = theme.highlight;

    const jumped = lastTimeMs < 0 || features.timeMs + 1e-3 < lastTimeMs || features.timeMs - lastTimeMs > 280;
    const follow = jumped || !primed ? 1 : 1 - Math.pow(0.22 + smoothing * 0.72, Math.max(0.016, dt) * 48);
    sRms = lerp(sRms, features.rms, follow);
    sBass = lerp(sBass, features.bass, follow);
    sMid = lerp(sMid, features.mid, follow);
    sTreble = lerp(sTreble, features.treble, follow);
    sBeat = lerp(sBeat, features.beatPulse, follow);
    lastTimeMs = features.timeMs;
    primed = true;

    const presented: AudioFeatures = {
      ...features,
      rms: sRms,
      bass: sBass,
      mid: sMid,
      treble: sTreble,
      beatPulse: sBeat,
    };

    const lift = lexiHorizonLift(presented, intensity) * reactivity;
    const glow = lexiGlow(presented, intensity) * reactivity;
    const accent = lexiAccent(presented) * reactivity;
    const body = lexiHorizonBody(presented, intensity) * reactivity;
    const spread = lexiTerrainSpread(presented, intensity) * reactivity;
    const idle = 0.2 + (1 - reactivity) * 0.1;
    const shimmer = clamp01(sTreble * 0.7 + glow * 0.12) * reactivity;

    phase += dt * speed * (0.26 + sRms * 0.48 + idle * 0.08);
    const drift = features.timeMs * 0.000037 * speed;

    const cols = Math.max(28, Math.min(MAX_COLS, 28 + Math.round(complexity * 28)));
    const rows = Math.max(9, Math.min(MAX_ROWS, 9 + Math.round(complexity * 9)));

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, hexToRgba(accentHex, 0.2 + backgroundLevel * 0.12));
    sky.addColorStop(0.28, hexToRgba(secondary, 0.96));
    sky.addColorStop(0.46, secondary);
    sky.addColorStop(0.52, hexToRgba(primary, 0.05 + backgroundLevel * 0.05 + glow * 0.03));
    sky.addColorStop(0.72, hexToRgba(accentHex, 0.05 + backgroundLevel * 0.04));
    sky.addColorStop(1, hexToRgba(primary, 0.08 + backgroundLevel * 0.09 + body * 0.04));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const camY = 0.62 + lift * 0.1;
    const cam = cam3({
      x: Math.sin(features.timeMs * 0.000055 * speed) * 0.11 * (0.45 + depthStrength),
      y: camY,
      z: -0.32,
      yaw: Math.sin(features.timeMs * 0.000041 * speed) * 0.03 * (0.4 + depthStrength),
      pitch: -0.24 - depthStrength * 0.045,
      fov: 1.04,
      far: 13 + depthStrength * 3.4,
    });

    const zNear = 1.22;
    const zFar = 3.25 + depthStrength * 6.8;
    const xSpan = 6.6 + depthStrength * 0.7 + spread * 0.45;
    const wave = waveAmplitude * (idle + glow * 0.82 + lift * 0.5 + body * 0.18);

    for (let col = 0; col < cols; col++) {
      xs[col] = -xSpan + (2 * xSpan * col) / (cols - 1);
    }
    for (let row = 0; row < rows; row++) {
      zs[row] = zNear + ((zFar - zNear) * row) / (rows - 1);
    }

    for (let row = rows - 1; row >= 0; row--) {
      const z = zs[row]!;
      const fog = 1 - row / (rows - 1);
      const rowPhase = phase * (0.42 + fog * 0.58) + drift * (0.35 + fog * 0.4);
      let started = false;
      let hadPath = false;
      ctx.beginPath();
      for (let col = 0; col < cols; col++) {
        const x = xs[col]!;
        const t = col / (cols - 1);
        const sheen = lexiSheen(presented, t);
        const y = ridgeY(x, z, fog, wave, lift, spread, sheen, rowPhase);
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
      const warmA = (0.16 + fog * 0.36 + glow * 0.16 + body * 0.08) * intensity;
      const coolA = (0.08 + fog * 0.16 + glow * 0.06) * intensity;
      ctx.strokeStyle = hexToRgba(row % 2 === 0 ? primary : accentHex, row % 2 === 0 ? warmA : coolA);
      ctx.lineWidth = 0.85 + fog * (1.15 + body * 0.7) * (0.7 + lineThickness * 0.5);
      ctx.stroke();
      ctx.lineTo(width + 8, height + 8);
      ctx.lineTo(-8, height + 8);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(
        row % 2 === 0 ? primary : accentHex,
        (0.028 + fog * 0.055 + glow * 0.03 + body * 0.035) * intensity,
      );
      ctx.fill();
    }

    const traces = 3;
    ctx.lineWidth = 1;
    for (let m = 0; m < traces; m++) {
      const x = -xSpan * 0.42 + ((xSpan * 0.84) * m) / (traces - 1);
      ctx.beginPath();
      let started = false;
      for (let row = 0; row < rows; row++) {
        const z = zs[row]!;
        const fog = 1 - row / (rows - 1);
        const rowPhase = phase * (0.42 + fog * 0.58);
        const y = ridgeY(x, z, fog, wave * 0.72, lift, spread, 0.16, rowPhase);
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
      if (started) {
        ctx.strokeStyle = hexToRgba(accentHex, (0.06 + glow * 0.05) * intensity);
        ctx.stroke();
      }
    }

    const horizonZ = 4.05 + depthStrength * 0.85;
    let hCount = 0;
    let hSumY = 0;
    const horizonPhase = phase * 0.38 + drift * 0.55;
    for (let col = 0; col < cols; col++) {
      const x = xs[col]!;
      const t = col / (cols - 1);
      const sheen = lexiSheen(presented, t);
      const y =
        lift * 0.2 +
        Math.sin(x * 0.32 + horizonPhase) * wave * 0.1 +
        (sheen - 0.18) * 0.05 +
        shimmer * Math.sin(x * 2.4 + phase * 1.1) * 0.03;
      const p = project3(x, y, horizonZ, cam, width, height);
      hx[col] = p.x;
      hy[col] = p.y;
      hOk[col] = p.ok ? 1 : 0;
      if (!p.ok) continue;
      hSumY += p.y;
      hCount += 1;
    }
    const horizonScreenY = hCount ? hSumY / hCount : height * 0.47;
    const bloom = glowStrength * (0.52 + glow * 0.5 + accent * 0.42 + body * 0.12);
    const hazeH = height * (0.3 + depthStrength * 0.06);

    for (let plane = 0; plane < MAX_PLANES; plane++) {
      const u = plane / (MAX_PLANES - 1);
      const y0 = horizonScreenY - hazeH * (0.72 - u * 0.28) + Math.sin(drift * 2.1 + plane) * (3 + depthStrength * 4);
      const band = ctx.createLinearGradient(0, y0, 0, y0 + hazeH * 0.7);
      const a = (0.035 + (1 - u) * 0.04 + glow * 0.03) * bloom * intensity;
      band.addColorStop(0, hexToRgba(plane % 2 === 0 ? primary : accentHex, 0));
      band.addColorStop(0.5, hexToRgba(plane % 2 === 0 ? champagne : accentHex, a));
      band.addColorStop(1, hexToRgba(secondary, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, y0, width, hazeH * 0.7);
    }

    const haze = ctx.createLinearGradient(0, horizonScreenY - hazeH, 0, horizonScreenY + hazeH * 1.15);
    haze.addColorStop(0, hexToRgba(primary, 0));
    haze.addColorStop(0.4, hexToRgba(primary, 0.1 * bloom));
    haze.addColorStop(0.5, hexToRgba(champagne, (0.2 + accent * 0.14 + body * 0.06) * bloom));
    haze.addColorStop(0.6, hexToRgba(primary, 0.09 * bloom));
    haze.addColorStop(1, hexToRgba(accentHex, 0.025));
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizonScreenY - hazeH, width, hazeH * 2.15);

    const radial = ctx.createRadialGradient(
      width * 0.5,
      horizonScreenY,
      width * 0.02,
      width * 0.5,
      horizonScreenY,
      width * (0.42 + glow * 0.1),
    );
    radial.addColorStop(0, hexToRgba(highlight, (0.16 + accent * 0.14 + glow * 0.08) * bloom));
    radial.addColorStop(0.35, hexToRgba(champagne, (0.08 + accent * 0.06) * bloom));
    radial.addColorStop(1, hexToRgba(primary, 0));
    ctx.fillStyle = radial;
    ctx.fillRect(0, horizonScreenY - height * 0.22, width, height * 0.44);

    const ground = ctx.createLinearGradient(0, horizonScreenY, 0, height);
    ground.addColorStop(0, hexToRgba(primary, (0.05 + body * 0.05 + glow * 0.03) * intensity));
    ground.addColorStop(0.45, hexToRgba(accentHex, 0.025 * intensity));
    ground.addColorStop(1, hexToRgba(secondary, 0));
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizonScreenY, width, height - horizonScreenY);

    const step = Math.max(4, Math.round(width / 96));
    const ribbonAmp = 2.4 + wave * 9 + shimmer * 4;
    const drawRibbon = (amp: number, yOff: number, localPhase: number, color: string, widthPx: number) => {
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        const t = x / width;
        const sheen = lexiSheen(presented, t);
        const y =
          horizonScreenY +
          yOff +
          Math.sin(t * Math.PI * 2 + localPhase) * amp +
          Math.sin(t * Math.PI * 4.2 + localPhase * 1.15) * amp * 0.18 +
          (sheen - 0.2) * (5 + shimmer * 4) * reactivity;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.stroke();
    };

    const core = 2.1 + lineThickness * 3.1 + body * 2.4 + accent * 2.6 + glow * 0.9;
    drawRibbon(
      ribbonAmp * 0.72,
      -height * 0.012,
      phase * 0.28 + drift,
      hexToRgba(accentHex, 0.1 + glow * 0.08),
      Math.max(1, core * 0.7),
    );
    drawRibbon(
      ribbonAmp * 0.88,
      height * 0.01,
      phase * 0.33 + 0.7,
      hexToRgba(primary, 0.12 + bloom * 0.1),
      Math.max(1, core * 0.85),
    );
    drawRibbon(ribbonAmp, 0, phase * 0.35, hexToRgba(primary, 0.2 + bloom * 0.26), core * 3.2);
    drawRibbon(ribbonAmp, 0, phase * 0.35, hexToRgba(champagne, 0.4 + bloom * 0.36 + accent * 0.18), core);
    drawRibbon(
      ribbonAmp,
      0,
      phase * 0.35,
      hexToRgba(highlight, 0.32 + accent * 0.2 + shimmer * 0.12),
      Math.max(1.05, core * 0.3),
    );

    if (hCount > 1) {
      const thick = 1 + lineThickness * 1.35 + body * 0.9 + accent * 0.85;
      strokePoly(ctx, cols, hexToRgba(primary, 0.1 + bloom * 0.1), thick * 2);
      strokePoly(ctx, cols, hexToRgba(champagne, 0.16 + bloom * 0.14), thick);
    }

    const nDust = Math.round(PARTICLE_CAP * particleAmount * (0.4 + glow * 0.5 + shimmer * 0.2));
    const safeX0 = width * LEXI_TITLE_SAFE.x0;
    const safeX1 = width * LEXI_TITLE_SAFE.x1;
    const safeY0 = height * LEXI_TITLE_SAFE.y0;
    const safeY1 = height * LEXI_TITLE_SAFE.y1;
    for (let i = 0; i < nDust; i++) {
      const a = hash01(i + 3);
      const b = hash01(i + 19);
      const layer = hash01(i + 71);
      const driftU = features.timeMs * 0.000014 * speed * (0.35 + a + layer * 0.4);
      const u = (a + driftU) % 1;
      const v = 0.18 + b * 0.7;
      const x = u * width + Math.sin(phase * 0.35 + i) * (1.5 + depthStrength * 2);
      const y = v * height + Math.sin(phase * 0.55 + i * 0.7) * (1.6 + glow * 3.2);
      if (x > safeX0 && x < safeX1 && y > safeY0 && y < safeY1) continue;
      const far = v < 0.42;
      const alpha = (0.08 + glow * 0.14 + accent * 0.06 + shimmer * 0.05) * intensity * (0.35 + hash01(i + 41));
      ctx.fillStyle = hexToRgba(i % 6 === 0 ? highlight : far ? champagne : primary, alpha);
      ctx.beginPath();
      ctx.arc(x, y, 0.55 + b * (far ? 0.8 : 1.15), 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
