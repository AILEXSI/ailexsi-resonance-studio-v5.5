/** Shared constants for AFE frame-identity media (generator + browser harness). */

export const AFE_WIDTH = 160;
export const AFE_HEIGHT = 90;
export const AFE_CELL = 16;
export const AFE_OX = 8;
export const AFE_OY = 8;
export const AFE_BITS = 16;

/** Paint one RGB24 frame with a 4×4 black/white barcode of `frameIndex`. */
export function paintIdentityFrame(buf, width, height, frameIndex) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      buf[i] = 20;
      buf[i + 1] = 24;
      buf[i + 2] = 32;
    }
  }
  for (let b = 0; b < AFE_BITS; b++) {
    const bit = (frameIndex >> b) & 1;
    const cx = AFE_OX + (b % 4) * AFE_CELL;
    const cy = AFE_OY + Math.floor(b / 4) * AFE_CELL;
    const v = bit ? 255 : 0;
    for (let y = 0; y < AFE_CELL; y++) {
      for (let x = 0; x < AFE_CELL; x++) {
        const i = ((cy + y) * width + (cx + x)) * 3;
        buf[i] = v;
        buf[i + 1] = v;
        buf[i + 2] = v;
      }
    }
  }
  const stripe = 8;
  const hue = frameIndex % 256;
  for (let y = 0; y < height; y++) {
    for (let x = width - stripe; x < width; x++) {
      const i = (y * width + x) * 3;
      buf[i] = hue;
      buf[i + 1] = 255 - hue;
      buf[i + 2] = (hue * 3) & 255;
    }
  }
}

export function readBarcodeFromImageData(data, width) {
  let n = 0;
  for (let b = 0; b < AFE_BITS; b++) {
    const cx = AFE_OX + (b % 4) * AFE_CELL + Math.floor(AFE_CELL / 2);
    const cy = AFE_OY + Math.floor(b / 4) * AFE_CELL + Math.floor(AFE_CELL / 2);
    const i = (cy * width + cx) * 4;
    const bit = (data[i] ?? 0) > 128 ? 1 : 0;
    n |= bit << b;
  }
  return n;
}

export function expectedFrameAtSec(timeSec, fps) {
  if (!Number.isFinite(timeSec) || timeSec < 0) return 0;
  return Math.max(0, Math.floor(timeSec * fps + 1e-9));
}

export function classifyFrameHit(expected, actual) {
  if (actual == null || !Number.isFinite(actual)) return "UNKNOWN";
  const delta = actual - expected;
  if (delta === 0) return "EXACT";
  if (Math.abs(delta) === 1) return "WITHIN 1 FRAME";
  return ">1 FRAME ERROR";
}

export function uniqueTimes(values) {
  const out = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (out.some((x) => Math.abs(x - v) < 1e-6)) continue;
    out.push(v);
  }
  return out;
}

/** Deterministic mulberry32 — same timestamps every harness run. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
