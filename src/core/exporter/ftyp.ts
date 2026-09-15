const WEBM_EBML = [0x1a, 0x45, 0xdf, 0xa3];

function readFourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

export function looksLikeWebm(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return WEBM_EBML.every((b, i) => bytes[i] === b);
}

export interface FtypCheck {
  ok: boolean;
  brands: string[];
  error?: string;
}

export function validateMp4Ftyp(bytes: Uint8Array): FtypCheck {
  if (looksLikeWebm(bytes)) {
    return { ok: false, brands: [], error: "File is WebM, not MP4. WebM is not a success." };
  }
  if (bytes.length < 16) {
    return { ok: false, brands: [], error: "File too short to be an MP4" };
  }
  const size = readU32(bytes, 0);
  const type = readFourcc(bytes, 4);
  if (type !== "ftyp") {
    return { ok: false, brands: [], error: `Expected ftyp box, got ${JSON.stringify(type)}` };
  }
  if (size < 16 || size > bytes.length) {
    return { ok: false, brands: [], error: `Invalid ftyp size ${size}` };
  }
  const major = readFourcc(bytes, 8);
  const brands = [major];
  for (let i = 16; i + 4 <= size; i += 4) {
    brands.push(readFourcc(bytes, i));
  }
  return { ok: true, brands };
}

export function hexHeader(bytes: Uint8Array, length = 16): string {
  return Array.from(bytes.slice(0, length))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}
