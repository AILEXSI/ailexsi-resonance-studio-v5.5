/**
 * Scene: liquid-gold — flowing wells whose radius jumps on energy.
 */

import { hexToRgba } from "../color";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

export const liquidGoldScene: Scene = {
  id: "liquid-gold",
  name: "Liquid Gold",
  description: "Flowing gold wells that jump with energy",
  defaultParams: {
    intensity: 0.85,
    colorPrimary: "#e6b23a",
    colorSecondary: "#1a1206",
    speed: 1,
    complexity: 0.5,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const wells = 6;
    const energy = features.rms * params.intensity;
    const flow = features.timeMs * 0.0004 * params.speed;

    for (let i = 0; i < wells; i++) {
      const t = (i + 0.5) / wells;
      const x = ((t + flow * (0.2 + i * 0.03)) % 1) * width;
      const y = height * (0.62 + (i % 3) * 0.08);
      const base = Math.min(width, height) * 0.07;
      const radius = base * (1 + energy * 1.35 + (i % 2) * 0.15);
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, "#ffe7a3");
      g.addColorStop(0.45, params.colorPrimary as string);
      g.addColorStop(1, hexToRgba("#8a5a10", 0.15));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = hexToRgba(params.colorPrimary as string, 0.22 + energy * 0.25);
    ctx.fillRect(0, height * 0.78, width, height * 0.22);

    if (features.beatPulse > 0.2) {
      ctx.strokeStyle = hexToRgba("#fff3c4", features.beatPulse * 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, height * 0.78);
      ctx.lineTo(width, height * 0.78);
      ctx.stroke();
    }
  },
};
