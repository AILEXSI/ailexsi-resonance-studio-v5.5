/**
 * Scene: lexi-ref — LEXI Ref-Level (PR #31 tip 38df270).
 * Exact reference-level particle-dune snapshot before the family flagship polish.
 * Retained as a selectable library scene. Preview === Export (applyVisResponse).
 */

import { hexToRgba } from "../color";
import { cam3, project3 } from "../project3d";
import {
  lexiAccent,
  lexiAmbientExpand,
  lexiFormShift,
  lexiGlow,
  lexiHighlightBloom,
  lexiHorizonBody,
  lexiHorizonLift,
  lexiPeakBias,
  lexiPressureWave,
  lexiRibbonWidth,
  lexiSheen,
  lexiTerrainSpread,
  lexiTransientFlash,
} from "../scene-impact";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";
import {
  LEXI_DEFAULT_THEME,
  LEXI_REFLECT,
  LEXI_THEMES,
  LEXI_TITLE_SAFE,
  resolveLexiTheme,
} from "./lexi-theme";

/** FG / MG / BG. Visible depth stack, not a flat horizon wash. */
const LEXI_V3_DEPTH_PLANES = 3;
/** Supporting mid-ground energy filaments (hero stream is separate). */
const LEXI_V3_LIGHT_BANDS = 3;
const LEXI_2036_FG_TRACES = 4;
const LEXI_2036_SIGNAL_TOWERS = 8;
/** Reference-level density — particle dunes, not sparse meridians. */
const LEXI_REF_DUNE_MERIDIANS = 58;
const LEXI_REF_DUNE_CONTOURS = 14;
const LEXI_REF_SURFACE_POINTS = 720;
const LEXI_REF_MOUNTAIN_PEAKS = 9;
const LEXI_REF_FG_BOKEH = 22;
const LEXI_REF_SKY_ARC = 1;

const MAX_MERIDIANS = 72;
const MAX_CONTOURS = 20;
const MAX_ALONG = 48;
const MAX_RIBBON = 80;
const MAX_TRACE = 48;
const MAX_STROKE = 80;
const MAX_TOWERS = 10;
const MAX_SURFACE = 640;
const MAX_BOKEH = 28;
const MAX_MOUNTAIN = 12;
const PARTICLE_CAP = 220;

const zs = new Float32Array(MAX_CONTOURS);
const px = new Float32Array(MAX_STROKE);
const py = new Float32Array(MAX_STROKE);
const pok = new Uint8Array(MAX_STROKE);
const mtX = new Float32Array(MAX_MOUNTAIN);
const mtY = new Float32Array(MAX_MOUNTAIN);
const mtH = new Float32Array(MAX_MOUNTAIN);

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

function resetLexiRefState(): void {
  phase = 0;
  lastTimeMs = -1;
  sRms = 0;
  sBass = 0;
  sMid = 0;
  sTreble = 0;
  sBeat = 0;
  primed = false;
}

function planeOf(u: number): 0 | 1 | 2 {
  if (u < 0.28) return 0;
  if (u < 0.66) return 1;
  return 2;
}

/** Screen-space dune lift. nx = -1..1, u = 0 near .. 1 far. */
function duneLift(
  nx: number,
  u: number,
  lift: number,
  body: number,
  form: number,
  spread: number,
  waveAmp: number,
  accent: number,
  peakX: number,
  localPhase: number,
): number {
  const near = 1 - u;
  const rolling =
    Math.sin(nx * (1.85 + spread * 0.55) + u * 3.15 + localPhase * 0.16) * (0.34 + form * 0.48) +
    Math.sin(nx * 0.92 - u * 1.45 + localPhase * 0.07) * (0.16 + form * 0.2) +
    Math.sin(nx * 3.15 + u * 4.6 + localPhase * 0.28) * waveAmp * 0.14 * near;
  const dx = nx - peakX * 0.2;
  const crest = form * Math.exp(-(dx * dx * 2.8 + (u - 0.26) * (u - 0.26) * 7.2)) * (0.78 + lift * 0.22);
  const crest2 = form * 0.4 * Math.exp(-((nx + 0.46) * (nx + 0.46) * 3.6 + (u - 0.36) * (u - 0.36) * 6.4));
  const kick = accent * near * 0.09 * Math.cos(u * 9.5);
  return rolling + crest + crest2 + lift * 0.24 * near + body * 0.14 * near + kick;
}

function terrainY(
  x: number,
  z: number,
  zNear: number,
  zFar: number,
  lift: number,
  body: number,
  form: number,
  spread: number,
  waveAmp: number,
  accent: number,
  peakX: number,
  peakZ: number,
  localPhase: number,
): number {
  const span = Math.max(0.001, zFar - zNear);
  const u = clamp01((z - zNear) / span);
  const nx = x / 5.2;
  return duneLift(nx, u, lift, body, form, spread, waveAmp, accent, peakX, localPhase) * 0.72 +
    form * Math.exp(-((x - peakX) * (x - peakX) * 0.42 + (z - peakZ) * (z - peakZ) * 0.12)) * 0.22;
}

function strokeProjected(
  ctx: CanvasRenderingContext2D,
  count: number,
  color: string,
  widthPx: number,
): boolean {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < count; i++) {
    if (!pok[i]) {
      started = false;
      continue;
    }
    if (!started) {
      ctx.moveTo(px[i]!, py[i]!);
      started = true;
    } else ctx.lineTo(px[i]!, py[i]!);
  }
  if (!started) return false;
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx;
  ctx.stroke();
  return true;
}

function stampDots(
  ctx: CanvasRenderingContext2D,
  count: number,
  color: string,
  sizePx: number,
  stride: number,
): void {
  ctx.fillStyle = color;
  const s = Math.max(0.7, sizePx);
  const step = Math.max(1, stride | 0);
  for (let i = 0; i < count; i += step) {
    if (!pok[i]) continue;
    ctx.fillRect(px[i]! - s * 0.5, py[i]! - s * 0.5, s, s);
  }
}

function setDash(ctx: CanvasRenderingContext2D, dash: number, gap: number): void {
  const anyCtx = ctx as CanvasRenderingContext2D & { setLineDash?: (s: number[]) => void };
  if (typeof anyCtx.setLineDash === "function") anyCtx.setLineDash(dash > 0 ? [dash, gap] : []);
}

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

export const lexiRefScene: Scene = {
  id: "lexi-ref",
  name: "LEXI Ref-Level",
  description: "Reference-level particle dunes — dense meridians, silk stream, atmospheric depth",
  defaultParams: {
    intensity: 0.86,
    colorPrimary: DEFAULT_GOLD.colorPrimary,
    colorSecondary: DEFAULT_GOLD.colorSecondary,
    speed: 0.62,
    complexity: 0.64,
    glowStrength: 0.52,
    lineThickness: 0.58,
    waveAmplitude: 0.72,
    depthStrength: 0.9,
    reactivity: 0.84,
    smoothing: 0.72,
    particleAmount: 0.55,
    backgroundLevel: 0.07,
    palette: LEXI_DEFAULT_THEME,
  },

  onEnter() {
    resetLexiRefState();
  },

  onExit() {
    resetLexiRefState();
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, dt: number) {
    const { ctx, width, height } = ctxWrap;
    const intensity = num(params.intensity, 0.86);
    const glowStrength = num(params.glowStrength, 0.52);
    const lineThickness = num(params.lineThickness, 0.58);
    const waveAmplitude = num(params.waveAmplitude, 0.72);
    const depthStrength = num(params.depthStrength, 0.9);
    const reactivity = num(params.reactivity, 0.84);
    const smoothing = clamp01(num(params.smoothing, 0.72));
    const particleAmount = clamp01(num(params.particleAmount, 0.55));
    const backgroundLevel = clamp01(num(params.backgroundLevel, 0.07));
    const speed = num(params.speed, 0.62);
    const complexity = clamp01(num(params.complexity, 0.64));
    const theme = resolveLexiTheme(params);
    const primary = (params.colorPrimary as string) || theme.colorPrimary;
    const secondary = (params.colorSecondary as string) || theme.colorSecondary;
    const accentHex = theme.accent;
    const champagne = theme.champagne;
    const highlight = theme.highlight;
    const cool = LEXI_REFLECT.cyan;
    const rose = LEXI_REFLECT.magenta;

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
    const form = lexiFormShift(presented, intensity) * reactivity;
    const pressure = lexiPressureWave(presented) * reactivity;
    const bloom = lexiHighlightBloom(presented, intensity) * glowStrength * reactivity;
    const ambient = lexiAmbientExpand(presented, intensity) * reactivity;
    const ribbonW = lexiRibbonWidth(presented, intensity) * reactivity;
    const flash = lexiTransientFlash(presented) * reactivity;
    const idle = 0.1 + (1 - reactivity) * 0.08;
    const shimmer = clamp01(sTreble * 0.88) * reactivity;
    const presence = 0.22 + glow * 0.42 + body * 0.2 + ambient * 0.16 + idle * 0.2;

    phase += dt * speed * (0.11 + sRms * 0.2 + idle * 0.04);
    const tMs = features.timeMs;
    const peakX = lexiPeakBias(tMs, speed);
    const peakZ = 3.05 + Math.sin(tMs * 0.000055 * speed) * 0.24;
    const peakN = peakX / 5.2;

    const meridians = Math.max(
      40,
      Math.min(MAX_MERIDIANS, LEXI_REF_DUNE_MERIDIANS - 6 + Math.round(complexity * 18)),
    );
    const contours = Math.max(
      10,
      Math.min(MAX_CONTOURS, LEXI_REF_DUNE_CONTOURS - 2 + Math.round(complexity * 8)),
    );
    const along = Math.max(22, Math.min(MAX_ALONG, 24 + Math.round(complexity * 20)));
    const ribN = Math.max(32, Math.min(MAX_RIBBON, 36 + Math.round(complexity * 28)));
    const towers = Math.max(6, Math.min(MAX_TOWERS, LEXI_2036_SIGNAL_TOWERS - 2 + Math.round(complexity * 4)));
    const mountains = Math.max(6, Math.min(MAX_MOUNTAIN, LEXI_REF_MOUNTAIN_PEAKS - 1 + Math.round(complexity * 4)));

    ctx.fillStyle = secondary;
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, hexToRgba(cool, 0.028 + backgroundLevel * 0.03 + ambient * 0.02));
    sky.addColorStop(0.28, hexToRgba(secondary, 1));
    sky.addColorStop(0.46, secondary);
    sky.addColorStop(0.55, hexToRgba(primary, 0.008 + backgroundLevel * 0.01));
    sky.addColorStop(1, hexToRgba(secondary, 1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const cam = cam3({
      x: Math.sin(tMs * 0.000016 * speed) * 0.14 * (0.45 + depthStrength),
      y: 0.92 + lift * 0.14 + body * 0.04,
      z: -0.22 + Math.sin(tMs * 0.000012 * speed) * 0.03,
      yaw: Math.sin(tMs * 0.000014 * speed) * 0.02 * (0.45 + depthStrength),
      pitch: -0.28 - depthStrength * 0.015 + lift * 0.008,
      fov: 1.08,
      far: 16 + depthStrength * 2,
    });

    const zNear = 0.92;
    const zFar = 12.8 + depthStrength * 1.8;
    const xSpan = 5.35 + depthStrength * 0.5;
    const waveAmp = waveAmplitude * (idle + form * 0.3 + lift * 0.18);

    const worldX = (col: number, uNear: number) => {
      const raw = -xSpan + (2 * xSpan * col) / Math.max(1, meridians - 1);
      return raw * (1 + spread * 0.32 * uNear);
    };

    const sampleY = (x: number, z: number) =>
      terrainY(x, z, zNear, zFar, lift, body, form, spread, waveAmp, accent, peakX, peakZ, phase);

    let vpX = width * 0.5 + cam.x * width * 0.012;
    let vpY = height * 0.4;
    const vp = project3(0, 0.04, zFar, cam, width, height);
    if (vp.ok) {
      vpX = vp.x;
      vpY = vp.y;
    }

    let peakSx = width * 0.58;
    let peakSy = height * 0.48;
    const peakP = project3(peakX, sampleY(peakX, peakZ) + 0.08, peakZ, cam, width, height);
    if (peakP.ok) {
      peakSx = peakP.x;
      peakSy = peakP.y;
    }

    let horizonY = vpY;
    let hCount = 0;
    let hSum = 0;
    for (let col = 0; col < meridians; col += 3) {
      const x = worldX(col, 0.3);
      const p = project3(x, sampleY(x, 4.4), 4.4, cam, width, height);
      if (!p.ok) continue;
      hSum += p.y;
      hCount += 1;
    }
    if (hCount) horizonY = hSum / hCount;
    horizonY = finite(lerp(horizonY, height * 0.4, 0.35), height * 0.4);
    vpX = finite(vpX, width * 0.5);
    vpY = finite(vpY, height * 0.4);

    const hazeH = height * (0.18 + depthStrength * 0.035 + ambient * 0.05);
    for (let plane = 0; plane < LEXI_V3_DEPTH_PLANES; plane++) {
      const u = plane / (LEXI_V3_DEPTH_PLANES - 1);
      const y0 = horizonY - hazeH * (1.15 - u * 0.3) + Math.sin(tMs * 0.00007 * speed + plane) * (2 + depthStrength * 2);
      const band = ctx.createLinearGradient(0, y0, 0, y0 + hazeH * 0.85);
      const a = (0.035 + (1 - u) * 0.045 + glow * 0.03 + ambient * 0.035) * intensity;
      const tint = plane === 1 ? cool : plane === 2 ? rose : primary;
      band.addColorStop(0, hexToRgba(tint, 0));
      band.addColorStop(0.5, hexToRgba(plane === 0 ? champagne : tint, a * (tint === primary ? 1 : 0.45)));
      band.addColorStop(1, hexToRgba(secondary, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, y0, width, hazeH * 0.85);
    }

    for (let m = 0; m < mountains; m++) {
      const hx = hash01(m + 9);
      const hh = hash01(m + 29);
      const x = width * (0.04 + hx * 0.92);
      const h = height * (0.07 + hh * 0.15 + form * 0.025 + ambient * 0.02);
      mtX[m] = x;
      mtH[m] = h;
      mtY[m] = horizonY - h;
    }
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 8);
    ctx.lineTo(0, horizonY);
    for (let m = 0; m < mountains; m++) {
      const x = mtX[m]!;
      const y = mtY[m]!;
      const prev = m === 0 ? 0 : mtX[m - 1]!;
      const mid = (prev + x) * 0.5;
      ctx.lineTo(mid, horizonY - height * 0.012);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, horizonY);
    ctx.lineTo(width, horizonY + 8);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(secondary, 0.82);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(primary, (0.1 + glow * 0.06 + ambient * 0.04) * intensity);
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let m = 0; m < mountains; m++) {
      const x = mtX[m]!;
      const y = mtY[m]!;
      const h = mtH[m]!;
      const nRidge = 10 + Math.round(h * 0.08);
      ctx.fillStyle = hexToRgba(m % 4 === 0 ? champagne : primary, (0.12 + shimmer * 0.08 + ambient * 0.04) * intensity);
      for (let k = 0; k < nRidge; k++) {
        const t = k / Math.max(1, nRidge - 1);
        const rx = x + (t - 0.5) * width * 0.07;
        const ry = lerp(horizonY - 2, y, Math.sin(t * Math.PI));
        const s = 0.7 + (1 - t) * 0.5;
        ctx.fillRect(rx, ry, s, s);
      }
    }

    if (LEXI_REF_SKY_ARC) {
      ctx.beginPath();
      ctx.arc(vpX, horizonY + height * 0.18, width * (0.38 + ambient * 0.04), Math.PI * 1.14, Math.PI * 1.86);
      ctx.strokeStyle = hexToRgba(champagne, (0.055 + ambient * 0.05 + glow * 0.02) * intensity);
      ctx.lineWidth = 1.05;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(vpX, horizonY + height * 0.22, width * (0.22 + ambient * 0.03), Math.PI * 1.22, Math.PI * 1.78);
      ctx.strokeStyle = hexToRgba(primary, (0.03 + ambient * 0.03) * intensity);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    for (let t = 0; t < towers; t++) {
      const hx = hash01(t + 3);
      const hz = hash01(t + 17);
      const hh = hash01(t + 41);
      const sx = t < mountains ? mtX[t % mountains]! : width * (0.06 + hx * 0.88);
      const shaftH = height * (0.16 + hh * 0.28 + form * 0.05 + ambient * 0.06);
      const x0 = sx - (1.1 + hz * 1.5);
      const tint = t % 5 === 0 ? cool : t % 5 === 1 ? rose : champagne;
      const shaft = ctx.createLinearGradient(sx, horizonY - shaftH, sx, horizonY + 8);
      const a = (0.12 + (1 - hz) * 0.12 + ambient * 0.07 + glow * 0.05) * intensity;
      shaft.addColorStop(0, hexToRgba(highlight, a * 0.5 + bloom * 0.04));
      shaft.addColorStop(0.4, hexToRgba(tint, a * (tint === champagne ? 1 : 0.45)));
      shaft.addColorStop(1, hexToRgba(tint, 0));
      ctx.fillStyle = shaft;
      ctx.fillRect(x0, horizonY - shaftH, 2.2 + hz * 3.4, shaftH + 10);
      const tip = ctx.createRadialGradient(sx, horizonY - shaftH, 0.4, sx, horizonY - shaftH, 16 + ambient * 12);
      tip.addColorStop(0, hexToRgba(highlight, (0.16 + bloom * 0.1 + flash * 0.08) * intensity));
      tip.addColorStop(0.5, hexToRgba(tint, (0.06 + ambient * 0.04) * intensity));
      tip.addColorStop(1, hexToRgba(tint, 0));
      ctx.fillStyle = tip;
      ctx.fillRect(sx - 18, horizonY - shaftH - 18, 36, 36);
    }

    const horizonHaze = ctx.createLinearGradient(0, horizonY - hazeH, 0, horizonY + hazeH * 0.7);
    const hazeA = (0.1 + ambient * 0.1 + glow * 0.06 + backgroundLevel * 0.03) * intensity;
    horizonHaze.addColorStop(0, hexToRgba(cool, 0));
    horizonHaze.addColorStop(0.42, hexToRgba(primary, hazeA * 0.5));
    horizonHaze.addColorStop(0.52, hexToRgba(champagne, hazeA * 0.95));
    horizonHaze.addColorStop(0.66, hexToRgba(primary, hazeA * 0.4));
    horizonHaze.addColorStop(1, hexToRgba(accentHex, 0));
    ctx.fillStyle = horizonHaze;
    ctx.fillRect(0, horizonY - hazeH, width, hazeH * 1.7);

    const vpGlow = ctx.createRadialGradient(
      vpX,
      horizonY,
      2,
      vpX,
      horizonY,
      width * (0.36 + ambient * 0.1 + bloom * 0.05),
    );
    vpGlow.addColorStop(0, hexToRgba(highlight, (0.16 + bloom * 0.2 + ambient * 0.08) * intensity));
    vpGlow.addColorStop(0.28, hexToRgba(champagne, (0.09 + bloom * 0.1 + ambient * 0.05) * intensity));
    vpGlow.addColorStop(0.58, hexToRgba(cool, (0.025 + ambient * 0.02) * intensity));
    vpGlow.addColorStop(1, hexToRgba(primary, 0));
    ctx.fillStyle = vpGlow;
    ctx.fillRect(0, horizonY - height * 0.22, width, height * 0.42);

    const duneAmp = height * (0.2 + waveAmp * 0.07 + form * 0.07);
    const projectDune = (nx: number, u: number) => {
      const ease = Math.pow(clamp01(u), 0.78);
      const liftPx = duneLift(nx, clamp01(u), lift, body, form, spread, waveAmp, accent, peakN, phase) * duneAmp;
      const x0 = lerp(-width * 0.14, width * 1.14, (nx + 1) * 0.5);
      return {
        x: lerp(x0, vpX, ease),
        y: lerp(height * 0.98, horizonY + 6, ease) - liftPx,
        liftPx,
        ease,
      };
    };

    for (let col = 0; col < meridians; col++) {
      const nx = -1 + (2 * col) / Math.max(1, meridians - 1);
      let n = 0;
      for (let i = 0; i < along; i++) {
        const u = i / Math.max(1, along - 1);
        const jx = (hash01(col * 19 + i * 3) - 0.5) * 0.035 * (1 - u);
        const ju = (hash01(col * 11 + i * 7) - 0.5) * 0.018;
        const p = projectDune(nx + jx, u + ju);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = 1;
        n += 1;
      }
      const a = (0.16 + presence * 0.22 + lift * 0.08) * intensity;
      ctx.lineCap = "round";
      setDash(ctx, 0.9, 1.8);
      strokeProjected(ctx, n, hexToRgba(col % 6 === 0 ? champagne : primary, a), 0.85 + (1 - Math.abs(nx)) * 0.45);
      setDash(ctx, 0, 0);
      ctx.lineCap = "butt";
    }

    const rows = along;
    for (let row = rows - 1; row >= 0; row--) {
      const u = row / Math.max(1, rows - 1);
      const near = 1 - u;
      const plane = planeOf(u);
      for (let col = 0; col < meridians; col++) {
        const nx0 = -1 + (2 * col) / Math.max(1, meridians - 1);
        const jx = (hash01(col * 23 + row * 5) - 0.5) * 0.04 * near;
        const ju = (hash01(col * 29 + row * 9) - 0.5) * 0.016;
        const p = projectDune(nx0 + jx, u + ju);
        const crest = clamp01(p.liftPx / Math.max(1, duneAmp * 0.55));
        const sheen = lexiSheen(presented, (nx0 + 1) * 0.5);
        const alpha =
          (0.16 + near * 0.42 + crest * 0.4 + sheen * 0.12 + presence * 0.12 + shimmer * 0.08) * intensity;
        const tint =
          crest > 0.58 ? highlight : col % 17 === 0 ? cool : col % 15 === 0 ? rose : crest > 0.3 ? champagne : primary;
        ctx.fillStyle = hexToRgba(tint, Math.min(0.92, alpha * (tint === cool || tint === rose ? 0.38 : 1)));
        const s = 1.05 + near * (2.1 + particleAmount * 0.9 + lineThickness * 0.3) + crest * 1.05;
        ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
        if (plane === 0 && crest > 0.48) {
          ctx.fillStyle = hexToRgba(highlight, alpha * 0.45);
          ctx.fillRect(p.x - 1.4, p.y - 1.4, 2.8, 2.8);
        }
        const nx1 = nx0 + 1 / Math.max(1, meridians - 1);
        if (nx1 <= 1.05) {
          const p2 = projectDune(nx1 + jx * 0.6, u + ju * 0.7 + 0.008);
          const crest2 = clamp01(p2.liftPx / Math.max(1, duneAmp * 0.55));
          const a2 = (0.12 + near * 0.32 + crest2 * 0.3 + presence * 0.08) * intensity;
          ctx.fillStyle = hexToRgba(crest2 > 0.5 ? champagne : primary, Math.min(0.8, a2));
          const s2 = 0.9 + near * (1.6 + particleAmount * 0.6) + crest2 * 0.7;
          ctx.fillRect(p2.x - s2 * 0.5, p2.y - s2 * 0.5, s2, s2);
        }
      }
    }

    for (let row = 0; row < contours; row++) {
      zs[row] = 0.12 + (0.7 * row) / Math.max(1, contours - 1);
    }
    for (let row = 0; row < contours; row++) {
      if (row % 2 === 1) continue;
      const u = zs[row]!;
      let n = 0;
      for (let col = 0; col < meridians; col++) {
        const nx = -1 + (2 * col) / Math.max(1, meridians - 1);
        const p = projectDune(nx, u);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = 1;
        n += 1;
      }
      const nearness = 1 - u;
      stampDots(
        ctx,
        n,
        hexToRgba(row % 4 === 0 ? champagne : primary, (0.08 + nearness * 0.14 + body * 0.06) * intensity),
        1.05 + nearness * 0.7,
        1,
      );
    }

    const nSurf = Math.max(
      180,
      Math.min(MAX_SURFACE, Math.round(LEXI_REF_SURFACE_POINTS * (0.7 + particleAmount * 0.75 + complexity * 0.2))),
    );
    for (let i = 0; i < nSurf; i++) {
      const a = hash01(i + 11);
      const b = hash01(i + 37);
      const nx = -1.08 + a * 2.16;
      const u = Math.pow(b, 0.62);
      const p = projectDune(nx, u);
      const near = 1 - u;
      const crest = clamp01(p.liftPx / Math.max(1, duneAmp * 0.7));
      const sheen = lexiSheen(presented, a);
      const alpha = (0.1 + near * 0.3 + crest * 0.22 + sheen * 0.12 + shimmer * 0.08 + presence * 0.08) * intensity;
      const tint = i % 14 === 0 ? cool : i % 11 === 0 ? rose : i % 3 === 0 ? champagne : primary;
      ctx.fillStyle = hexToRgba(tint, Math.min(0.88, alpha * (tint === primary || tint === champagne ? 1 : 0.38)));
      const s = 1.05 + near * (2.1 + particleAmount * 0.85) + (i % 17 === 0 ? 1.4 : 0);
      ctx.fillRect(p.x, p.y, s, s);
    }

    const bandN = Math.max(22, Math.min(MAX_TRACE, 24 + Math.round(complexity * 16)));
    for (let b = LEXI_V3_LIGHT_BANDS - 1; b >= 0; b--) {
      const u0 = lerp(0.18, 0.55, b / Math.max(1, LEXI_V3_LIGHT_BANDS - 1));
      let n = 0;
      for (let i = 0; i < bandN; i++) {
        const s = i / (bandN - 1);
        const nx = lerp(-0.92, 0.92, s) + Math.sin(s * Math.PI * 1.6 + phase * 0.4 + b) * (0.08 + form * 0.1);
        const u = u0 + Math.sin(s * Math.PI * 2.4 + phase * 0.3 + b * 0.7) * 0.05;
        const x0 = lerp(-width * 0.08, width * 1.08, (nx + 1) * 0.5);
        const ease = Math.pow(clamp01(u), 0.82);
        const liftPx = duneLift(nx, clamp01(u), lift, body, form, spread, waveAmp, accent, peakN, phase) * duneAmp;
        px[n] = lerp(x0, vpX, ease);
        py[n] = lerp(height * 0.97, horizonY + 4, ease) - liftPx - height * 0.012;
        pok[n] = 1;
        n += 1;
      }
      const nearness = 1 - u0;
      const sheen = lexiSheen(presented, 0.3 + u0 * 0.4);
      const a = (0.1 + nearness * 0.16 + form * 0.08 + sheen * shimmer * 0.08) * intensity;
      const w = 1.05 + nearness * (1.6 + lineThickness * 0.7 + body * 0.5);
      const tint = b === 1 ? cool : champagne;
      strokeProjected(ctx, n, hexToRgba(tint, a * (tint === cool ? 0.45 : 1)), w);
    }

    const sheenAt = (t: number) => lexiSheen(presented, t);
    const crestU = 0.34 + form * 0.05;
    const fillCrest = (yOff: number, phaseOff: number) => {
      let n = 0;
      for (let i = 0; i < ribN; i++) {
        const s = i / (ribN - 1);
        const nx = lerp(-1.04, 1.04, s);
        const u =
          crestU +
          Math.sin(s * Math.PI * 1.7 + phase * 0.34 + phaseOff) * (0.07 + form * 0.05) +
          Math.sin(s * Math.PI * 3.2 + phaseOff) * 0.018;
        const p = projectDune(nx, clamp01(u));
        const sheen = sheenAt(s);
        px[n] = p.x;
        py[n] = p.y - yOff - sheen * height * 0.008;
        pok[n] = 1;
        n += 1;
      }
      return n;
    };

    const coreW = 1.35 + lineThickness * 1.4 + ribbonW * 2.2 + body * 0.7 + ambient * 0.6 + accent * 0.55;
    const nHero = fillCrest(height * 0.008, 0);
    ctx.lineCap = "round";
    strokeProjected(ctx, nHero, hexToRgba(primary, (0.1 + bloom * 0.08 + ambient * 0.05) * intensity), coreW * 3.6);
    strokeProjected(ctx, nHero, hexToRgba(champagne, (0.18 + bloom * 0.1 + ribbonW * 0.08) * intensity), coreW * 2.1);
    const nGhost = fillCrest(height * 0.02, 0.2);
    strokeProjected(ctx, nGhost, hexToRgba(cool, (0.07 + ambient * 0.06 + shimmer * 0.04) * intensity), coreW * 1.05);
    const nRose = fillCrest(-height * 0.014, -0.18);
    strokeProjected(ctx, nRose, hexToRgba(rose, (0.06 + ambient * 0.05 + flash * 0.03) * intensity), coreW * 0.9);
    const nSilkA = fillCrest(height * 0.007, 0.46);
    strokeProjected(ctx, nSilkA, hexToRgba(champagne, (0.16 + ambient * 0.08 + ribbonW * 0.1) * intensity), coreW * 1.2);
    const nSilkB = fillCrest(-height * 0.005, -0.4);
    strokeProjected(ctx, nSilkB, hexToRgba(primary, (0.12 + glow * 0.06) * intensity), coreW);
    strokeProjected(ctx, nHero, hexToRgba(champagne, (0.55 + bloom * 0.2 + ribbonW * 0.14 + accent * 0.1) * intensity), coreW);
    strokeProjected(
      ctx,
      nHero,
      hexToRgba(highlight, (0.4 + accent * 0.16 + flash * 0.22 + shimmer * 0.12) * intensity),
      Math.max(1.05, coreW * 0.38),
    );
    ctx.lineCap = "butt";
    stampDots(ctx, nHero, hexToRgba(highlight, (0.28 + flash * 0.18 + shimmer * 0.1) * intensity), 2.1, 1);

    const heroZ = 2.65 + form * 0.16;
    const sampleHero3 = (s: number, yOff: number, zOff: number) => {
      const x =
        lerp(-xSpan * 0.88, xSpan * 0.88, s) +
        Math.sin(s * Math.PI * 1.4 + phase * 0.36) * (0.2 + form * 0.32 + spread * 0.1);
      const z = heroZ + zOff + Math.sin(s * Math.PI * 2.05 + phase * 0.26) * (0.18 + form * 0.14);
      const y = sampleY(x, z) + 0.1 + yOff + form * 0.03 + ribbonW * 0.02;
      return project3(x, y, z, cam, width, height);
    };
    const fillHero3 = (yOff: number, zOff: number) => {
      let n = 0;
      for (let i = 0; i < ribN; i++) {
        const p = sampleHero3(i / (ribN - 1), yOff, zOff);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = p.ok ? 1 : 0;
        n += 1;
      }
      return n;
    };
    const nH3 = fillHero3(0, 0);
    strokeProjected(ctx, nH3, hexToRgba(primary, (0.1 + ambient * 0.06) * intensity), coreW * 1.15);
    strokeProjected(ctx, nH3, hexToRgba(champagne, (0.16 + bloom * 0.1 + ribbonW * 0.08) * intensity), coreW * 0.55);
    strokeProjected(ctx, nH3, hexToRgba(highlight, (0.1 + flash * 0.12) * intensity), Math.max(0.9, coreW * 0.18));

    if (pressure > 0.06) {
      const burstX = peakSx;
      const burstY = horizonY;
      const burst = ctx.createRadialGradient(
        burstX,
        burstY,
        2,
        burstX,
        burstY,
        width * (0.055 + pressure * 0.07 + lift * 0.02),
      );
      burst.addColorStop(0, hexToRgba(highlight, (0.16 + pressure * 0.24) * intensity));
      burst.addColorStop(0.42, hexToRgba(champagne, (0.07 + pressure * 0.1) * intensity));
      burst.addColorStop(1, hexToRgba(primary, 0));
      ctx.fillStyle = burst;
      ctx.fillRect(burstX - width * 0.11, burstY - height * 0.07, width * 0.22, height * 0.14);
      const nodeS = clamp01((phase * 0.1 + pressure * 0.32) % 1);
      const nodeN = fillCrest(height * 0.01, 0);
      const ni = Math.min(nodeN - 1, Math.max(0, Math.round(nodeS * (nodeN - 1))));
      if (pok[ni]) {
        const ng = ctx.createRadialGradient(px[ni]!, py[ni]!, 0.5, px[ni]!, py[ni]!, 18 + pressure * 14);
        ng.addColorStop(0, hexToRgba(highlight, (0.2 + pressure * 0.28) * intensity));
        ng.addColorStop(0.45, hexToRgba(champagne, (0.08 + pressure * 0.1) * intensity));
        ng.addColorStop(1, hexToRgba(primary, 0));
        ctx.fillStyle = ng;
        ctx.fillRect(px[ni]! - 22, py[ni]! - 22, 44, 44);
      }
    }

    const flowPx = height * (0.01 + waveAmp * 0.035 + shimmer * 0.008 + lift * 0.008);
    const step = Math.max(4, Math.round(width / 110));
    for (let t = 0; t < LEXI_2036_FG_TRACES; t++) {
      const u = t / Math.max(1, LEXI_2036_FG_TRACES - 1);
      const yBase = height * (0.82 + u * 0.14);
      const amp = flowPx * (0.85 + (1 - u) * 0.4 + accent * 0.22);
      const a = (0.1 + (1 - u) * 0.12 + body * 0.06 + accent * 0.1 + flash * 0.05) * intensity;
      const w = 0.85 + (1 - u) * (1.35 + lineThickness * 0.8 + accent * 0.8);
      const localPhase = phase * (0.5 + u * 0.28) + t * 0.85;
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        const s = x / width;
        const sheen = sheenAt(s);
        const y =
          yBase +
          Math.sin(s * Math.PI * 1.7 + localPhase) * amp +
          Math.sin(s * Math.PI * 3.4 + localPhase * 1.1) * amp * 0.2 +
          (sheen - 0.2) * amp * 0.16;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = hexToRgba(t === 1 ? champagne : primary, a);
      ctx.lineWidth = w;
      ctx.stroke();
      if (t === 1) {
        ctx.strokeStyle = hexToRgba(highlight, a * 0.4 + flash * 0.16);
        ctx.lineWidth = Math.max(0.85, w * 0.26);
        ctx.stroke();
      }
    }

    if (bloom > 0.04 || form > 0.12 || ribbonW > 0.12) {
      const peakGlow = ctx.createRadialGradient(
        peakSx,
        peakSy,
        1,
        peakSx,
        peakSy,
        width * (0.045 + form * 0.03 + bloom * 0.02 + ambient * 0.012),
      );
      peakGlow.addColorStop(0, hexToRgba(highlight, (0.08 + bloom * 0.16 + form * 0.06 + flash * 0.05) * intensity));
      peakGlow.addColorStop(0.5, hexToRgba(champagne, (0.035 + bloom * 0.07 + ambient * 0.03) * intensity));
      peakGlow.addColorStop(1, hexToRgba(primary, 0));
      ctx.fillStyle = peakGlow;
      ctx.fillRect(peakSx - width * 0.09, peakSy - height * 0.08, width * 0.18, height * 0.16);
    }

    if (flash > 0.08) {
      const nFlash = fillCrest(height * 0.01, 0);
      strokeProjected(ctx, nFlash, hexToRgba(highlight, (0.12 + flash * 0.24) * intensity), Math.max(0.95, coreW * 0.2));
      const nSpark = Math.round(36 + flash * 40);
      for (let i = 0; i < nSpark; i++) {
        const a = hash01(i + 91);
        const b = hash01(i + 111);
        ctx.fillStyle = hexToRgba(i % 5 === 0 ? cool : highlight, (0.1 + flash * 0.22) * intensity);
        ctx.fillRect(a * width, lerp(horizonY, height * 0.92, b), 1.15, 1.15);
      }
    }

    const nBokeh = Math.max(
      10,
      Math.min(MAX_BOKEH, Math.round(LEXI_REF_FG_BOKEH * (0.55 + particleAmount * 0.7 + shimmer * 0.2))),
    );
    const safeX0 = width * LEXI_TITLE_SAFE.x0;
    const safeX1 = width * LEXI_TITLE_SAFE.x1;
    const safeY0 = height * LEXI_TITLE_SAFE.y0;
    const safeY1 = height * LEXI_TITLE_SAFE.y1;
    for (let i = 0; i < nBokeh; i++) {
      const a = hash01(i + 4);
      const b = hash01(i + 21);
      const drift = tMs * 0.000012 * speed * (0.3 + a);
      const x = ((a + drift) % 1) * width;
      const y = lerp(height * 0.58, height * 1.02, b) + Math.sin(phase * 0.18 + i) * 4;
      if (x > safeX0 && x < safeX1 && y > safeY0 && y < safeY1) continue;
      const r = 3 + b * 10 + particleAmount * 3;
      const tint = i % 8 === 0 ? cool : i % 6 === 0 ? rose : i % 3 === 0 ? highlight : champagne;
      const g = ctx.createRadialGradient(x, y, 0.2, x, y, r);
      const a0 = (0.07 + shimmer * 0.08 + ambient * 0.04 + presence * 0.04) * intensity * (tint === champagne || tint === highlight ? 1 : 0.4);
      g.addColorStop(0, hexToRgba(tint, a0));
      g.addColorStop(0.45, hexToRgba(tint, a0 * 0.35));
      g.addColorStop(1, hexToRgba(tint, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    const nDust = Math.round(PARTICLE_CAP * particleAmount * (0.35 + shimmer * 0.55 + ambient * 0.2 + flash * 0.15));
    for (let i = 0; i < nDust; i++) {
      const a = hash01(i + 5);
      const b = hash01(i + 23);
      const layer = hash01(i + 61);
      const driftU = tMs * 0.00001 * speed * (0.28 + a + layer * 0.32);
      const uu = (a + driftU) % 1;
      const v = 0.12 + b * 0.82;
      const x = uu * width + Math.sin(phase * 0.2 + i) * (1.2 + depthStrength * 1.5);
      const y = v * height + Math.sin(phase * 0.28 + i * 0.5) * (1.1 + shimmer * 2.2);
      if (x > safeX0 && x < safeX1 && y > safeY0 && y < safeY1) continue;
      const far = v < 0.36;
      const alpha = (0.06 + shimmer * 0.16 + ambient * 0.04 + flash * 0.05) * intensity * (0.4 + hash01(i + 41));
      const tint = i % 8 === 0 ? cool : i % 6 === 0 ? rose : i % 4 === 0 ? highlight : far ? champagne : primary;
      ctx.fillStyle = hexToRgba(tint, alpha * (tint === primary || tint === champagne || tint === highlight ? 1 : 0.5));
      ctx.fillRect(x, y, 0.7 + b * (far ? 0.7 : 1.15), 0.7 + b * (far ? 0.7 : 1.15));
    }

    const mist = ctx.createLinearGradient(0, height * 0.78, 0, height);
    mist.addColorStop(0, hexToRgba(secondary, 0));
    mist.addColorStop(0.45, hexToRgba(primary, (0.03 + ambient * 0.02) * intensity));
    mist.addColorStop(1, hexToRgba(secondary, 0.42 + (1 - ambient) * 0.12));
    ctx.fillStyle = mist;
    ctx.fillRect(0, height * 0.78, width, height * 0.22);

    const falloff = ctx.createLinearGradient(0, height * 0.7, 0, height);
    falloff.addColorStop(0, hexToRgba(secondary, 0));
    falloff.addColorStop(1, hexToRgba(secondary, 0.38 + (1 - ambient) * 0.12));
    ctx.fillStyle = falloff;
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
  },
};
