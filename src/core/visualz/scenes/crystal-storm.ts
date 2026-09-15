/**
 * Scene: crystal-storm — rotating 3D shards; high glitters; bass explodes then falls back.
 */

import { hexToRgba } from "../color";
import { cam3, lookAtYaw, project3, sortFarFirst } from "../project3d";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

function hash01(n: number): number {
  const x = Math.sin(n * 91.7 + 19.3) * 23421.631;
  return x - Math.floor(x);
}

type Mark = { x: number; y: number; z: number; color: string; pts: Array<{ x: number; y: number }> };

export const crystalStormScene: Scene = {
  id: "crystal-storm",
  name: "Crystal Storm",
  description: "Rotating 3D shards; high = glitter; bass explodes outward then falls back",
  defaultParams: {
    intensity: 0.86,
    colorPrimary: "#b8e8ff",
    colorSecondary: "#071018",
    speed: 1,
    complexity: 0.6,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const orbit = features.timeMs * 0.00018 * params.speed;
    const cx = Math.sin(orbit) * 3.6;
    const cz = Math.cos(orbit) * 3.6;
    const cam = cam3({
      x: cx,
      y: 0.7,
      z: cz,
      yaw: lookAtYaw(cx, cz),
      pitch: -0.16,
      far: 12,
    });
    const explode = 1 + features.bass * 1.35 * params.intensity * (0.28 + features.beatPulse * 0.72);
    const spin = features.timeMs * 0.0011 * params.speed;
    const shards = 72;
    const marks: Mark[] = [];

    for (let i = 0; i < shards; i++) {
      const a = hash01(i + 1) * Math.PI * 2;
      const b = hash01(i + 40) * Math.PI;
      const base = 0.45 + hash01(i + 8) * 1.15;
      const cx = Math.cos(a) * Math.sin(b) * base * explode;
      const cy = (Math.cos(b) * base - 0.1) * explode;
      const cz = Math.sin(a) * Math.sin(b) * base * explode;
      const rot = spin + i * 0.35;
      const s = 0.16 + hash01(i + 21) * 0.12;
      const verts = [
        [s, 0, 0],
        [-s * 0.4, s, 0.05],
        [-s * 0.4, -s, -0.05],
      ];
      const pts: Array<{ x: number; y: number }> = [];
      let zSum = 0;
      let ok = 0;
      for (const v of verts) {
        const xr = v[0]! * Math.cos(rot) - v[2]! * Math.sin(rot);
        const zr = v[0]! * Math.sin(rot) + v[2]! * Math.cos(rot);
        const p = project3(cx + xr, cy + v[1]!, cz + zr, cam, width, height);
        if (!p.ok) continue;
        pts.push(p);
        zSum += p.z;
        ok += 1;
      }
      if (ok < 3) continue;
      marks.push({
        x: pts[0]!.x,
        y: pts[0]!.y,
        z: zSum / 3,
        color: hexToRgba(i % 4 === 0 ? "#ffffff" : (params.colorPrimary as string), (0.5 + features.treble * 0.35) * params.intensity),
        pts,
      });
    }

    for (const m of sortFarFirst(marks)) {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(m.pts[0]!.x, m.pts[0]!.y);
      ctx.lineTo(m.pts[1]!.x, m.pts[1]!.y);
      ctx.lineTo(m.pts[2]!.x, m.pts[2]!.y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.2 + features.treble * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    const glitter = 28 + Math.floor(features.treble * 24);
    for (let g = 0; g < glitter; g++) {
      const a = hash01(g + 200) * Math.PI * 2;
      const b = hash01(g + 260) * Math.PI;
      const rad = (0.3 + hash01(g + 9) * 2.2) * explode;
      const p = project3(
        Math.cos(a) * Math.sin(b) * rad,
        Math.cos(b) * rad * 0.7,
        Math.sin(a) * Math.sin(b) * rad,
        cam,
        width,
        height,
      );
      if (!p.ok) continue;
      ctx.fillStyle = hexToRgba("#ffffff", (0.2 + features.treble * 0.55) * p.fog);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.7 + features.treble * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};
