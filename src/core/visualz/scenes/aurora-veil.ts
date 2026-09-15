/**
 * Scene: aurora-veil — Canvas 2D curtains that breathe with bass.
 */

import { hexToRgba } from "../color";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

export const auroraVeilScene: Scene = {
  id: "aurora-veil",
  name: "Aurora Veil",
  description: "Vertical curtains that breathe with bass",
  defaultParams: {
    intensity: 0.82,
    colorPrimary: "#3cffc0",
    colorSecondary: "#04140f",
    speed: 1,
    complexity: 0.55,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const curtains = 9;
    const breath = 0.42 + features.bass * 0.55 * params.intensity;
    const drift = features.timeMs * 0.00035 * params.speed;

    for (let i = 0; i < curtains; i++) {
      const t = (i + 0.5) / curtains;
      const x = ((t + drift * (0.15 + (i % 3) * 0.04)) % 1) * width;
      const w = (width / curtains) * breath * (0.85 + (i % 2) * 0.25);
      const alpha = (0.16 + features.rms * 0.22) * params.intensity;
      const grad = ctx.createLinearGradient(x, 0, x, height);
      const top = i % 2 === 0 ? params.colorPrimary as string : "#7dff6a";
      grad.addColorStop(0, hexToRgba(top, 0));
      grad.addColorStop(0.35, hexToRgba(top, alpha));
      grad.addColorStop(0.7, hexToRgba("#2ad4ff", alpha * 0.7));
      grad.addColorStop(1, hexToRgba(top, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(x - w / 2, 0, w, height);
    }

    if (features.beatPulse > 0.15) {
      ctx.fillStyle = hexToRgba("#ffffff", features.beatPulse * 0.08);
      ctx.fillRect(0, height * 0.35, width, height * 0.08);
    }
  },
};
