/**
 * Scene: star-bloom — starfield + gold core + beat flash.
 */

import { hexToRgba } from "../color";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export const starBloomScene: Scene = {
  id: "star-bloom",
  name: "Star Bloom",
  description: "Starfield with a gold core that flashes on the beat",
  defaultParams: {
    intensity: 0.8,
    colorPrimary: "#ffd76a",
    colorSecondary: "#060816",
    speed: 1,
    complexity: 0.6,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const cx = width / 2;
    const cy = height / 2;
    const stars = 64 + Math.floor(params.complexity * 20);

    for (let i = 0; i < stars; i++) {
      const x = hash01(i + 1) * width;
      const y = hash01(i + 51) * height;
      const twinkle = 0.35 + hash01(i + 9) * 0.65 + features.beatPulse * 0.35;
      const r = 0.55 + hash01(i + 17) * 1.35 + (features.onset ? 0.6 : 0);
      ctx.fillStyle = hexToRgba(i % 5 === 0 ? (params.colorPrimary as string) : "#e8f0ff", twinkle * params.intensity);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const coreR = Math.min(width, height) * (0.07 + features.bass * 0.06) * params.intensity;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
    g.addColorStop(0, "#fff6d0");
    g.addColorStop(0.35, params.colorPrimary as string);
    g.addColorStop(1, hexToRgba(params.colorPrimary as string, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
    ctx.fill();

    if (features.beatPulse > 0.2 || features.onset) {
      for (let f = 0; f < 8; f++) {
        const a = (f / 8) * Math.PI * 2 + features.timeMs * 0.001;
        ctx.fillStyle = hexToRgba("#ffffff", 0.45 + features.beatPulse * 0.4);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * coreR * 2.2, cy + Math.sin(a) * coreR * 2.2, 1.8 + features.beatPulse * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};
