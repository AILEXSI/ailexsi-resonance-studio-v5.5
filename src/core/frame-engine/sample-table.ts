import { AfeError } from "./errors";
import { addTimescale } from "./frame-match";
import type { AfeSample } from "./types";

export interface RawSampleTables {
  stts: { count: number; delta: number }[];
  ctts: { count: number; offset: number }[] | null;
  stsc: { firstChunk: number; samplesPerChunk: number; descriptionIndex: number }[];
  sampleSize: number;
  sampleSizes: number[];
  sampleCount: number;
  chunkOffsets: number[];
  /** 1-based sync sample numbers, or null if every sample is a keyframe. */
  syncSamples: number[] | null;
}

function expandCounts(entries: { count: number; delta: number }[], label: string): number[] {
  const out: number[] = [];
  for (const e of entries) {
    if (e.count <= 0) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `${label} count <= 0`);
    for (let i = 0; i < e.count; i++) out.push(e.delta);
  }
  return out;
}

function sizeOf(tables: RawSampleTables, index: number): number {
  if (tables.sampleSize !== 0) return tables.sampleSize;
  const n = tables.sampleSizes[index];
  if (n == null) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `stsz missing sample ${index}`);
  return n;
}

function samplesPerChunkAt(stsc: RawSampleTables["stsc"], chunk1: number): number {
  let chosen = stsc[0];
  if (!chosen) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "empty stsc");
  for (const e of stsc) {
    if (e.firstChunk <= chunk1) chosen = e;
    else break;
  }
  if (!chosen || chosen.samplesPerChunk <= 0) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "invalid stsc entry");
  }
  return chosen.samplesPerChunk;
}

/** Expand stts/ctts/stsc/stsz/stco/stss into per-sample offset/PTS/DTS/key. */
export function buildSampleTable(tables: RawSampleTables): AfeSample[] {
  const deltas = expandCounts(tables.stts, "stts");
  if (tables.sampleCount !== deltas.length) {
    throw new AfeError(
      "AFE_UNSUPPORTED_SAMPLE_TABLE",
      `stts samples ${deltas.length} != stsz ${tables.sampleCount}`,
    );
  }
  if (tables.sampleCount === 0) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "empty sample table");
  }

  let cttsOffsets: number[] | null = null;
  if (tables.ctts && tables.ctts.length > 0) {
    cttsOffsets = [];
    for (const e of tables.ctts) {
      if (e.count <= 0) throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "ctts count <= 0");
      if (!Number.isSafeInteger(e.offset)) {
        throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "ctts offset is not a safe integer");
      }
      for (let i = 0; i < e.count; i++) cttsOffsets.push(e.offset);
    }
    if (cttsOffsets.length !== tables.sampleCount) {
      throw new AfeError(
        "AFE_UNSUPPORTED_SAMPLE_TABLE",
        `ctts samples ${cttsOffsets.length} != stsz ${tables.sampleCount}`,
      );
    }
  }

  const keySet = new Set<number>();
  if (tables.syncSamples) {
    for (const n of tables.syncSamples) keySet.add(n - 1);
  }

  const offsets = new Array<number>(tables.sampleCount);
  let sampleIndex = 0;
  for (let chunk = 0; chunk < tables.chunkOffsets.length; chunk++) {
    const chunk1 = chunk + 1;
    const per = samplesPerChunkAt(tables.stsc, chunk1);
    let cursor = tables.chunkOffsets[chunk]!;
    for (let s = 0; s < per && sampleIndex < tables.sampleCount; s++) {
      offsets[sampleIndex] = cursor;
      cursor += sizeOf(tables, sampleIndex);
      sampleIndex += 1;
    }
  }
  if (sampleIndex !== tables.sampleCount) {
    throw new AfeError(
      "AFE_UNSUPPORTED_SAMPLE_TABLE",
      `stsc/stco covered ${sampleIndex} of ${tables.sampleCount} samples`,
    );
  }

  const samples: AfeSample[] = [];
  let dts = 0;
  for (let i = 0; i < tables.sampleCount; i++) {
    const duration = deltas[i]!;
    if (duration < 0 || !Number.isSafeInteger(duration)) {
      throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", "stts delta invalid");
    }
    const offset = cttsOffsets ? cttsOffsets[i]! : 0;
    const pts = addTimescale(dts, offset, "pts = dts + ctts");
    samples.push({
      index: i,
      byteOffset: offsets[i]!,
      byteSize: sizeOf(tables, i),
      dtsTimescale: dts,
      ptsTimescale: pts,
      durationTimescale: duration,
      isKeyframe: tables.syncSamples == null || keySet.has(i),
    });
    dts = addTimescale(dts, duration, "dts");
  }
  return samples;
}
