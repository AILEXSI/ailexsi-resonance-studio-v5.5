/**
 * Scene: nebula-helix — double helix of light; slow orbit; energy stretches pitch.
 */

import { hexToRgba } from "../color";
import { cam3, lookAtYaw, project3, sortFarFirst } from "../project3d";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

type Mark = { x: number; y: number; z: number; r: number; color: string };

export const nebulaHelixScene: Scene = {
  id: "nebula-helix",
  name: "Nebula Helix",
  description: "Double helix of light; camera orbits; energy stretches pitch",
  defaultParams: {
    intensity: 0.86,
    colorPrimary: "#d24bff",
    colorSecondary: "#0a0614",
    speed: 1,
    complexity: 0.6,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const orbit = features.timeMs * 0.00028 * params.speed;
    const cx = Math.sin(orbit) * 4.1;
    const cz = Math.cos(orbit) * 4.1;
    const cam = cam3({
      x: cx,
      y: 0.55,
      z: cz,
      yaw: lookAtYaw(cx, cz),
      pitch: -0.12,
      far: 12,
    });
    const pitch = 2.35 * (1 + features.rms * 0.95 * params.intensity);
    const turns = 2.2;
    const count = 88;
    const marks: Mark[] = [];

    for (let strand = 0; strand < 2; strand++) {
      const hex = strand === 0 ? (params.colorPrimary as string) : "#3dffe4";
      ctx.strokeStyle = hexToRgba(hex, 0.45 + features.mid * 0.25);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < count; i++) {
        const t = (i / (count - 1)) * Math.PI * 2 * turns;
        const r = 0.72 + features.mid * 0.12;
        const wx = Math.cos(t + strand * Math.PI) * r;
        const wz = Math.sin(t + strand * Math.PI) * r;
        const wy = (i / (count - 1) - 0.5) * pitch;
        const p = project3(wx, wy, wz, cam, width, height);
        if (!p.ok) continue;
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else ctx.lineTo(p.x, p.y);
        marks.push({
          x: p.x,
          y: p.y,
          z: p.z,
          r: 1.7 + p.fog * 1.8 + features.beatPulse * 1.1,
          color: hexToRgba(i % 7 === 0 ? "#ffffff" : hex, (0.42 + p.fog * 0.55) * params.intensity),
        });
      }
      if (started) ctx.stroke();
    }

    for (const m of sortFarFirst(marks)) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
