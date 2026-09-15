/**
 * Scene: sun-core — white core + corona + expanding ring.
 */

import { hexToRgba } from "../color";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

export const sunCoreScene: Scene = {
  id: "sun-core",
  name: "Sun Core",
  description: "White core, yellow corona, expanding beat ring",
  defaultParams: {
    intensity: 0.85,
    colorPrimary: "#ffcc33",
    colorSecondary: "#1a0c04",
    speed: 1,
    complexity: 0.5,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const cx = width / 2;
    const cy = height / 2;
    const coreR = Math.min(width, height) * (0.09 + features.bass * 0.05) * params.intensity;

    const corona = ctx.createRadialGradient(cx, cy, coreR * 0.2, cx, cy, coreR * 4.2);
    corona.addColorStop(0, "#ffffff");
    corona.addColorStop(0.22, "#fff4c2");
    corona.addColorStop(0.5, hexToRgba(params.colorPrimary as string, 0.7));
    corona.addColorStop(1, hexToRgba("#ff7a1a", 0));
    ctx.fillStyle = corona;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 4.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    const ringR = coreR * (2.4 + features.beatPulse * 1.6);
    ctx.strokeStyle = hexToRgba("#ffe08a", 0.35 + features.beatPulse * 0.5);
    ctx.lineWidth = 2 + features.beatPulse * 5;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
  },
};
