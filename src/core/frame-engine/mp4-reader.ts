import { AfeError } from "./errors";
import type { AfeAvcConfig, AfeCttsKind, AfeMovie, AfeSample } from "./types";
import { parseAvcC } from "./avc-config";
import { classifyCtts, maxReorderSamples } from "./frame-match";
import { afePerfAdd, afePerfCount, afePerfEnabled, afePerfTime, peekAfePerf } from "./perf";
import { buildSampleTable } from "./sample-table";

export interface ParsedBox {
  type: string;
  start: number;
  size: number;
  headerSize: number;
  payloadStart: number;
  payloadEnd: number;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function i32(bytes: Uint8Array, offset: number): number {
  return u32(bytes, offset) | 0;
}

function u16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u64(bytes: Uint8Array, offset: number): number {
  const hi = u32(bytes, offset);
  const lo = u32(bytes, offset + 4);
  if (hi > 0x1fffff) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "64-bit field exceeds safe integer");
  }
  return hi * 0x1_0000_0000 + lo;
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

export function readBoxes(bytes: Uint8Array, start: number, end: number): ParsedBox[] {
  const out: ParsedBox[] = [];
  let off = start;
  while (off + 8 <= end) {
    let size = u32(bytes, off);
    const type = fourcc(bytes, off + 4);
    let headerSize = 8;
    if (size === 1) {
      if (off + 16 > end) {
        throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "truncated largesize box");
      }
      size = u64(bytes, off + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < headerSize || off + size > end) {
      throw new AfeError("AFE_UNSUPPORTED_CONTAINER", `invalid box size for ${type}`);
    }
    out.push({
      type,
      start: off,
      size,
      headerSize,
      payloadStart: off + headerSize,
      payloadEnd: off + size,
    });
    off += size;
  }
  return out;
}

function findBox(boxes: ParsedBox[], type: string): ParsedBox | undefined {
  return boxes.find((b) => b.type === type);
}

function requireBox(boxes: ParsedBox[], type: string, code: AfeError["code"] = "AFE_UNSUPPORTED_CONTAINER"): ParsedBox {
  const hit = findBox(boxes, type);
  if (!hit) throw new AfeError(code, `missing ${type}`);
  return hit;
}

function children(bytes: Uint8Array, box: ParsedBox): ParsedBox[] {
  return readBoxes(bytes, box.payloadStart, box.payloadEnd);
}

function readFullBox(bytes: Uint8Array, box: ParsedBox): { version: number; flags: number; dataStart: number } {
  if (box.payloadEnd - box.payloadStart < 4) {
    throw new AfeError("AFE_UNSUPPORTED_CONTAINER", `truncated full box ${box.type}`);
  }
  const version = bytes[box.payloadStart] ?? 0;
  const flags =
    ((bytes[box.payloadStart + 1] ?? 0) << 16) |
    ((bytes[box.payloadStart + 2] ?? 0) << 8) |
    (bytes[box.payloadStart + 3] ?? 0);
  void flags;
  return { version, flags, dataStart: box.payloadStart + 4 };
}

function parseMdhd(bytes: Uint8Array, box: ParsedBox): { timescale: number; duration: number } {
  const { version, dataStart } = readFullBox(bytes, box);
  if (version === 1) {
    if (dataStart + 28 > box.payloadEnd) {
      throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated mdhd v1");
    }
    return { timescale: u32(bytes, dataStart + 16), duration: u64(bytes, dataStart + 20) };
  }
  if (version !== 0) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `unsupported mdhd version ${version}`);
  }
  if (dataStart + 16 > box.payloadEnd) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated mdhd");
  }
  return { timescale: u32(bytes, dataStart + 8), duration: u32(bytes, dataStart + 12) };
}

function parseHdlr(bytes: Uint8Array, box: ParsedBox): string {
  const { dataStart } = readFullBox(bytes, box);
  if (dataStart + 8 > box.payloadEnd) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated hdlr");
  }
  return fourcc(bytes, dataStart + 4);
}

function parseElst(bytes: Uint8Array, box: ParsedBox): number {
  const { version, dataStart } = readFullBox(bytes, box);
  if (dataStart + 4 > box.payloadEnd) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated elst");
  }
  const count = u32(bytes, dataStart);
  let cursor = dataStart + 4;
  let emptyEditTimescale = 0;
  let offset: number | null = null;
  for (let i = 0; i < count; i++) {
    const step = version === 1 ? 20 : 12;
    if (cursor + step > box.payloadEnd) {
      throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated elst entry");
    }
    const segmentDuration = version === 1 ? u64(bytes, cursor) : u32(bytes, cursor);
    const mediaTime = version === 1 ? (u64(bytes, cursor + 8) > 0x7fff_ffff_ffff ? -1 : i32(bytes, cursor + 12)) : i32(bytes, cursor + 4);
    const mediaRateRaw = version === 1 ? u32(bytes, cursor + 16) : u32(bytes, cursor + 8);
    cursor += step;
    const mediaRate = mediaRateRaw / 0x10000;
    if (segmentDuration === 0) continue;
    if (mediaTime === -1) {
      if (offset != null) {
        throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "elst empty edit after media");
      }
      emptyEditTimescale += segmentDuration;
      continue;
    }
    if (emptyEditTimescale > 0) {
      throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "elst start-delay empty edit is unsupported");
    }
    if (Math.abs(mediaRate - 1) > 1e-6) {
      throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `elst media_rate ${mediaRate} unsupported`);
    }
    if (offset != null) {
      throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "multiple elst media edits");
    }
    offset = mediaTime;
  }
  return offset ?? 0;
}

interface RawTables {
  stts: { count: number; delta: number }[];
  ctts: { count: number; offset: number }[] | null;
  cttsVersion: 0 | 1 | null;
  stsc: { firstChunk: number; samplesPerChunk: number; descriptionIndex: number }[];
  sampleSize: number;
  sampleSizes: number[];
  sampleCount: number;
  chunkOffsets: number[];
  syncSamples: number[] | null;
}

function parseStts(bytes: Uint8Array, box: ParsedBox): RawTables["stts"] {
  const { dataStart } = readFullBox(bytes, box);
  const n = u32(bytes, dataStart);
  const out: RawTables["stts"] = [];
  let cursor = dataStart + 4;
  for (let i = 0; i < n; i++) {
    if (cursor + 8 > box.payloadEnd) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated stts");
    out.push({ count: u32(bytes, cursor), delta: u32(bytes, cursor + 4) });
    cursor += 8;
  }
  return out;
}

export type ParsedCtts = {
  version: 0 | 1;
  entries: { count: number; offset: number }[];
};

/**
 * ISO/IEC 14496-12 Composition Time to Sample.
 * v0: unsigned offset. v1: signed offset. Absent box = all offsets 0.
 * Varying offsets (B-frames) are supported — do not reject on unique-offset count.
 */
export function parseCtts(bytes: Uint8Array, box: ParsedBox): ParsedCtts {
  const { version, dataStart } = readFullBox(bytes, box);
  if (version !== 0 && version !== 1) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `unsupported ctts version ${version}`);
  }
  if (dataStart + 4 > box.payloadEnd) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated ctts");
  }
  const n = u32(bytes, dataStart);
  const out: { count: number; offset: number }[] = [];
  let cursor = dataStart + 4;
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (cursor + 8 > box.payloadEnd) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated ctts");
    const count = u32(bytes, cursor);
    if (count <= 0) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "ctts count <= 0");
    const offset = version === 1 ? i32(bytes, cursor + 4) : u32(bytes, cursor + 4);
    total = total + count;
    if (!Number.isSafeInteger(total)) {
      throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "ctts sample count overflow");
    }
    out.push({ count, offset });
    cursor += 8;
  }
  return { version, entries: out };
}

function parseStsc(bytes: Uint8Array, box: ParsedBox): RawTables["stsc"] {
  const { dataStart } = readFullBox(bytes, box);
  const n = u32(bytes, dataStart);
  const out: RawTables["stsc"] = [];
  let cursor = dataStart + 4;
  for (let i = 0; i < n; i++) {
    if (cursor + 12 > box.payloadEnd) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated stsc");
    out.push({
      firstChunk: u32(bytes, cursor),
      samplesPerChunk: u32(bytes, cursor + 4),
      descriptionIndex: u32(bytes, cursor + 8),
    });
    cursor += 12;
  }
  return out;
}

function parseStsz(bytes: Uint8Array, box: ParsedBox): Pick<RawTables, "sampleSize" | "sampleSizes" | "sampleCount"> {
  const { dataStart } = readFullBox(bytes, box);
  if (dataStart + 8 > box.payloadEnd) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated stsz");
  const sampleSize = u32(bytes, dataStart);
  const sampleCount = u32(bytes, dataStart + 4);
  if (sampleSize !== 0) return { sampleSize, sampleSizes: [], sampleCount };
  const sizes: number[] = [];
  let cursor = dataStart + 8;
  for (let i = 0; i < sampleCount; i++) {
    if (cursor + 4 > box.payloadEnd) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated stsz entries");
    sizes.push(u32(bytes, cursor));
    cursor += 4;
  }
  return { sampleSize, sampleSizes: sizes, sampleCount };
}

function parseChunkOffsets(bytes: Uint8Array, box: ParsedBox, wide: boolean): number[] {
  const { dataStart } = readFullBox(bytes, box);
  const n = u32(bytes, dataStart);
  const out: number[] = [];
  let cursor = dataStart + 4;
  const step = wide ? 8 : 4;
  for (let i = 0; i < n; i++) {
    if (cursor + step > box.payloadEnd) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated chunk offsets");
    out.push(wide ? u64(bytes, cursor) : u32(bytes, cursor));
    cursor += step;
  }
  return out;
}

function parseStss(bytes: Uint8Array, box: ParsedBox): number[] {
  const { dataStart } = readFullBox(bytes, box);
  const n = u32(bytes, dataStart);
  const out: number[] = [];
  let cursor = dataStart + 4;
  for (let i = 0; i < n; i++) {
    if (cursor + 4 > box.payloadEnd) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "truncated stss");
    out.push(u32(bytes, cursor));
    cursor += 4;
  }
  return out;
}

function parseAvc1(bytes: Uint8Array, box: ParsedBox): { width: number; height: number; avc: AfeAvcConfig } {
  // VisualSampleEntry payload starts after SampleEntry (6 reserved + 2 data_reference_index)
  const visualStart = box.payloadStart + 8;
  if (visualStart + 70 > box.payloadEnd) {
    throw new AfeError("AFE_UNSUPPORTED_CODEC", "truncated avc1");
  }
  const width = u16(bytes, visualStart + 16);
  const height = u16(bytes, visualStart + 18);
  const kids = readBoxes(bytes, box.start + 8 + 78, box.payloadEnd);
  const avcC = findBox(kids, "avcC");
  if (!avcC) throw new AfeError("AFE_UNSUPPORTED_CODEC", "avc1 missing avcC");
  const record = bytes.subarray(avcC.payloadStart, avcC.payloadEnd);
  return { width, height, avc: parseAvcC(record, width, height) };
}

function parseStsd(bytes: Uint8Array, box: ParsedBox): { width: number; height: number; avc: AfeAvcConfig } {
  const { dataStart } = readFullBox(bytes, box);
  const count = u32(bytes, dataStart);
  if (count !== 1) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `stsd entry_count ${count} unsupported`);
  }
  const entries = readBoxes(bytes, dataStart + 4, box.payloadEnd);
  const entry = entries[0];
  if (!entry) throw new AfeError("AFE_UNSUPPORTED_CODEC", "empty stsd");
  if (entry.type !== "avc1" && entry.type !== "avc3") {
    throw new AfeError("AFE_UNSUPPORTED_CODEC", `codec ${entry.type} unsupported`);
  }
  return parseAvc1(bytes, entry);
}

function parseVideoTrack(bytes: Uint8Array, trak: ParsedBox): Omit<AfeMovie, "bytes"> | null {
  const trakKids = children(bytes, trak);
  const mdia = findBox(trakKids, "mdia");
  if (!mdia) return null;
  const mdiaKids = children(bytes, mdia);
  const hdlr = findBox(mdiaKids, "hdlr");
  if (!hdlr || parseHdlr(bytes, hdlr) !== "vide") return null;

  const mdhd = requireBox(mdiaKids, "mdhd", "AFE_UNSUPPORTED_SAMPLE_TABLE");
  const { timescale, duration } = parseMdhd(bytes, mdhd);
  if (timescale <= 0) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "mdhd timescale is 0");

  let editListOffset = 0;
  const edts = findBox(trakKids, "edts");
  if (edts) {
    const elst = findBox(children(bytes, edts), "elst");
    if (elst) editListOffset = parseElst(bytes, elst);
  }

  const minf = requireBox(mdiaKids, "minf", "AFE_UNSUPPORTED_SAMPLE_TABLE");
  const stbl = requireBox(children(bytes, minf), "stbl", "AFE_UNSUPPORTED_SAMPLE_TABLE");
  const stblKids = children(bytes, stbl);

  const stsd = requireBox(stblKids, "stsd", "AFE_UNSUPPORTED_SAMPLE_TABLE");
  const { width, height, avc } = parseStsd(bytes, stsd);

  const sttsBox = requireBox(stblKids, "stts", "AFE_UNSUPPORTED_SAMPLE_TABLE");
  const stscBox = requireBox(stblKids, "stsc", "AFE_UNSUPPORTED_SAMPLE_TABLE");
  const stszBox = findBox(stblKids, "stsz");
  if (!stszBox) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "missing stsz (stz2 unsupported)");
  const stcoBox = findBox(stblKids, "stco");
  const co64Box = findBox(stblKids, "co64");
  if (!stcoBox && !co64Box) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "missing stco/co64");
  if (findBox(stblKids, "stz2")) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "stz2 unsupported");

  const cttsBox = findBox(stblKids, "ctts");
  const stssBox = findBox(stblKids, "stss");

  const parsedCtts = cttsBox ? parseCtts(bytes, cttsBox) : null;
  const tables: RawTables = {
    stts: parseStts(bytes, sttsBox),
    ctts: parsedCtts ? parsedCtts.entries : null,
    cttsVersion: parsedCtts ? parsedCtts.version : null,
    stsc: parseStsc(bytes, stscBox),
    ...parseStsz(bytes, stszBox),
    chunkOffsets: parseChunkOffsets(bytes, (stcoBox ?? co64Box)!, Boolean(co64Box)),
    syncSamples: stssBox ? parseStss(bytes, stssBox) : null,
  };

  const samples = afePerfTime("sampleTableBuild", () => buildSampleTable(tables));
  const presentation = samples.slice().sort((a, b) => {
    if (a.ptsTimescale !== b.ptsTimescale) return a.ptsTimescale - b.ptsTimescale;
    return a.index - b.index;
  });
  const keyframeIndices = samples.filter((s) => s.isKeyframe).map((s) => s.index);
  const mediaDuration = tables.stts.reduce((n, e) => n + e.count * e.delta, 0);
  const durationSec = (duration || mediaDuration) / timescale;
  const fpsHint = samples[0] && samples[0].durationTimescale > 0
    ? timescale / samples[0].durationTimescale
    : 0;
  const cttsOffsets = parsedCtts ? samples.map((s) => s.ptsTimescale - s.dtsTimescale) : null;
  const cttsKind: AfeCttsKind = classifyCtts(cttsOffsets);

  return {
    timescale,
    editListOffset,
    width,
    height,
    sampleCount: samples.length,
    durationSec,
    fpsHint,
    samples,
    presentation,
    keyframeIndices,
    cttsVersion: parsedCtts ? parsedCtts.version : null,
    cttsKind,
    maxReorderSamples: maxReorderSamples(samples),
    avc,
  };
}

/** Parse a complete (non-fragmented) MP4 with one primary H.264 video track. */
export function parseIsoBmff(bytes: Uint8Array): AfeMovie {
  if (!afePerfEnabled()) return parseIsoBmffUnmetered(bytes);
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const tableBefore = peekAfePerf()?.phasesMs.sampleTableBuild ?? 0;
  try {
    return parseIsoBmffUnmetered(bytes);
  } finally {
    const dt = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    const tableDelta = (peekAfePerf()?.phasesMs.sampleTableBuild ?? 0) - tableBefore;
    afePerfAdd("containerParse", Math.max(0, dt - tableDelta));
  }
}

function parseIsoBmffUnmetered(bytes: Uint8Array): AfeMovie {
  if (bytes.length < 16) {
    throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "file too small");
  }
  const top = readBoxes(bytes, 0, bytes.length);
  const ftyp = findBox(top, "ftyp");
  if (!ftyp) throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "missing ftyp (not ISO-BMFF)");
  if (findBox(top, "moof") || findBox(top, "mvex")) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "fragmented MP4 unsupported");
  }
  const moov = findBox(top, "moov");
  if (!moov) throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "missing moov");

  const moovKids = children(bytes, moov);
  if (findBox(moovKids, "mvex")) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "fragmented MP4 (mvex) unsupported");
  }

  let movie: Omit<AfeMovie, "bytes"> | null = null;
  for (const trak of moovKids.filter((b) => b.type === "trak")) {
    const parsed = parseVideoTrack(bytes, trak);
    if (parsed) {
      movie = parsed;
      break;
    }
  }
  if (!movie) throw new AfeError("AFE_UNSUPPORTED_CODEC", "no H.264 video track");
  return { ...movie, bytes };
}

export function sampleBytes(movie: AfeMovie, sample: AfeSample): Uint8Array {
  const end = sample.byteOffset + sample.byteSize;
  if (sample.byteOffset < 0 || end > movie.bytes.length) {
    throw new AfeError("AFE_DECODE_FAILED", `sample ${sample.index} outside file`);
  }
  afePerfCount("encodedSamplesRead");
  return movie.bytes.subarray(sample.byteOffset, end);
}

/** Almost-integer rounding before adding elst offset (AFE-03 PTS map). */
export function mapTimestampIntoTimescale(timeSec: number, timescale: number, editListOffset: number): number {
  const value = timeSec * timescale;
  const rounded = Math.round(value);
  const mapped =
    rounded !== 0 && Math.abs(value / rounded - 1) < 10 * Number.EPSILON ? rounded : value;
  return mapped + editListOffset;
}

/** Last sample in presentation order whose PTS ≤ request. Null if before the first sample. */
export function sampleIndexAtTime(movie: AfeMovie, timeSec: number): number | null {
  afePerfCount("sampleIndexLookups");
  if (afePerfEnabled()) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      return sampleIndexAtTimeUnmetered(movie, timeSec);
    } finally {
      afePerfAdd("schedulerOverhead", (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    }
  }
  return sampleIndexAtTimeUnmetered(movie, timeSec);
}

function sampleIndexAtTimeUnmetered(movie: AfeMovie, timeSec: number): number | null {
  const t = mapTimestampIntoTimescale(timeSec, movie.timescale, movie.editListOffset);
  const pts = movie.presentation;
  let lo = 0;
  let hi = pts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const sample = pts[mid]!;
    if (sample.ptsTimescale <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans === -1 ? null : pts[ans]!.index;
}

export function keyframeAtOrBefore(movie: AfeMovie, decodeIndex: number): number {
  afePerfCount("keyframeLookups");
  if (afePerfEnabled()) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      return keyframeAtOrBeforeUnmetered(movie, decodeIndex);
    } finally {
      afePerfAdd("keyframeLookup", (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    }
  }
  return keyframeAtOrBeforeUnmetered(movie, decodeIndex);
}

function keyframeAtOrBeforeUnmetered(movie: AfeMovie, decodeIndex: number): number {
  const keys = movie.keyframeIndices;
  let lo = 0;
  let hi = keys.length - 1;
  let ans = keys[0] ?? 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = keys[mid]!;
    if (k <= decodeIndex) {
      ans = k;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function nearestKeyframeIndex(movie: AfeMovie, decodeIndex: number): number {
  return keyframeAtOrBefore(movie, decodeIndex);
}

/** Open GOP: B-frames after this I present *before* the I (need the prior GOP). */
export function isOpenGopAtKey(movie: AfeMovie, keyIndex: number): boolean {
  const key = movie.samples[keyIndex];
  if (!key?.isKeyframe) return false;
  for (let i = keyIndex + 1; i < movie.samples.length; i++) {
    const sample = movie.samples[i]!;
    if (sample.isKeyframe) break;
    if (sample.ptsTimescale < key.ptsTimescale) return true;
  }
  return false;
}

/**
 * Inclusive decode-order origin for sample `index`.
 * Closed GOP: nearest prior keyframe. Open GOP: previous keyframe so
 * leading B-frames still have their backward reference.
 */
export function decodeOrigin(movie: AfeMovie, index: number): number {
  const key = keyframeAtOrBefore(movie, index);
  if (key <= 0 || !isOpenGopAtKey(movie, key)) return key;
  return keyframeAtOrBefore(movie, key - 1);
}

/** Next I-frame strictly after `decodeIndex`, or null at the last GOP. */
export function nextKeyframeAfter(movie: AfeMovie, decodeIndex: number): number | null {
  const keys = movie.keyframeIndices;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (k > decodeIndex) return k;
  }
  return null;
}
