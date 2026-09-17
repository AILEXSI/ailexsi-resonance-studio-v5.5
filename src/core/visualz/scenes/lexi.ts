/**
 * Scene: lexi — AILEXSI flagship LEXI 2036 (Cinematic Future Energy Space).
 * Horizon flow with layered depth: FG traces · MG terrain · hero stream · BG haze.
 * Not a retro wireframe grid. Preview and Export both read presented AudioFeatures.
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
  isLexiThemeId,
  resolveLexiTheme,
} from "./lexi-theme";

export {
  LEXI_DEFAULT_THEME,
  LEXI_REFLECT,
  LEXI_THEMES,
  LEXI_TITLE_SAFE,
  isLexiThemeId,
  resolveLexiTheme,
};
export type { LexiThemeId } from "./lexi-theme";

/** FG / MG / BG. Visible depth stack, not a flat horizon wash. */
export const LEXI_V3_DEPTH_PLANES = 3;
/** Supporting mid-ground energy filaments (hero stream is separate). */
export const LEXI_V3_LIGHT_BANDS = 4;
export const LEXI_2036_HERO_FILAMENTS = 5;
export const LEXI_2036_FG_TRACES = 3;
export const LEXI_2036_SIGNAL_TOWERS = 6;

const MAX_MERIDIANS = 16;
const MAX_CONTOURS = 16;
const MAX_ALONG = 32;
const MAX_BAND = 48;
const MAX_RIBBON = 56;
const MAX_TRACE = 36;
const MAX_STROKE = 56;
const MAX_TOWERS = 6;
const PARTICLE_CAP = 40;

const zs = new Float32Array(MAX_CONTOURS);
const px = new Float32Array(MAX_STROKE);
const py = new Float32Array(MAX_STROKE);
const pok = new Uint8Array(MAX_STROKE);
const edgeL = new Float32Array(MAX_CONTOURS);
const edgeR = new Float32Array(MAX_CONTOURS);
const edgeYl = new Float32Array(MAX_CONTOURS);
const edgeYr = new Float32Array(MAX_CONTOURS);
const edgeOk = new Uint8Array(MAX_CONTOURS);

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

function planeOf(u: number): 0 | 1 | 2 {
  if (u < 0.3) return 0;
  if (u < 0.64) return 1;
  return 2;
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
  const near = 1 - u;
  const liftY = lift * (0.08 + near * 0.3);
  const bodyY = body * near * 0.11;
  const formY =
    Math.sin(x * (0.18 + form * 0.16) + z * 0.11 + localPhase * 0.16) * form * 0.38 +
    Math.sin(x * 0.09 - z * 0.06 + localPhase * 0.08) * form * 0.16;
  const dx = x - peakX;
  const dz = z - peakZ;
  const peak = form * Math.exp(-(dx * dx * 0.5 + dz * dz * 0.14)) * (0.78 + lift * 0.26);
  const peak2x = -1.28 + spread * 0.18;
  const peak2 = form * 0.42 * Math.exp(-((x - peak2x) * (x - peak2x) * 0.85 + (z - 5.1) * (z - 5.1) * 0.2));
  const valley = -0.08 * (1 - Math.min(1, Math.abs(x) * 0.18)) * u;
  const ridge = Math.sin(x * 0.62 + z * 0.28 + localPhase * 0.3) * waveAmp * 0.11 * near;
  const kick = accent * near * 0.085 * Math.cos(z * 1.55);
  return liftY + bodyY + formY + peak + peak2 + valley + ridge + kick;
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

function drawScreenRibbon(
  ctx: CanvasRenderingContext2D,
  width: number,
  yBase: number,
  amp: number,
  localPhase: number,
  sheenAt: (t: number) => number,
  color: string,
  widthPx: number,
  yOff: number,
): void {
  const step = Math.max(4, Math.round(width / 110));
  ctx.beginPath();
  for (let x = 0; x <= width; x += step) {
    const t = x / width;
    const sheen = sheenAt(t);
    const y =
      yBase +
      yOff +
      Math.sin(t * Math.PI * 1.85 + localPhase) * amp +
      Math.sin(t * Math.PI * 3.6 + localPhase * 1.12) * amp * 0.2 +
      (sheen - 0.2) * amp * 0.18;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx;
  ctx.stroke();
}

export const lexiScene: Scene = {
  id: "lexi",
  name: "LEXI",
  description: "2036 cinematic energy space — luminous stream, atmospheric terrain, musical form",
  defaultParams: {
    intensity: 0.86,
    colorPrimary: DEFAULT_GOLD.colorPrimary,
    colorSecondary: DEFAULT_GOLD.colorSecondary,
    speed: 0.72,
    complexity: 0.54,
    glowStrength: 0.58,
    lineThickness: 0.62,
    waveAmplitude: 0.68,
    depthStrength: 0.86,
    reactivity: 0.84,
    smoothing: 0.7,
    particleAmount: 0.28,
    backgroundLevel: 0.1,
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
    const intensity = num(params.intensity, 0.86);
    const glowStrength = num(params.glowStrength, 0.58);
    const lineThickness = num(params.lineThickness, 0.62);
    const waveAmplitude = num(params.waveAmplitude, 0.68);
    const depthStrength = num(params.depthStrength, 0.86);
    const reactivity = num(params.reactivity, 0.84);
    const smoothing = clamp01(num(params.smoothing, 0.7));
    const particleAmount = clamp01(num(params.particleAmount, 0.28));
    const backgroundLevel = clamp01(num(params.backgroundLevel, 0.1));
    const speed = num(params.speed, 0.72);
    const complexity = clamp01(num(params.complexity, 0.54));
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
    const idle = 0.12 + (1 - reactivity) * 0.08;
    const shimmer = clamp01(sTreble * 0.88) * reactivity;

    phase += dt * speed * (0.14 + sRms * 0.26 + idle * 0.05);
    const tMs = features.timeMs;
    const peakX = lexiPeakBias(tMs, speed);
    const peakZ = 3.15 + Math.sin(tMs * 0.00006 * speed) * 0.28;

    const meridians = Math.max(7, Math.min(MAX_MERIDIANS, 7 + Math.round(complexity * 8)));
    const contours = Math.max(8, Math.min(MAX_CONTOURS, 8 + Math.round(complexity * 7)));
    const along = Math.max(16, Math.min(MAX_ALONG, 16 + Math.round(complexity * 12)));
    const ribN = Math.max(28, Math.min(MAX_RIBBON, 30 + Math.round(complexity * 22)));
    const towers = Math.max(4, Math.min(MAX_TOWERS, 4 + Math.round(complexity * 2)));

    ctx.fillStyle = secondary;
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, hexToRgba(cool, 0.055 + backgroundLevel * 0.05 + ambient * 0.03));
    sky.addColorStop(0.32, hexToRgba(accentHex, 0.06 + backgroundLevel * 0.04));
    sky.addColorStop(0.48, secondary);
    sky.addColorStop(0.58, hexToRgba(primary, 0.02 + backgroundLevel * 0.02 + glow * 0.015));
    sky.addColorStop(1, hexToRgba(secondary, 1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const cam = cam3({
      x: Math.sin(tMs * 0.00002 * speed) * 0.12 * (0.45 + depthStrength),
      y: 1.18 + lift * 0.18 + body * 0.05,
      z: -0.18 + Math.sin(tMs * 0.000014 * speed) * 0.035,
      yaw: Math.sin(tMs * 0.000016 * speed) * 0.024 * (0.45 + depthStrength),
      pitch: -0.34 - depthStrength * 0.02 + lift * 0.01,
      fov: 1.06,
      far: 16 + depthStrength * 2,
    });

    const zNear = 1.02;
    const zFar = 12.4 + depthStrength * 1.6;
    const xSpan = 5.15 + depthStrength * 0.45;
    const waveAmp = waveAmplitude * (idle + form * 0.32 + lift * 0.2);

    const worldX = (col: number, uNear: number) => {
      const raw = -xSpan + (2 * xSpan * col) / (meridians - 1);
      return raw * (1 + spread * 0.36 * uNear);
    };

    const sampleY = (x: number, z: number) =>
      terrainY(x, z, zNear, zFar, lift, body, form, spread, waveAmp, accent, peakX, peakZ, phase);

    for (let row = 0; row < contours; row++) {
      zs[row] = zNear + ((zFar - zNear) * row) / (contours - 1);
    }

    let vpX = width * 0.5;
    let vpY = height * 0.38;
    const vp = project3(0, 0.02, zFar, cam, width, height);
    if (vp.ok) {
      vpX = vp.x;
      vpY = vp.y;
    }

    let peakSx = width * 0.58;
    let peakSy = height * 0.5;
    const peakP = project3(peakX, sampleY(peakX, peakZ) + 0.06, peakZ, cam, width, height);
    if (peakP.ok) {
      peakSx = peakP.x;
      peakSy = peakP.y;
    }

    let horizonY = vpY;
    let hCount = 0;
    let hSum = 0;
    for (let col = 0; col < meridians; col++) {
      const x = worldX(col, 0.35);
      const p = project3(x, sampleY(x, 4.2), 4.2, cam, width, height);
      if (!p.ok) continue;
      hSum += p.y;
      hCount += 1;
    }
    if (hCount) horizonY = hSum / hCount;

    const hazeH = height * (0.2 + depthStrength * 0.04 + ambient * 0.04);
    for (let plane = 0; plane < LEXI_V3_DEPTH_PLANES; plane++) {
      const u = plane / (LEXI_V3_DEPTH_PLANES - 1);
      const y0 = horizonY - hazeH * (1.2 - u * 0.32) + Math.sin(tMs * 0.00008 * speed + plane) * (2 + depthStrength * 2);
      const band = ctx.createLinearGradient(0, y0, 0, y0 + hazeH * 0.9);
      const a = (0.045 + (1 - u) * 0.05 + glow * 0.035 + ambient * 0.04) * intensity;
      const tint = plane === 1 ? cool : plane === 2 ? rose : primary;
      band.addColorStop(0, hexToRgba(tint, 0));
      band.addColorStop(0.5, hexToRgba(plane === 0 ? champagne : tint, a));
      band.addColorStop(1, hexToRgba(secondary, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, y0, width, hazeH * 0.9);
    }

    const horizonHaze = ctx.createLinearGradient(0, horizonY - hazeH, 0, horizonY + hazeH * 0.85);
    const hazeA = (0.08 + ambient * 0.1 + glow * 0.05 + backgroundLevel * 0.04) * intensity;
    horizonHaze.addColorStop(0, hexToRgba(cool, 0));
    horizonHaze.addColorStop(0.4, hexToRgba(primary, hazeA * 0.55));
    horizonHaze.addColorStop(0.5, hexToRgba(champagne, hazeA * 0.95));
    horizonHaze.addColorStop(0.64, hexToRgba(primary, hazeA * 0.45));
    horizonHaze.addColorStop(1, hexToRgba(accentHex, 0));
    ctx.fillStyle = horizonHaze;
    ctx.fillRect(0, horizonY - hazeH, width, hazeH * 1.85);

    const vpGlow = ctx.createRadialGradient(vpX, horizonY, 2, vpX, horizonY, width * (0.34 + ambient * 0.1 + bloom * 0.05));
    vpGlow.addColorStop(0, hexToRgba(highlight, (0.12 + bloom * 0.18 + ambient * 0.07) * intensity));
    vpGlow.addColorStop(0.32, hexToRgba(champagne, (0.07 + bloom * 0.08 + ambient * 0.04) * intensity));
    vpGlow.addColorStop(0.62, hexToRgba(cool, (0.03 + ambient * 0.025) * intensity));
    vpGlow.addColorStop(1, hexToRgba(primary, 0));
    ctx.fillStyle = vpGlow;
    ctx.fillRect(0, horizonY - height * 0.2, width, height * 0.4);

    for (let t = 0; t < towers; t++) {
      const hx = hash01(t + 3);
      const hz = hash01(t + 17);
      const hh = hash01(t + 41);
      const sx = width * (0.07 + hx * 0.86);
      const shaftH = height * (0.14 + hh * 0.24 + form * 0.06 + ambient * 0.05);
      const x0 = sx - (1.2 + hz * 1.6);
      const tint = t % 3 === 0 ? cool : t % 3 === 1 ? rose : champagne;
      const shaft = ctx.createLinearGradient(sx, horizonY - shaftH, sx, horizonY + 6);
      const a = (0.1 + (1 - hz) * 0.1 + ambient * 0.06 + glow * 0.04) * intensity;
      shaft.addColorStop(0, hexToRgba(highlight, a * 0.55 + bloom * 0.04));
      shaft.addColorStop(0.35, hexToRgba(tint, a));
      shaft.addColorStop(1, hexToRgba(tint, 0));
      ctx.fillStyle = shaft;
      ctx.fillRect(x0, horizonY - shaftH, 2.4 + hz * 3.2, shaftH + 8);
      const tip = ctx.createRadialGradient(sx, horizonY - shaftH, 0.4, sx, horizonY - shaftH, 14 + ambient * 10);
      tip.addColorStop(0, hexToRgba(highlight, (0.14 + bloom * 0.1 + flash * 0.08) * intensity));
      tip.addColorStop(0.5, hexToRgba(tint, (0.06 + ambient * 0.04) * intensity));
      tip.addColorStop(1, hexToRgba(tint, 0));
      ctx.fillStyle = tip;
      ctx.fillRect(sx - 16, horizonY - shaftH - 16, 32, 32);
    }

    for (let row = 0; row < contours; row++) {
      const z = zs[row]!;
      const u = (z - zNear) / (zFar - zNear);
      const xl = worldX(0, 1 - u);
      const xr = worldX(meridians - 1, 1 - u);
      const pl = project3(xl, sampleY(xl, z), z, cam, width, height);
      const pr = project3(xr, sampleY(xr, z), z, cam, width, height);
      edgeL[row] = pl.x;
      edgeYl[row] = pl.y;
      edgeR[row] = pr.x;
      edgeYr[row] = pr.y;
      edgeOk[row] = pl.ok && pr.ok ? 1 : 0;
    }
    for (let row = contours - 2; row >= 0; row--) {
      if (!edgeOk[row] || !edgeOk[row + 1]) continue;
      const u = row / Math.max(1, contours - 1);
      const nearness = 1 - u;
      const planeA = (0.02 + nearness * 0.055 + lift * 0.1 + body * 0.06 + form * 0.04 + ambient * 0.02) * intensity;
      ctx.fillStyle = hexToRgba(primary, planeA);
      ctx.beginPath();
      ctx.moveTo(edgeL[row]!, edgeYl[row]!);
      ctx.lineTo(edgeR[row]!, edgeYr[row]!);
      ctx.lineTo(edgeR[row + 1]!, edgeYr[row + 1]!);
      ctx.lineTo(edgeL[row + 1]!, edgeYl[row + 1]!);
      ctx.closePath();
      ctx.fill();
    }

    const fillContour = (row: number) => {
      const z = zs[row]!;
      const u = (z - zNear) / (zFar - zNear);
      for (let col = 0; col < meridians; col++) {
        const x = worldX(col, 1 - u);
        const p = project3(x, sampleY(x, z), z, cam, width, height);
        px[col] = p.x;
        py[col] = p.y;
        pok[col] = p.ok ? 1 : 0;
      }
      return u;
    };

    const projectMeridian = (col: number, u0: number, u1: number) => {
      let n = 0;
      for (let i = 0; i < along; i++) {
        const t = i / (along - 1);
        const u = lerp(u0, u1, t);
        const z = zNear + (zFar - zNear) * u;
        const x = worldX(col, 1 - u);
        const p = project3(x, sampleY(x, z), z, cam, width, height);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = p.ok ? 1 : 0;
        n += 1;
      }
      return n;
    };

    if (complexity > 0.72) {
      const ribStep = Math.max(3, Math.round(meridians / 4));
      for (let col = 0; col < meridians; col += ribStep) {
        const sheen = lexiSheen(presented, col / Math.max(1, meridians - 1));
        const n = projectMeridian(col, 0.12, 0.78);
        const a = (0.02 + lift * 0.04 + sheen * shimmer * 0.03) * intensity;
        strokeProjected(ctx, n, hexToRgba(champagne, a), 0.6);
      }
    }

    for (let row = contours - 1; row >= 0; row--) {
      if (row % 2 === 1 && row < contours - 2 && row > 1) continue;
      const u = fillContour(row);
      const plane = planeOf(u);
      const nearness = plane === 0 ? 1 : plane === 1 ? 0.42 : 0.12;
      const a = (0.05 + nearness * 0.14 + body * 0.06 + glow * 0.02) * intensity;
      const w = 0.7 + nearness * (1.35 + lineThickness * 0.7 + lift * 0.35);
      strokeProjected(ctx, meridians, hexToRgba(row % 2 === 0 ? primary : champagne, a), w);
    }

    const bandN = Math.max(20, Math.min(MAX_BAND, 24 + Math.round(complexity * 14)));
    for (let b = LEXI_V3_LIGHT_BANDS - 1; b >= 0; b--) {
      const u = b / (LEXI_V3_LIGHT_BANDS - 1);
      const z0 = lerp(2.05, 7.4, u);
      let n = 0;
      for (let i = 0; i < bandN; i++) {
        const s = i / (bandN - 1);
        const x =
          lerp(-xSpan * 0.82, xSpan * 0.82, s) +
          Math.sin(s * Math.PI * 1.7 + phase * 0.42 + b * 0.7) * (0.38 + form * 0.48 + spread * 0.18);
        const z = z0 + Math.sin(s * Math.PI * 2.6 + phase * 0.32 + b * 0.8) * (0.22 + form * 0.14);
        const y = sampleY(x, z) + 0.05 + form * 0.025;
        const p = project3(x, y, z, cam, width, height);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = p.ok ? 1 : 0;
        n += 1;
      }
      const nearness = 1 - u;
      const sheen = lexiSheen(presented, 0.32 + u * 0.42);
      const a = (0.1 + nearness * 0.14 + form * 0.08 + lift * 0.04 + sheen * shimmer * 0.07) * intensity;
      const w = 0.95 + nearness * (1.55 + lineThickness * 0.8 + body * 0.7);
      const tint = b % 3 === 0 ? champagne : b % 3 === 1 ? primary : cool;
      strokeProjected(ctx, n, hexToRgba(tint, a * (tint === cool ? 0.55 : 1)), w);
    }

    const sheenAt = (t: number) => lexiSheen(presented, t);
    const flowPx = height * (0.012 + waveAmp * 0.045 + shimmer * 0.01 + lift * 0.01);
    const seaRows = 6 + Math.round(complexity * 3);
    const step = Math.max(4, Math.round(width / 110));
    for (let s = seaRows - 1; s >= 0; s--) {
      const u = s / Math.max(1, seaRows - 1);
      const yBase = horizonY + lerp(height * 0.03, height * 0.44, 1 - u);
      const amp = flowPx * lerp(0.28, 1.15, 1 - u) * (0.65 + body * 0.5 + spread * 0.35);
      const seaPhase = phase * (0.32 + (1 - u) * 0.42) + tMs * 0.00003 * speed;
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        const t = x / width;
        const sheen = sheenAt(t);
        const y =
          yBase +
          Math.sin(t * Math.PI * (1.5 + spread * 1.2) + seaPhase) * amp * (0.72 + sheen * 0.3) +
          Math.sin(t * Math.PI * 3.0 - seaPhase * 0.65) * amp * 0.18;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const seaA = (0.1 + (1 - u) * 0.2 + glow * 0.08 + body * 0.07 + ambient * 0.04) * intensity;
      ctx.strokeStyle = hexToRgba(s % 2 === 0 ? primary : accentHex, seaA);
      ctx.lineWidth = 0.85 + (1 - u) * (1.55 + body * 0.9) * (0.55 + lineThickness * 0.5);
      ctx.stroke();
    }

    const ribbonAmp = flowPx * (0.95 + body * 0.3 + form * 0.2);
    const core = 4.2 + lineThickness * 4.2 + ribbonW * 6.2 + body * 2.8 + ambient * 2.6 + accent * 2.4 + glow * 1.1;
    const ribPhase = phase * 0.3 + tMs * 0.000028 * speed;
    drawScreenRibbon(ctx, width, horizonY, ribbonAmp * 0.7, ribPhase + 0.4, sheenAt, hexToRgba(accentHex, 0.16 + glow * 0.1 + ambient * 0.08), Math.max(1.2, core * 0.7), -height * 0.02);
    drawScreenRibbon(ctx, width, horizonY, ribbonAmp * 0.82, ribPhase + 0.85, sheenAt, hexToRgba(cool, 0.08 + ambient * 0.07 + shimmer * 0.04), Math.max(1, core * 0.55), height * 0.018);
    drawScreenRibbon(ctx, width, horizonY, ribbonAmp * 0.78, ribPhase + 1.2, sheenAt, hexToRgba(rose, 0.06 + ambient * 0.05 + flash * 0.04), Math.max(1, core * 0.48), -height * 0.01);
    drawScreenRibbon(ctx, width, horizonY, ribbonAmp, ribPhase, sheenAt, hexToRgba(primary, 0.22 + bloom * 0.14 + ambient * 0.09), core * 3.8, 0);
    drawScreenRibbon(ctx, width, horizonY, ribbonAmp, ribPhase, sheenAt, hexToRgba(champagne, 0.48 + bloom * 0.3 + ribbonW * 0.18 + accent * 0.16), core * 1.15, 0);
    drawScreenRibbon(
      ctx,
      width,
      horizonY,
      ribbonAmp,
      ribPhase,
      sheenAt,
      hexToRgba(highlight, 0.34 + accent * 0.18 + flash * 0.2 + shimmer * 0.1),
      Math.max(1.15, core * 0.3),
      0,
    );

    const heroZ = 2.85 + form * 0.18;
    const sampleHero = (s: number, yOff: number, zOff: number) => {
      const x =
        lerp(-xSpan * 0.9, xSpan * 0.9, s) +
        Math.sin(s * Math.PI * 1.35 + phase * 0.38) * (0.22 + form * 0.35 + spread * 0.12);
      const z = heroZ + zOff + Math.sin(s * Math.PI * 2.15 + phase * 0.28) * (0.2 + form * 0.16);
      const y = sampleY(x, z) + 0.09 + yOff + form * 0.03 + ribbonW * 0.02;
      return project3(x, y, z, cam, width, height);
    };
    const fillHero = (yOff: number, zOff: number) => {
      let n = 0;
      for (let i = 0; i < ribN; i++) {
        const p = sampleHero(i / (ribN - 1), yOff, zOff);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = p.ok ? 1 : 0;
        n += 1;
      }
      return n;
    };

    const coreW = 2.4 + lineThickness * 2.6 + ribbonW * 3.4 + body * 1.6 + ambient * 1.2;
    const nHero = fillHero(0, 0);
    strokeProjected(ctx, nHero, hexToRgba(accentHex, (0.1 + glow * 0.08 + ambient * 0.06) * intensity), coreW * 2.8);
    strokeProjected(ctx, nHero, hexToRgba(primary, (0.16 + bloom * 0.1 + ambient * 0.08) * intensity), coreW * 1.7);
    const nGhost = fillHero(0.035, 0.08);
    strokeProjected(ctx, nGhost, hexToRgba(cool, (0.05 + ambient * 0.05 + shimmer * 0.04) * intensity), coreW * 0.85);
    const nRose = fillHero(-0.03, -0.06);
    strokeProjected(ctx, nRose, hexToRgba(rose, (0.04 + ambient * 0.04 + flash * 0.03) * intensity), coreW * 0.7);
    strokeProjected(ctx, nHero, hexToRgba(champagne, (0.28 + bloom * 0.22 + ribbonW * 0.14 + accent * 0.1) * intensity), coreW);
    strokeProjected(
      ctx,
      nHero,
      hexToRgba(highlight, (0.22 + accent * 0.16 + flash * 0.2 + shimmer * 0.08) * intensity),
      Math.max(1.05, coreW * 0.28),
    );

    if (pressure > 0.06) {
      const burstX = peakSx;
      const burstY = horizonY;
      const burst = ctx.createRadialGradient(
        burstX,
        burstY,
        2,
        burstX,
        burstY,
        width * (0.06 + pressure * 0.08 + lift * 0.02),
      );
      burst.addColorStop(0, hexToRgba(highlight, (0.18 + pressure * 0.28) * intensity));
      burst.addColorStop(0.4, hexToRgba(champagne, (0.08 + pressure * 0.12) * intensity));
      burst.addColorStop(1, hexToRgba(primary, 0));
      ctx.fillStyle = burst;
      ctx.fillRect(burstX - width * 0.12, burstY - height * 0.08, width * 0.24, height * 0.16);
      const nodeS = clamp01((phase * 0.12 + pressure * 0.35) % 1);
      const node = sampleHero(nodeS, 0.02, 0);
      if (node.ok) {
        const ng = ctx.createRadialGradient(node.x, node.y, 0.5, node.x, node.y, 16 + pressure * 12);
        ng.addColorStop(0, hexToRgba(highlight, (0.18 + pressure * 0.3) * intensity));
        ng.addColorStop(0.45, hexToRgba(champagne, (0.08 + pressure * 0.1) * intensity));
        ng.addColorStop(1, hexToRgba(primary, 0));
        ctx.fillStyle = ng;
        ctx.fillRect(node.x - 20, node.y - 20, 40, 40);
      }
    }

    const traceN = Math.max(18, Math.min(MAX_TRACE, 20 + Math.round(complexity * 12)));
    for (let t = 0; t < LEXI_2036_FG_TRACES; t++) {
      const u = t / Math.max(1, LEXI_2036_FG_TRACES - 1);
      const yBase = horizonY + height * (0.1 + u * 0.22);
      const amp = flowPx * (1.05 + (1 - u) * 0.55 + accent * 0.35);
      const a = (0.16 + (1 - u) * 0.18 + body * 0.1 + accent * 0.14 + flash * 0.08) * intensity;
      const w = 1.4 + (1 - u) * (2.2 + lineThickness * 1.2 + accent * 1.4);
      drawScreenRibbon(
        ctx,
        width,
        yBase,
        amp,
        phase * (0.55 + u * 0.3) + t * 0.9,
        sheenAt,
        hexToRgba(t === 1 ? champagne : primary, a),
        w,
        0,
      );
      if (t === 1) {
        drawScreenRibbon(
          ctx,
          width,
          yBase,
          amp,
          phase * 0.7 + 0.9,
          sheenAt,
          hexToRgba(highlight, a * 0.42 + flash * 0.18),
          Math.max(0.9, w * 0.28),
          0,
        );
      }
      const z0 = lerp(1.12, 2.05, u);
      let n = 0;
      for (let i = 0; i < traceN; i++) {
        const s = i / (traceN - 1);
        const x =
          lerp(-xSpan * 0.7, xSpan * 0.7, s) +
          Math.sin(s * Math.PI * 2.4 + phase * 0.7 + t * 1.1) * (0.18 + form * 0.22 + accent * 0.12);
        const z = z0 + Math.sin(s * Math.PI * 3.1 + phase * 0.5 + t) * 0.12;
        const y = sampleY(x, z) + 0.12 + (1 - u) * 0.06 + accent * 0.04;
        const p = project3(x, y, z, cam, width, height);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = p.ok ? 1 : 0;
        n += 1;
      }
      strokeProjected(ctx, n, hexToRgba(t === 1 ? champagne : primary, a * 0.55), Math.max(0.8, w * 0.45));
    }

    if (bloom > 0.04 || form > 0.12 || ribbonW > 0.12) {
      const peakGlow = ctx.createRadialGradient(
        peakSx,
        peakSy,
        1,
        peakSx,
        peakSy,
        width * (0.04 + form * 0.028 + bloom * 0.018 + ambient * 0.012),
      );
      peakGlow.addColorStop(0, hexToRgba(highlight, (0.07 + bloom * 0.16 + form * 0.06 + flash * 0.05) * intensity));
      peakGlow.addColorStop(0.5, hexToRgba(champagne, (0.03 + bloom * 0.07 + ambient * 0.03) * intensity));
      peakGlow.addColorStop(1, hexToRgba(primary, 0));
      ctx.fillStyle = peakGlow;
      ctx.fillRect(peakSx - width * 0.09, peakSy - height * 0.08, width * 0.18, height * 0.16);
    }

    if (flash > 0.08) {
      const nFlash = fillHero(0.01, 0);
      strokeProjected(ctx, nFlash, hexToRgba(highlight, (0.1 + flash * 0.22) * intensity), Math.max(0.9, coreW * 0.18));
    }

    const nDust = Math.round(PARTICLE_CAP * particleAmount * (0.1 + shimmer * 0.7 + ambient * 0.2));
    const safeX0 = width * LEXI_TITLE_SAFE.x0;
    const safeX1 = width * LEXI_TITLE_SAFE.x1;
    const safeY0 = height * LEXI_TITLE_SAFE.y0;
    const safeY1 = height * LEXI_TITLE_SAFE.y1;
    for (let i = 0; i < nDust; i++) {
      const a = hash01(i + 5);
      const b = hash01(i + 23);
      const layer = hash01(i + 61);
      const driftU = tMs * 0.00001 * speed * (0.28 + a + layer * 0.32);
      const uu = (a + driftU) % 1;
      const v = 0.16 + b * 0.74;
      const x = uu * width + Math.sin(phase * 0.22 + i) * (1.1 + depthStrength * 1.4);
      const y = v * height + Math.sin(phase * 0.32 + i * 0.5) * (1.0 + shimmer * 2.0);
      if (x > safeX0 && x < safeX1 && y > safeY0 && y < safeY1) continue;
      const far = v < 0.38;
      const alpha = (0.05 + shimmer * 0.18 + ambient * 0.04) * intensity * (0.4 + hash01(i + 41));
      const tint = i % 7 === 0 ? cool : i % 5 === 0 ? highlight : far ? champagne : primary;
      ctx.fillStyle = hexToRgba(tint, alpha);
      ctx.beginPath();
      ctx.arc(x, y, 0.42 + b * (far ? 0.5 : 0.85), 0, Math.PI * 2);
      ctx.fill();
    }

    const falloff = ctx.createLinearGradient(0, height * 0.62, 0, height);
    falloff.addColorStop(0, hexToRgba(secondary, 0));
    falloff.addColorStop(1, hexToRgba(secondary, 0.55 + (1 - ambient) * 0.15));
    ctx.fillStyle = falloff;
    ctx.fillRect(0, height * 0.62, width, height * 0.38);
  },
};
