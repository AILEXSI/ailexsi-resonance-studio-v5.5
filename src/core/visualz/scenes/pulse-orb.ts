/**
 * Scene: pulse-orb — Visualz builtin (b67410c).
 * Soft glowing orb that breathes with bass and flashes on onset.
 */

import { hexToRgba } from "../color";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

export const pulseOrbScene: Scene = {
  id: "pulse-orb",
  name: "Pulse Orb",
  description: "Soft radial glow driven by bass + onset flash",
  defaultParams: {
    intensity: 0.75,
    colorPrimary: "#ff6b35",
    colorSecondary: "#0a0a12",
    speed: 1,
    complexity: 0.4,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const cx = width / 2;
    const cy = height / 2;

    const baseRadius = Math.min(width, height) * 0.18;
    const breath = 1 + features.bass * 0.55 * params.intensity;
    const flash = features.onset ? 1.35 : 1 + features.beatPulse * 0.45;
    const radius = baseRadius * breath * flash;

    for (let i = 8; i >= 1; i--) {
      const r = radius * (1 + i * 0.28);
      const alpha = (0.07 / i) * params.intensity * (0.6 + features.rms);
      const g = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, r);
      g.addColorStop(0, hexToRgba(params.colorPrimary as string, alpha * 1.5));
      g.addColorStop(1, hexToRgba(params.colorPrimary as string, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    core.addColorStop(0, "#ffffff");
    core.addColorStop(0.25, params.colorPrimary as string);
    core.addColorStop(1, hexToRgba(params.colorPrimary as string, 0.15));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    if (features.beatPulse > 0.05 || features.onset) {
      ctx.strokeStyle = hexToRgba("#ffffff", features.beatPulse * 0.5);
      ctx.lineWidth = 2 + features.beatPulse * 4;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (1.15 + features.beatPulse * 0.3), 0, Math.PI * 2);
      ctx.stroke();

      const sparks = 12;
      for (let s = 0; s < sparks; s++) {
        const a = (s / sparks) * Math.PI * 2 + features.timeMs * 0.002;
        const d = radius * (1.35 + (s % 3) * 0.12 + features.beatPulse * 0.2);
        const sr = 1.4 + features.beatPulse * 2.2;
        ctx.fillStyle = s % 2 === 0 ? hexToRgba("#ffffff", 0.55 + features.beatPulse * 0.4) : hexToRgba(params.colorPrimary as string, 0.7);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, sr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};
