/**
 * AVC SPS VUI bitstream_restriction — Chromium / WebView2 tail B-frames.
 *
 * When VUI omits bitstream_restriction, some Chromium VideoDecoder builds
 * infer max_dec_frame_buffering as if there were no B-frames and drop the
 * last delayed pictures at EOS. Communicate the inferred DPB size in avcC
 * and in-band SPS. Exact PTS mapping is unchanged.
 */

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/** H.264 Table A-1 MaxDpbMbs by level_idc (10 = 1.0). */
const MAX_DPB_MBS: [number, number][] = [
  [10, 396],
  [11, 900],
  [12, 2376],
  [13, 2376],
  [20, 2376],
  [21, 4752],
  [22, 8100],
  [30, 8100],
  [31, 18000],
  [32, 20480],
  [40, 32768],
  [41, 32768],
  [42, 34816],
  [50, 110400],
  [51, 184320],
  [52, 184320],
];

export type AvcSpsRestrictionInfo = {
  bitstreamRestrictionFlag: number | null;
  vuiPresent: boolean;
  numReorderFrames: number;
  maxDecFrameBuffering: number;
  needsPatch: boolean;
};

class BitReader {
  readonly bytes: Uint8Array;
  pos = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get bitLength(): number {
    return this.bytes.length * 8;
  }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.pos >> 3] ?? 0;
      const bit = (byte >> (7 - (this.pos & 7))) & 1;
      v = (v << 1) | bit;
      this.pos += 1;
    }
    return v;
  }
  skip(n: number): void {
    this.pos += n;
  }
  ue(): number {
    let z = 0;
    while (this.pos < this.bitLength && this.read(1) === 0) z += 1;
    if (z === 0) return 0;
    return (1 << z) - 1 + this.read(z);
  }
  se(): number {
    const u = this.ue();
    return (u & 1) === 1 ? (u + 1) >> 1 : -(u >> 1);
  }
}

class BitWriter {
  private bits: number[] = [];
  write(n: number, value: number): void {
    for (let i = n - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  }
  copyPrefix(bytes: Uint8Array, bitCount: number): void {
    const src = new BitReader(bytes);
    for (let i = 0; i < bitCount; i++) this.write(1, src.read(1));
  }
  ue(value: number): void {
    const v = value + 1;
    let z = 0;
    let t = v;
    while (t > 1) {
      t >>= 1;
      z += 1;
    }
    this.write(z, 0);
    this.write(1, 1);
    this.write(z, v - (1 << z));
  }
  toBytes(): Uint8Array {
    this.write(1, 1);
    while (this.bits.length % 8 !== 0) this.write(1, 0);
    const out = new Uint8Array(this.bits.length / 8);
    for (let i = 0; i < out.length; i++) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i * 8 + j] ?? 0);
      out[i] = b;
    }
    return out;
  }
}

function removeEmulation(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    out.push(nal[i]!);
  }
  return new Uint8Array(out);
}

function addEmulation(rbsp: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (let i = 0; i < rbsp.length; i++) {
    const b = rbsp[i]!;
    if (zeros >= 2 && b <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return new Uint8Array(out);
}

function maxDpbMbs(levelIdc: number): number {
  let best = MAX_DPB_MBS[0]![1];
  for (const [level, mbs] of MAX_DPB_MBS) {
    if (levelIdc >= level) best = mbs;
  }
  return best;
}

function skipHrd(r: BitReader): void {
  const cpb = r.ue();
  r.skip(8);
  for (let i = 0; i <= cpb; i++) {
    r.ue();
    r.ue();
    r.skip(1);
  }
  r.skip(20);
}

function skipScalingList(r: BitReader, size: number): void {
  let last = 8;
  let next = 8;
  for (let j = 0; j < size; j++) {
    if (next !== 0) next = (last + r.se() + 256) % 256;
    last = next === 0 ? last : next;
  }
}

type SpsWalk = {
  rbsp: Uint8Array;
  vuiPresent: boolean;
  vuiFlagBit: number;
  restrictionFlag: number | null;
  restrictionFlagBit: number | null;
  numReorderFrames: number;
  maxDecFrameBuffering: number;
};

function walkSps(nalWithHeader: Uint8Array): SpsWalk | null {
  const rbsp = removeEmulation(nalWithHeader);
  if (rbsp.length < 5) return null;
  const r = new BitReader(rbsp);
  r.skip(3);
  if (r.read(5) !== 7) return null;
  const profileIdc = r.read(8);
  const constraintFlags = r.read(8);
  const levelIdc = r.read(8);
  r.ue();
  let chromaFormatIdc = 1;
  if (HIGH_PROFILES.has(profileIdc)) {
    chromaFormatIdc = r.ue();
    if (chromaFormatIdc === 3) r.read(1);
    r.ue();
    r.ue();
    r.skip(1);
    if (r.read(1)) {
      const n = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < n; i++) {
        if (r.read(1)) skipScalingList(r, i < 6 ? 16 : 64);
      }
    }
  }
  r.ue();
  const pocType = r.ue();
  if (pocType === 0) r.ue();
  else if (pocType === 1) {
    r.skip(1);
    r.se();
    r.se();
    const cycle = r.ue();
    for (let i = 0; i < cycle; i++) r.se();
  }
  r.ue();
  r.skip(1);
  const picWidthInMbsMinus1 = r.ue();
  const picHeightInMapUnitsMinus1 = r.ue();
  const frameMbsOnly = r.read(1);
  if (!frameMbsOnly) r.skip(1);
  r.skip(1);
  if (r.read(1)) {
    r.ue();
    r.ue();
    r.ue();
    r.ue();
  }
  const vuiFlagBit = r.pos;
  const vuiPresent = r.read(1) === 1;
  let restrictionFlag: number | null = null;
  let restrictionFlagBit: number | null = null;
  let numReorder: number | null = null;
  let maxDec: number | null = null;
  if (vuiPresent) {
    if (r.read(1)) {
      const idc = r.read(8);
      if (idc === 255) r.skip(32);
    }
    if (r.read(1)) r.skip(1);
    if (r.read(1)) {
      r.skip(4);
      if (r.read(1)) r.skip(24);
    }
    if (r.read(1)) {
      r.ue();
      r.ue();
    }
    if (r.read(1)) r.skip(65);
    const nalHrd = r.read(1);
    if (nalHrd) skipHrd(r);
    const vclHrd = r.read(1);
    if (vclHrd) skipHrd(r);
    if (nalHrd || vclHrd) r.skip(1);
    r.skip(1);
    restrictionFlagBit = r.pos;
    restrictionFlag = r.read(1);
    if (restrictionFlag) {
      r.skip(1);
      r.ue();
      r.ue();
      r.ue();
      r.ue();
      numReorder = r.ue();
      maxDec = r.ue();
    }
  }
  if (numReorder == null || maxDec == null) {
    const cs3 = (constraintFlags & 0x10) !== 0;
    if (cs3 && (profileIdc === 44 || profileIdc === 86 || profileIdc === 100 || profileIdc === 110 || profileIdc === 122 || profileIdc === 244)) {
      numReorder = 0;
      maxDec = 0;
    } else {
      const picWidthInMbs = picWidthInMbsMinus1 + 1;
      const frameHeightInMbs = (2 - frameMbsOnly) * (picHeightInMapUnitsMinus1 + 1);
      const maxDpb = Math.min(Math.floor(maxDpbMbs(levelIdc) / Math.max(1, picWidthInMbs * frameHeightInMbs)), 16);
      numReorder = maxDpb;
      maxDec = maxDpb;
    }
  }
  return {
    rbsp,
    vuiPresent,
    vuiFlagBit,
    restrictionFlag,
    restrictionFlagBit,
    numReorderFrames: numReorder,
    maxDecFrameBuffering: maxDec,
  };
}

function writeRestriction(w: BitWriter, numReorder: number, maxDec: number): void {
  w.write(1, 1);
  w.write(1, 1);
  w.ue(2);
  w.ue(1);
  w.ue(16);
  w.ue(16);
  w.ue(numReorder);
  w.ue(maxDec);
}

function patchSpsNal(nal: Uint8Array): Uint8Array | null {
  const walk = walkSps(nal);
  if (!walk) return null;
  if (walk.restrictionFlag === 1) return null;
  if (walk.maxDecFrameBuffering === 0) return null;
  const w = new BitWriter();
  if (!walk.vuiPresent) {
    w.copyPrefix(walk.rbsp, walk.vuiFlagBit);
    w.write(1, 1);
    w.write(1, 0);
    w.write(1, 0);
    w.write(1, 0);
    w.write(1, 0);
    w.write(1, 0);
    w.write(1, 0);
    w.write(1, 0);
    w.write(1, 0);
    writeRestriction(w, walk.numReorderFrames, walk.maxDecFrameBuffering);
  } else {
    if (walk.restrictionFlagBit == null) return null;
    w.copyPrefix(walk.rbsp, walk.restrictionFlagBit);
    writeRestriction(w, walk.numReorderFrames, walk.maxDecFrameBuffering);
  }
  return addEmulation(w.toBytes());
}

export function inspectAvcSpsRestriction(nalWithHeader: Uint8Array): AvcSpsRestrictionInfo | null {
  const walk = walkSps(nalWithHeader);
  if (!walk) return null;
  return {
    bitstreamRestrictionFlag: walk.restrictionFlag,
    vuiPresent: walk.vuiPresent,
    numReorderFrames: walk.numReorderFrames,
    maxDecFrameBuffering: walk.maxDecFrameBuffering,
    needsPatch: walk.restrictionFlag !== 1 && walk.maxDecFrameBuffering !== 0,
  };
}

/** Patch SPS NAL inside an avcC record. Returns original bytes when no change. */
export function patchAvcCBitstreamRestriction(record: Uint8Array): Uint8Array {
  if (record.length < 7) return record;
  const numSps = record[5]! & 0x1f;
  let off = 6;
  const spsList: Uint8Array[] = [];
  let changed = false;
  for (let i = 0; i < numSps; i++) {
    if (off + 2 > record.length) return record;
    const len = (record[off]! << 8) | record[off + 1]!;
    off += 2;
    if (off + len > record.length) return record;
    const orig = record.subarray(off, off + len);
    const patched = patchSpsNal(orig);
    spsList.push(patched ?? orig);
    if (patched) changed = true;
    off += len;
  }
  if (!changed) return record;
  const rest = record.subarray(off);
  let size = 6;
  for (const sps of spsList) size += 2 + sps.length;
  size += rest.length;
  const out = new Uint8Array(size);
  out.set(record.subarray(0, 6), 0);
  let w = 6;
  for (const sps of spsList) {
    out[w] = (sps.length >> 8) & 0xff;
    out[w + 1] = sps.length & 0xff;
    out.set(sps, w + 2);
    w += 2 + sps.length;
  }
  out.set(rest, w);
  return out;
}

/** Replace in-band SPS NALs (type 7) in a length-prefixed AVC sample. */
export function patchAvcSampleBitstreamRestriction(data: Uint8Array, nalLengthSize: number): Uint8Array {
  if (nalLengthSize !== 1 && nalLengthSize !== 2 && nalLengthSize !== 4) return data;
  const parts: Uint8Array[] = [];
  let off = 0;
  let changed = false;
  while (off + nalLengthSize <= data.length) {
    let len = 0;
    for (let i = 0; i < nalLengthSize; i++) len = (len << 8) | data[off + i]!;
    off += nalLengthSize;
    if (off + len > data.length) return data;
    const nal = data.subarray(off, off + len);
    off += len;
    const type = (nal[0] ?? 0) & 0x1f;
    if (type === 7) {
      const patched = patchSpsNal(nal);
      if (patched) {
        parts.push(prefixed(patched, nalLengthSize));
        changed = true;
        continue;
      }
    }
    parts.push(prefixed(nal, nalLengthSize));
  }
  if (!changed) return data;
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let w = 0;
  for (const p of parts) {
    out.set(p, w);
    w += p.length;
  }
  return out;
}

function prefixed(nal: Uint8Array, nalLengthSize: number): Uint8Array {
  const out = new Uint8Array(nalLengthSize + nal.length);
  let n = nal.length;
  for (let i = nalLengthSize - 1; i >= 0; i--) {
    out[i] = n & 0xff;
    n >>= 8;
  }
  out.set(nal, nalLengthSize);
  return out;
}

export function firstAvcCSps(record: Uint8Array): Uint8Array | null {
  if (record.length < 8) return null;
  const numSps = record[5]! & 0x1f;
  if (numSps < 1) return null;
  const len = (record[6]! << 8) | record[7]!;
  if (8 + len > record.length) return null;
  return record.subarray(8, 8 + len);
}
