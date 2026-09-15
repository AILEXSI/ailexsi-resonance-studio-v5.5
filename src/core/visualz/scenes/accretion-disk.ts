/**
 * Scene: accretion-disk — dark core + orbiting disk + relativistic ring; bass kicks inner ring.
 */

import { hexToRgba } from "../color";
import { cam3, lookAtYaw, project3, sortFarFirst } from "../project3d";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

type Mark = { x: number; y: number; z: number; r: number; color: string };

export const accretionDiskScene: Scene = {
  id: "accretion-disk",
  name: "Accretion Disk",
  description: "Dark core, orbiting disk, relativistic ring; bass kicks the inner ring",
  defaultParams: {
    intensity: 0.88,
    colorPrimary: "#ff8a1a",
    colorSecondary: "#080402",
    speed: 1,
    complexity: 0.62,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const orbit = features.timeMs * 0.0002 * params.speed;
    const cx = Math.sin(orbit) * 3.4;
    const cz = Math.cos(orbit) * 3.4;
    const cam = cam3({
      x: cx,
      y: 1.35,
      z: cz,
      yaw: lookAtYaw(cx, cz),
      pitch: -0.38,
      far: 11,
    });
    const spin = features.timeMs * 0.0009 * params.speed;
    const kick = 1 + features.bass * 0.55 * params.intensity;
    const marks: Mark[] = [];
    const diskN = 150;
    const ringN = 56;

    for (let i = 0; i < diskN; i++) {
      const u = i / diskN;
      const a = u * Math.PI * 2 * 3.2 + spin;
      const rad = 0.85 + (i % 17) * 0.11;
      const wx = Math.cos(a) * rad;
      const wz = Math.sin(a) * rad;
      const wy = Math.sin(a * 2 + i) * 0.04;
      const p = project3(wx, wy, wz, cam, width, height);
      if (!p.ok) continue;
      const doppler = 0.4 + 0.6 * Math.max(0, Math.cos(a - orbit));
      marks.push({
        x: p.x,
        y: p.y,
        z: p.z,
        r: 1.05 + p.fog * 1.3,
        color: hexToRgba(i % 5 === 0 ? "#ffd27a" : (params.colorPrimary as string), (0.38 + p.fog * 0.5) * Math.max(0.45, doppler) * params.intensity),
      });
    }

    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 + spin * 1.6;
      const rad = 0.52 * kick;
      const p = project3(Math.cos(a) * rad, 0.02, Math.sin(a) * rad, cam, width, height);
      if (!p.ok) continue;
      const doppler = 0.45 + 0.55 * Math.max(0, Math.cos(a - orbit));
      marks.push({
        x: p.x,
        y: p.y,
        z: p.z,
        r: 1.5 + features.beatPulse * 1.4,
        color: hexToRgba("#d8f4ff", (0.4 + p.fog * 0.5) * doppler),
      });
    }

    for (const m of sortFarFirst(marks)) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    const core = project3(0, 0, 0, cam, width, height);
    if (core.ok) {
      const cr = 7 + features.bass * 5;
      ctx.fillStyle = "rgba(0,0,0,0.92)";
      ctx.beginPath();
      ctx.arc(core.x, core.y, cr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexToRgba("#9ad8ff", 0.35 + features.beatPulse * 0.35);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(core.x, core.y, cr * (1.15 + features.beatPulse * 0.2), 0, Math.PI * 2);
      ctx.stroke();
    }
  },
};
