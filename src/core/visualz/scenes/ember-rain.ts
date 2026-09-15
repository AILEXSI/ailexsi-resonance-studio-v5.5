/**
 * Scene: ember-rain — spark rain; bass blows sparks sideways.
 */

import { hexToRgba } from "../color";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

function hash01(n: number): number {
  const x = Math.sin(n * 91.7 + 19.3) * 23421.631;
  return x - Math.floor(x);
}

export const emberRainScene: Scene = {
  id: "ember-rain",
  name: "Ember Rain",
  description: "Falling sparks blown sideways by bass",
  defaultParams: {
    intensity: 0.85,
    colorPrimary: "#ff4d1a",
    colorSecondary: "#140806",
    speed: 1,
    complexity: 0.6,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const count = 48 + Math.floor(params.complexity * 16);
    const blow = (features.bass * 0.22 + features.beatPulse * 0.08) * width * params.intensity;

    for (let i = 0; i < count; i++) {
      const h = hash01(i + 1);
      const h2 = hash01(i + 77);
      const fall = ((features.timeMs * (0.07 + h2 * 0.11) * params.speed + h * height) % (height + 24)) - 12;
      const x = h * width + (h2 - 0.5) * blow;
      const r = 0.8 + h2 * 1.8 + features.rms * 1.2;
      ctx.fillStyle = hexToRgba(i % 3 === 0 ? "#ffd27a" : (params.colorPrimary as string), 0.45 + h2 * 0.4);
      ctx.beginPath();
      ctx.arc(x, fall, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = hexToRgba(params.colorPrimary as string, 0.12 + features.bass * 0.18);
    ctx.fillRect(0, height * 0.88, width, height * 0.12);
  },
};
