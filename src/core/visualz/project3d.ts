/**
 * Perspective-project 3D points onto the existing VIS Canvas 2D.
 * Camera + z-fog. No WebGL / Three.js / shaders.
 */

export interface Cam3 {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fov: number;
  near: number;
  far: number;
}

export interface P3 {
  x: number;
  y: number;
  z: number;
  fog: number;
  ok: boolean;
}

export function cam3(partial: Partial<Cam3> = {}): Cam3 {
  return {
    x: 0,
    y: 0.12,
    z: 0,
    yaw: 0,
    pitch: -0.08,
    fov: 1.05,
    near: 0.16,
    far: 16,
    ...partial,
  };
}

/** Yaw that faces (tx, tz) so camera +Z is toward the target. */
export function lookAtYaw(camX: number, camZ: number, tx = 0, tz = 0): number {
  return Math.atan2(-(tx - camX), tz - camZ);
}

export function project3(
  wx: number,
  wy: number,
  wz: number,
  cam: Cam3,
  width: number,
  height: number,
): P3 {
  const dx = wx - cam.x;
  const dy = wy - cam.y;
  const dz = wz - cam.z;
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const x1 = dx * cy + dz * sy;
  const z1 = -dx * sy + dz * cy;
  const y1 = dy * cp - z1 * sp;
  const z2 = dy * sp + z1 * cp;
  if (z2 <= cam.near) return { x: 0, y: 0, z: z2, fog: 0, ok: false };
  const span = Math.max(0.001, cam.far - cam.near);
  const fog = Math.max(0, Math.min(1, 1 - (z2 - cam.near) / span));
  const fl = (height * 0.55) / Math.max(0.18, Math.tan(cam.fov * 0.5));
  return {
    x: width * 0.5 + (x1 / z2) * fl,
    y: height * 0.5 - (y1 / z2) * fl,
    z: z2,
    fog,
    ok: fog > 0.03,
  };
}

export function sortFarFirst<T extends { z: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.z - a.z);
}
