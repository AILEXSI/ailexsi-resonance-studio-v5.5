/**
 * Scene: kaleido-hex — 8 mirror wedges (lineTo, no rotate/clip).
 */

import { hexToRgba } from "../color";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

export const kaleidoHexScene: Scene = {
  id: "kaleido-hex",
  name: "Kaleido Hex",
  description: "Eight mirrored wedges around the center",
  defaultParams: {
    intensity: 0.8,
    colorPrimary: "#ff2bd6",
    colorSecondary: "#100614",
    speed: 1,
    complexity: 0.65,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const cx = width / 2;
    const cy = height / 2;
    const R = Math.min(width, height) * (0.42 + features.rms * 0.08);
    const spin = features.timeMs * 0.00055 * params.speed;
    const wedges = 8;

    for (let w = 0; w < wedges; w++) {
      const a0 = spin + (w / wedges) * Math.PI * 2;
      const a1 = spin + ((w + 1) / wedges) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const color = w % 2 === 0 ? (params.colorPrimary as string) : "#3de0ff";
      ctx.strokeStyle = hexToRgba(color, 0.55 + features.beatPulse * 0.3);
      ctx.lineWidth = 1.5 + features.beatPulse;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
      ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
      ctx.closePath();
      ctx.stroke();

      const blobR = 6 + features.rms * 10 * params.intensity;
      ctx.fillStyle = hexToRgba(color, 0.55 * params.intensity);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(am) * R * 0.55, cy + Math.sin(am) * R * 0.55, blobR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = hexToRgba("#ffffff", 0.35 + features.beatPulse * 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, 4 + features.bass * 8, 0, Math.PI * 2);
    ctx.fill();
  },
};
