/** Minimal ISO-BMFF helpers for AFE CTTS / sample-table unit tests. */

export function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

export function i32(n: number): Uint8Array {
  return u32(n | 0);
}

export function fourcc(tag: string): Uint8Array {
  return new Uint8Array([tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)]);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(8 + payload.length), fourcc(type), payload);
}

export function fullBox(type: string, version: number, payload: Uint8Array): Uint8Array {
  return box(type, concat(new Uint8Array([version & 0xff, 0, 0, 0]), payload));
}

/** Standalone ctts box (not a complete movie). */
export function cttsBox(version: 0 | 1, entries: { count: number; offset: number }[]): Uint8Array {
  const parts: Uint8Array[] = [u32(entries.length)];
  for (const e of entries) {
    parts.push(u32(e.count));
    parts.push(version === 1 ? i32(e.offset) : u32(e.offset));
  }
  return fullBox("ctts", version, concat(...parts));
}

export function parsedBoxOf(bytes: Uint8Array): {
  type: string;
  start: number;
  size: number;
  headerSize: number;
  payloadStart: number;
  payloadEnd: number;
} {
  return {
    type: "ctts",
    start: 0,
    size: bytes.length,
    headerSize: 8,
    payloadStart: 8,
    payloadEnd: bytes.length,
  };
}