/**
 * Software 2D context for VIS pixel tests in jsdom.
 * Implements the Canvas calls Visualz scenes actually make and writes RGBA.
 */

type Color = { r: number; g: number; b: number; a: number };

interface Grad {
  kind: "linear" | "radial";
  stops: Array<{ t: number; c: Color }>;
  addColorStop: (t: number, color: string) => void;
}

type Cmd =
  | { op: "move"; x: number; y: number }
  | { op: "line"; x: number; y: number }
  | { op: "quad"; x1: number; y1: number; x: number; y: number }
  | { op: "arc"; x: number; y: number; r: number; a0: number; a1: number }
  | { op: "close" };

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseColor(input: string | Grad | Color): Color {
  if (typeof input !== "string") {
    if (input && "stops" in input && input.stops.length) {
      return input.stops[0]!.c;
    }
    if (input && "r" in input) return input;
    return { r: 0, g: 0, b: 0, a: 255 };
  }
  const s = input.trim();
  const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgba) {
    return {
      r: clampByte(Number(rgba[1])),
      g: clampByte(Number(rgba[2])),
      b: clampByte(Number(rgba[3])),
      a: rgba[4] == null ? 255 : clampByte(Number(rgba[4]) * 255),
    };
  }
  const hex = s.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length >= 6 && /^[0-9a-fA-F]+$/.test(full)) {
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 255,
    };
  }
  return { r: 255, g: 255, b: 255, a: 255 };
}

function makeGrad(): Grad {
  const g: Grad = {
    kind: "radial",
    stops: [],
    addColorStop(t: number, color: string) {
      g.stops.push({ t, c: parseColor(color) });
    },
  };
  return g;
}

export function createPixelCanvas(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  let fillStyle: string | Grad = "#000000";
  let strokeStyle: string | Grad = "#ffffff";
  let globalAlpha = 1;
  let lineWidth = 1;
  let path: Cmd[] = [];

  const put = (x: number, y: number, c: Color, alphaMul = 1) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
    const a = (c.a / 255) * globalAlpha * alphaMul;
    if (a <= 0) return;
    const i = (iy * width + ix) * 4;
    const ia = 1 - a;
    data[i] = clampByte(c.r * a + (data[i] ?? 0) * ia);
    data[i + 1] = clampByte(c.g * a + (data[i + 1] ?? 0) * ia);
    data[i + 2] = clampByte(c.b * a + (data[i + 2] ?? 0) * ia);
    data[i + 3] = clampByte(Math.min(255, (data[i + 3] ?? 0) + c.a * a));
  };

  const fillRectPx = (x: number, y: number, w: number, h: number, c: Color) => {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(width, Math.ceil(x + w));
    const y1 = Math.min(height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) put(xx, yy, c);
    }
  };

  const fillDisk = (cx: number, cy: number, r: number, c: Color) => {
    const rr = Math.max(0.5, r);
    const x0 = Math.floor(cx - rr);
    const x1 = Math.ceil(cx + rr);
    const y0 = Math.floor(cy - rr);
    const y1 = Math.ceil(cy + rr);
    const r2 = rr * rr;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) put(x, y, c);
      }
    }
  };

  const strokeDisk = (cx: number, cy: number, r: number, c: Color) => {
    const lw = Math.max(1, lineWidth);
    const samples = Math.max(16, Math.ceil(r * 8));
    for (let i = 0; i <= samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      put(cx + Math.cos(a) * r, cy + Math.sin(a) * r, c);
      if (lw > 1) fillDisk(cx + Math.cos(a) * r, cy + Math.sin(a) * r, lw * 0.5, c);
    }
  };

  const strokeSeg = (x0: number, y0: number, x1: number, y1: number, c: Color) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      put(x0 + dx * t, y0 + dy * t, c);
    }
  };

  const ctx = {
    canvas: { width, height },
    get fillStyle() {
      return fillStyle as string;
    },
    set fillStyle(v: string | Grad) {
      fillStyle = v;
    },
    get strokeStyle() {
      return strokeStyle as string;
    },
    set strokeStyle(v: string | Grad) {
      strokeStyle = v;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(v: number) {
      globalAlpha = v;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(v: number) {
      lineWidth = v;
    },
    font: "",
    fillRect(x: number, y: number, w: number, h: number) {
      fillRectPx(x, y, w, h, parseColor(fillStyle));
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      const c = parseColor(strokeStyle);
      strokeSeg(x, y, x + w, y, c);
      strokeSeg(x + w, y, x + w, y + h, c);
      strokeSeg(x + w, y + h, x, y + h, c);
      strokeSeg(x, y + h, x, y, c);
    },
    beginPath() {
      path = [];
    },
    closePath() {
      path.push({ op: "close" });
    },
    moveTo(x: number, y: number) {
      path.push({ op: "move", x, y });
    },
    lineTo(x: number, y: number) {
      path.push({ op: "line", x, y });
    },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
      path.push({ op: "quad", x1: cpx, y1: cpy, x, y });
    },
    arc(x: number, y: number, r: number, a0: number, a1: number) {
      path.push({ op: "arc", x, y, r, a0, a1 });
    },
    fill() {
      const c = parseColor(fillStyle);
      for (const cmd of path) {
        if (cmd.op === "arc") fillDisk(cmd.x, cmd.y, cmd.r, c);
      }
      let px = 0;
      let py = 0;
      for (const cmd of path) {
        if (cmd.op === "move" || cmd.op === "line") {
          if (cmd.op === "line") strokeSeg(px, py, cmd.x, cmd.y, c);
          px = cmd.x;
          py = cmd.y;
        } else if (cmd.op === "quad") {
          for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            const mt = 1 - t;
            const x = mt * mt * px + 2 * mt * t * cmd.x1 + t * t * cmd.x;
            const y = mt * mt * py + 2 * mt * t * cmd.y1 + t * t * cmd.y;
            put(x, y, c);
          }
          px = cmd.x;
          py = cmd.y;
        }
      }
    },
    stroke() {
      const c = parseColor(strokeStyle);
      let px = 0;
      let py = 0;
      for (const cmd of path) {
        if (cmd.op === "arc") strokeDisk(cmd.x, cmd.y, cmd.r, c);
        else if (cmd.op === "move") {
          px = cmd.x;
          py = cmd.y;
        } else if (cmd.op === "line") {
          strokeSeg(px, py, cmd.x, cmd.y, c);
          px = cmd.x;
          py = cmd.y;
        } else if (cmd.op === "quad") {
          for (let i = 0; i <= 12; i++) {
            const t = i / 12;
            const mt = 1 - t;
            const x = mt * mt * px + 2 * mt * t * cmd.x1 + t * t * cmd.x;
            const y = mt * mt * py + 2 * mt * t * cmd.y1 + t * t * cmd.y;
            put(x, y, c);
            if (i > 0) {
              /* sampled */
            }
          }
          px = cmd.x;
          py = cmd.y;
        }
      }
    },
    fillText() {
      /* unused by Visualz scenes */
    },
    createRadialGradient() {
      return makeGrad();
    },
    createLinearGradient() {
      return makeGrad();
    },
    getImageData() {
      return { width, height, data };
    },
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    width,
    height,
    data,
    nonemptyCount(): number {
      let n = 0;
      for (let i = 3; i < data.length; i += 4) {
        if ((data[i] ?? 0) > 0 && ((data[i - 3] ?? 0) | (data[i - 2] ?? 0) | (data[i - 1] ?? 0))) n += 1;
      }
      return n;
    },
    fingerprint(): string {
      let h = 2166136261;
      for (let i = 0; i < data.length; i++) {
        h ^= data[i] ?? 0;
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16);
    },
  };
}
