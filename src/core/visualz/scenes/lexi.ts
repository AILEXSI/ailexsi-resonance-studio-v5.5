/**
 * Scene: lexi — AILEXSI flagship LEXI V3 (Cinematic Depth & Impact).
 * Perspective terrain, vanishing point, FG/MG/BG, musical form — not V2 + glow.
 * Preview and Export both read presented AudioFeatures (applyVisResponse).
 */

import { hexToRgba } from "../color";
import { cam3, project3 } from "../project3d";
import {
  lexiAccent,
  lexiFormShift,
  lexiGlow,
  lexiHighlightBloom,
  lexiHorizonBody,
  lexiHorizonLift,
  lexiPeakBias,
  lexiPressureWave,
  lexiSheen,
  lexiTerrainSpread,
} from "../scene-impact";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";
import {
  LEXI_DEFAULT_THEME,
  LEXI_THEMES,
  LEXI_TITLE_SAFE,
  isLexiThemeId,
  resolveLexiTheme,
} from "./lexi-theme";

export {
  LEXI_DEFAULT_THEME,
  LEXI_THEMES,
  LEXI_TITLE_SAFE,
  isLexiThemeId,
  resolveLexiTheme,
};
export type { LexiThemeId } from "./lexi-theme";

/** FG / MG / BG. Visible depth stack, not a flat horizon wash. */
export const LEXI_V3_DEPTH_PLANES = 3;
export const LEXI_V3_LIGHT_BANDS = 4;

const MAX_MERIDIANS = 24;
const MAX_CONTOURS = 18;
const MAX_ALONG = 28;
const MAX_BAND = 40;
const MAX_RING = 42;
const MAX_STROKE = 48;
const PARTICLE_CAP = 48;

const zs = new Float32Array(MAX_CONTOURS);
const px = new Float32Array(MAX_STROKE);
const py = new Float32Array(MAX_STROKE);
const pok = new Uint8Array(MAX_STROKE);

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
  const liftY = lift * (0.1 + near * 0.48);
  const bodyY = body * near * 0.16;
  const formY =
    Math.sin(x * (0.26 + form * 0.2) + z * 0.15 + localPhase * 0.2) * form * 0.4 +
    Math.sin(x * 0.13 - z * 0.08 + localPhase * 0.1) * form * 0.18;
  const dx = x - peakX;
  const dz = z - peakZ;
  const peak = form * Math.exp(-(dx * dx * 0.7 + dz * dz * 0.2)) * (0.78 + lift * 0.38);
  const peak2x = -1.18 + spread * 0.15;
  const peak2 = form * 0.36 * Math.exp(-((x - peak2x) * (x - peak2x) * 1.05 + (z - 4.35) * (z - 4.35) * 0.28));
  const valley = -0.07 * (1 - Math.min(1, Math.abs(x) * 0.22)) * u;
  const ridge = Math.sin(x * 0.82 + z * 0.36 + localPhase * 0.38) * waveAmp * 0.11 * near;
  const kick = accent * near * 0.07 * Math.cos(z * 2.05);
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

export const lexiScene: Scene = {
  id: "lexi",
  name: "LEXI",
  description: "Cinematic depth — vanishing terrain, pressure waves, musical form",
  defaultParams: {
    intensity: 0.86,
    colorPrimary: DEFAULT_GOLD.colorPrimary,
    colorSecondary: DEFAULT_GOLD.colorSecondary,
    speed: 0.78,
    complexity: 0.58,
    glowStrength: 0.62,
    lineThickness: 0.6,
    waveAmplitude: 0.7,
    depthStrength: 0.82,
    reactivity: 0.84,
    smoothing: 0.68,
    particleAmount: 0.38,
    backgroundLevel: 0.08,
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
    const glowStrength = num(params.glowStrength, 0.62);
    const lineThickness = num(params.lineThickness, 0.6);
    const waveAmplitude = num(params.waveAmplitude, 0.7);
    const depthStrength = num(params.depthStrength, 0.82);
    const reactivity = num(params.reactivity, 0.84);
    const smoothing = clamp01(num(params.smoothing, 0.68));
    const particleAmount = clamp01(num(params.particleAmount, 0.38));
    const backgroundLevel = clamp01(num(params.backgroundLevel, 0.08));
    const speed = num(params.speed, 0.78);
    const complexity = clamp01(num(params.complexity, 0.58));
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
    const form = lexiFormShift(presented, intensity) * reactivity;
    const pressure = lexiPressureWave(presented) * reactivity;
    const bloom = lexiHighlightBloom(presented, intensity) * glowStrength * reactivity;
    const idle = 0.14 + (1 - reactivity) * 0.08;
    const shimmer = clamp01(sTreble * 0.92) * reactivity;

    phase += dt * speed * (0.18 + sRms * 0.32 + idle * 0.06);
    const tMs = features.timeMs;
    const peakX = lexiPeakBias(tMs, speed);
    const peakZ = 3.05 + Math.sin(tMs * 0.00007 * speed) * 0.32;

    const meridians = Math.max(12, Math.min(MAX_MERIDIANS, 12 + Math.round(complexity * 12)));
    const contours = Math.max(9, Math.min(MAX_CONTOURS, 9 + Math.round(complexity * 9)));
    const along = Math.max(16, Math.min(MAX_ALONG, 16 + Math.round(complexity * 10)));

    ctx.fillStyle = secondary;
    ctx.fillRect(0, 0, width, height);
    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.46);
    sky.addColorStop(0, hexToRgba(accentHex, 0.05 + backgroundLevel * 0.06));
    sky.addColorStop(1, hexToRgba(secondary, 0));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height * 0.46);

    const cam = cam3({
      x: Math.sin(tMs * 0.000026 * speed) * 0.22 * (0.5 + depthStrength),
      y: 1.14 + lift * 0.16 - form * 0.05,
      z: -0.78 + Math.sin(tMs * 0.000018 * speed) * 0.07,
      yaw: Math.sin(tMs * 0.00002 * speed) * 0.04 * (0.5 + depthStrength),
      pitch: -0.37 - depthStrength * 0.028 + lift * 0.018,
      fov: 1.08,
      far: 14 + depthStrength * 2.4,
    });

    const zNear = 1.28;
    const zFar = 8.4 + depthStrength * 2.2;
    const xSpan = 5.2 + depthStrength * 0.7;
    const waveAmp = waveAmplitude * (idle + form * 0.35 + lift * 0.22);

    const worldX = (col: number, uNear: number) => {
      const raw = -xSpan + (2 * xSpan * col) / (meridians - 1);
      return raw * (1 + spread * 0.42 * uNear);
    };

    const sampleY = (x: number, z: number) =>
      terrainY(x, z, zNear, zFar, lift, body, form, spread, waveAmp, accent, peakX, peakZ, phase);

    for (let row = 0; row < contours; row++) {
      zs[row] = zNear + ((zFar - zNear) * row) / (contours - 1);
    }

    let vpX = width * 0.5;
    let vpY = height * 0.4;
    const vp = project3(0, 0.01, zFar, cam, width, height);
    if (vp.ok) {
      vpX = vp.x;
      vpY = vp.y;
    }

    let peakSx = width * 0.58;
    let peakSy = height * 0.52;
    const peakP = project3(peakX, sampleY(peakX, peakZ) + 0.04, peakZ, cam, width, height);
    if (peakP.ok) {
      peakSx = peakP.x;
      peakSy = peakP.y;
    }

    const nearL = project3(worldX(0, 1), sampleY(worldX(0, 1), zNear), zNear, cam, width, height);
    const nearR = project3(worldX(meridians - 1, 1), sampleY(worldX(meridians - 1, 1), zNear), zNear, cam, width, height);
    const farL = project3(worldX(0, 0), sampleY(worldX(0, 0), zFar), zFar, cam, width, height);
    const farR = project3(worldX(meridians - 1, 0), sampleY(worldX(meridians - 1, 0), zFar), zFar, cam, width, height);
    if (nearL.ok && nearR.ok && farL.ok && farR.ok) {
      const plane = ctx.createLinearGradient(0, Math.min(nearL.y, nearR.y), 0, vpY);
      const planeA = (0.045 + lift * 0.12 + body * 0.08 + form * 0.05) * intensity;
      plane.addColorStop(0, hexToRgba(primary, planeA * 1.15));
      plane.addColorStop(0.55, hexToRgba(primary, planeA * 0.45));
      plane.addColorStop(1, hexToRgba(secondary, 0));
      ctx.fillStyle = plane;
      ctx.beginPath();
      ctx.moveTo(nearL.x, nearL.y);
      ctx.lineTo(nearR.x, nearR.y);
      ctx.lineTo(farR.x, farR.y);
      ctx.lineTo(farL.x, farL.y);
      ctx.closePath();
      ctx.fill();
    }

    const vpGlow = ctx.createRadialGradient(vpX, vpY, 1, vpX, vpY, width * (0.055 + bloom * 0.04));
    vpGlow.addColorStop(0, hexToRgba(highlight, (0.1 + bloom * 0.22 + accent * 0.08) * intensity));
    vpGlow.addColorStop(0.42, hexToRgba(champagne, (0.045 + bloom * 0.08) * intensity));
    vpGlow.addColorStop(1, hexToRgba(primary, 0));
    ctx.fillStyle = vpGlow;
    ctx.fillRect(vpX - width * 0.12, vpY - height * 0.1, width * 0.24, height * 0.2);

    const drawMeridians = (plane: 0 | 1 | 2) => {
      for (let col = 0; col < meridians; col++) {
        let n = 0;
        for (let i = 0; i < along; i++) {
          const u = i / (along - 1);
          if (planeOf(u) !== plane) {
            pok[n] = 0;
            n += 1;
            continue;
          }
          const z = zNear + (zFar - zNear) * u;
          const x = worldX(col, 1 - u);
          const p = project3(x, sampleY(x, z), z, cam, width, height);
          px[n] = p.x;
          py[n] = p.y;
          pok[n] = p.ok ? 1 : 0;
          n += 1;
        }
        const nearness = plane === 0 ? 1 : plane === 1 ? 0.55 : 0.22;
        const sheen = lexiSheen(presented, col / Math.max(1, meridians - 1));
        const a = (0.05 + nearness * 0.16 + lift * 0.08 + form * 0.04 + sheen * shimmer * 0.08) * intensity;
        const w = (0.55 + nearness * (1.15 + lineThickness * 0.9 + body * 0.7)) * (plane === 0 ? 1 : 0.75);
        strokeProjected(ctx, n, hexToRgba(col % 3 === 0 ? champagne : primary, a), w);
      }
    };

    const drawContours = (plane: 0 | 1 | 2) => {
      for (let row = contours - 1; row >= 0; row--) {
        const z = zs[row]!;
        const u = (z - zNear) / (zFar - zNear);
        if (planeOf(u) !== plane) continue;
        let n = 0;
        for (let col = 0; col < meridians; col++) {
          const x = worldX(col, 1 - u);
          const p = project3(x, sampleY(x, z), z, cam, width, height);
          px[n] = p.x;
          py[n] = p.y;
          pok[n] = p.ok ? 1 : 0;
          n += 1;
        }
        const nearness = plane === 0 ? 1 : plane === 1 ? 0.5 : 0.2;
        const a = (0.045 + nearness * 0.14 + body * 0.07 + glow * 0.03) * intensity;
        const w = 0.55 + nearness * (1.05 + lineThickness * 0.7 + lift * 0.45);
        strokeProjected(ctx, n, hexToRgba(row % 2 === 0 ? primary : accentHex, a), w);
      }
    };

    drawMeridians(2);
    drawContours(2);

    const bandN = Math.max(18, Math.min(MAX_BAND, 22 + Math.round(complexity * 12)));
    for (let b = LEXI_V3_LIGHT_BANDS - 1; b >= 0; b--) {
      const u = b / (LEXI_V3_LIGHT_BANDS - 1);
      const z0 = lerp(2.15, 7.1, u);
      let n = 0;
      for (let i = 0; i < bandN; i++) {
        const s = i / (bandN - 1);
        const x =
          lerp(-xSpan * 0.82, xSpan * 0.82, s) +
          Math.sin(s * Math.PI * 2.1 + phase * 0.55 + b * 0.9) * (0.28 + form * 0.45 + spread * 0.2);
        const z = z0 + Math.sin(s * Math.PI * 3.2 + phase * 0.4 + b) * (0.22 + form * 0.18);
        const y = sampleY(x, z) + 0.035 + form * 0.025;
        const p = project3(x, y, z, cam, width, height);
        px[n] = p.x;
        py[n] = p.y;
        pok[n] = p.ok ? 1 : 0;
        n += 1;
      }
      const nearness = 1 - u;
      const sheen = lexiSheen(presented, 0.35 + u * 0.4);
      const a = (0.08 + nearness * 0.16 + form * 0.1 + lift * 0.05 + sheen * shimmer * 0.1) * intensity;
      const w = 0.8 + nearness * (1.6 + lineThickness * 1.1 + body * 0.8);
      strokeProjected(ctx, n, hexToRgba(b % 2 === 0 ? champagne : primary, a), w);
      if (nearness > 0.45) {
        strokeProjected(ctx, n, hexToRgba(highlight, a * 0.45 + shimmer * 0.1), Math.max(0.7, w * 0.28));
      }
    }

    drawMeridians(1);
    drawContours(1);
    drawMeridians(0);
    drawContours(0);

    if (pressure > 0.06) {
      const rings = 2;
      for (let r = 0; r < rings; r++) {
        const progress = clamp01(1 - (pressure - r * 0.2));
        const radius = 0.38 + progress * (2.35 + r * 0.7) + lift * 0.15;
        const cx = peakX * 0.22;
        const cz = 2.05 + r * 0.12;
        let n = 0;
        for (let i = 0; i < MAX_RING; i++) {
          const a = (i / (MAX_RING - 1)) * Math.PI * 2;
          const x = cx + Math.cos(a) * radius * (1.05 + spread * 0.25);
          const z = cz + Math.sin(a) * radius * 1.55;
          const y = sampleY(x, z) + 0.03;
          const p = project3(x, y, z, cam, width, height);
          px[n] = p.x;
          py[n] = p.y;
          pok[n] = p.ok ? 1 : 0;
          n += 1;
        }
        const a = (0.1 + pressure * 0.38 - r * 0.08) * intensity;
        strokeProjected(ctx, n, hexToRgba(r === 0 ? champagne : primary, a), 1.1 + pressure * 1.4 + lineThickness * 0.4);
        strokeProjected(ctx, n, hexToRgba(highlight, a * 0.35), 0.7);
      }
    }

    if (bloom > 0.04 || form > 0.12) {
      const peakGlow = ctx.createRadialGradient(peakSx, peakSy, 1, peakSx, peakSy, width * (0.035 + form * 0.03 + bloom * 0.02));
      peakGlow.addColorStop(0, hexToRgba(highlight, (0.08 + bloom * 0.2 + form * 0.08) * intensity));
      peakGlow.addColorStop(0.5, hexToRgba(champagne, (0.035 + bloom * 0.08) * intensity));
      peakGlow.addColorStop(1, hexToRgba(primary, 0));
      ctx.fillStyle = peakGlow;
      ctx.fillRect(peakSx - width * 0.08, peakSy - height * 0.08, width * 0.16, height * 0.16);
    }

    const nDust = Math.round(PARTICLE_CAP * particleAmount * (0.08 + shimmer * 0.92));
    const safeX0 = width * LEXI_TITLE_SAFE.x0;
    const safeX1 = width * LEXI_TITLE_SAFE.x1;
    const safeY0 = height * LEXI_TITLE_SAFE.y0;
    const safeY1 = height * LEXI_TITLE_SAFE.y1;
    for (let i = 0; i < nDust; i++) {
      const a = hash01(i + 5);
      const b = hash01(i + 23);
      const layer = hash01(i + 61);
      const driftU = tMs * 0.000012 * speed * (0.3 + a + layer * 0.35);
      const uu = (a + driftU) % 1;
      const v = 0.22 + b * 0.72;
      const x = uu * width + Math.sin(phase * 0.28 + i) * (1.2 + depthStrength * 1.6);
      const y = v * height + Math.sin(phase * 0.4 + i * 0.55) * (1.1 + shimmer * 2.4);
      if (x > safeX0 && x < safeX1 && y > safeY0 && y < safeY1) continue;
      const far = v < 0.4;
      const alpha = (0.06 + shimmer * 0.22) * intensity * (0.4 + hash01(i + 41));
      ctx.fillStyle = hexToRgba(i % 5 === 0 ? highlight : far ? champagne : primary, alpha);
      ctx.beginPath();
      ctx.arc(x, y, 0.45 + b * (far ? 0.55 : 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
