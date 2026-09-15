/**
 * AFE-14 — compact packet / decoder-config fingerprints.
 *
 * Prove ColdStartChunk(N) == RecoveryChunk(N) before blaming queue depth.
 * Hashes only — no raw avcC / NAL dumps in stall text.
 */

import { decoderConfigOf } from "./avc-config";
import { sampleBytes } from "./mp4-reader";
import { sampleDurationToChunkDurationUs, ticksToUs } from "./timestamps";
import type { AfeMovie, AfeSample } from "./types";

/** 32-bit FNV-1a, 8 hex chars. Compact, not cryptographic. */
export function compactHash(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function compactHashString(text: string): string {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return compactHash(bytes);
}

export type DecoderConfigFingerprint = {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  optimizeForLatency: boolean;
  descriptionHash: string;
  hash: string;
};

export type ChunkFingerprint = {
  /** Decode-order sample index (identity). */
  index: number;
  /** EncodedVideoChunk.timestamp (PTS µs). */
  ptsUs: number;
  /** sample.dtsTimescale in µs — submit-order only, never chunk.timestamp. */
  dtsUs: number;
  durationUs: number;
  key: boolean;
  payloadHash: string;
  configHash: string;
};

export type PacketParityResult = {
  equal: boolean;
  mismatchIndex: number | null;
  compared: number;
  field: keyof ChunkFingerprint | "config" | null;
};

export function fingerprintDecoderConfig(config: {
  codec: string;
  codedWidth?: number;
  codedHeight?: number;
  optimizeForLatency?: boolean;
  description?: unknown;
}): DecoderConfigFingerprint {
  const description = viewOf(config.description);
  const descriptionHash = compactHash(description);
  const codec = config.codec;
  const codedWidth = config.codedWidth ?? 0;
  const codedHeight = config.codedHeight ?? 0;
  const optimizeForLatency = config.optimizeForLatency === true;
  const hash = compactHashString(
    [
      codec,
      String(codedWidth),
      String(codedHeight),
      optimizeForLatency ? "1" : "0",
      descriptionHash,
    ].join("|"),
  );
  return { codec, codedWidth, codedHeight, optimizeForLatency, descriptionHash, hash };
}

export function fingerprintMovieConfig(movie: AfeMovie): DecoderConfigFingerprint {
  return fingerprintDecoderConfig(decoderConfigOf(movie.avc));
}

export function fingerprintSampleChunk(
  movie: AfeMovie,
  sample: AfeSample,
  configHash: string,
): ChunkFingerprint {
  const ptsUs = ticksToUs(sample.ptsTimescale, movie.timescale);
  const dtsUs = ticksToUs(sample.dtsTimescale, movie.timescale);
  const durationUs = sampleDurationToChunkDurationUs(sample.durationTimescale, movie.timescale);
  const payloadHash = compactHash(sampleBytes(movie, sample));
  return {
    index: sample.index,
    ptsUs,
    dtsUs,
    durationUs,
    key: sample.isKeyframe,
    payloadHash,
    configHash,
  };
}

export function chunkFingerprintsEqual(a: ChunkFingerprint, b: ChunkFingerprint): boolean {
  return (
    a.index === b.index &&
    a.ptsUs === b.ptsUs &&
    a.dtsUs === b.dtsUs &&
    a.durationUs === b.durationUs &&
    a.key === b.key &&
    a.payloadHash === b.payloadHash &&
    a.configHash === b.configHash
  );
}

export function chunkFingerprintMismatchField(
  a: ChunkFingerprint,
  b: ChunkFingerprint,
): keyof ChunkFingerprint | null {
  if (a.index !== b.index) return "index";
  if (a.ptsUs !== b.ptsUs) return "ptsUs";
  if (a.dtsUs !== b.dtsUs) return "dtsUs";
  if (a.durationUs !== b.durationUs) return "durationUs";
  if (a.key !== b.key) return "key";
  if (a.payloadHash !== b.payloadHash) return "payloadHash";
  if (a.configHash !== b.configHash) return "configHash";
  return null;
}

/**
 * PARITY INVARIANT: ColdStartChunk(N) == RecoveryChunk(N) for
 * index / PTS / DTS / duration / key / payload / config.
 */
export function comparePacketParity(
  cold: readonly ChunkFingerprint[],
  recovery: readonly ChunkFingerprint[],
): PacketParityResult {
  const n = Math.min(cold.length, recovery.length);
  for (let i = 0; i < n; i++) {
    const field = chunkFingerprintMismatchField(cold[i]!, recovery[i]!);
    if (field) {
      return { equal: false, mismatchIndex: i, compared: n, field };
    }
  }
  if (cold.length !== recovery.length && n === 0) {
    return { equal: false, mismatchIndex: 0, compared: 0, field: "index" };
  }
  return { equal: n > 0 && cold.length === recovery.length, mismatchIndex: null, compared: n, field: null };
}

/** Prefix-equal is enough when recovery is still pumping (same origin). */
export function recoveryMatchesColdPrefix(
  cold: readonly ChunkFingerprint[],
  recovery: readonly ChunkFingerprint[],
): PacketParityResult {
  const n = Math.min(cold.length, recovery.length);
  if (recovery.length === 0) {
    return { equal: cold.length === 0, mismatchIndex: recovery.length === 0 && cold.length > 0 ? 0 : null, compared: 0, field: recovery.length === 0 && cold.length > 0 ? "index" : null };
  }
  for (let i = 0; i < n; i++) {
    const field = chunkFingerprintMismatchField(cold[i]!, recovery[i]!);
    if (field) return { equal: false, mismatchIndex: i, compared: n, field };
  }
  return { equal: true, mismatchIndex: null, compared: n, field: null };
}

export function expectedRecoveryChunks(
  movie: AfeMovie,
  gopStart: number,
  count: number,
  configHash: string,
): ChunkFingerprint[] {
  const out: ChunkFingerprint[] = [];
  const start = Math.max(0, gopStart | 0);
  const hi = Math.min(movie.sampleCount, start + Math.max(0, count | 0));
  for (let i = start; i < hi; i++) {
    const sample = movie.samples[i];
    if (!sample) break;
    out.push(fingerprintSampleChunk(movie, sample, configHash));
  }
  return out;
}

export type FirstChunkAfterRecreate = {
  gopStart: number;
  sampleIndex: number;
  key: boolean;
  ptsUs: number;
  dtsUs: number;
  expectedPtsUs: number;
  expectedDtsUs: number;
  ok: boolean;
  reason: string | null;
};

/**
 * After recreate from file start: first submit must be sample 0 keyframe
 * with the sample-table PTS/DTS. Any other first chunk is a typed failure.
 */
export function firstChunkAfterRecreateCheck(
  movie: AfeMovie,
  gopStart: number,
  first: Pick<ChunkFingerprint, "index" | "key" | "ptsUs" | "dtsUs">,
): FirstChunkAfterRecreate {
  const origin = Math.max(0, gopStart | 0);
  const sample = movie.samples[origin];
  const expectedPtsUs = sample ? ticksToUs(sample.ptsTimescale, movie.timescale) : 0;
  const expectedDtsUs = sample ? ticksToUs(sample.dtsTimescale, movie.timescale) : 0;
  const expectedKey = sample?.isKeyframe === true;
  let reason: string | null = null;
  if (!sample) reason = `missing sample ${origin}`;
  else if (first.index !== origin) reason = `first submit ${first.index} != gopStart ${origin}`;
  else if (!first.key || !expectedKey) reason = `first submit sample ${origin} is not a keyframe`;
  else if (first.ptsUs !== expectedPtsUs) reason = `first PTS ${first.ptsUs} != expected ${expectedPtsUs}`;
  else if (first.dtsUs !== expectedDtsUs) reason = `first DTS ${first.dtsUs} != expected ${expectedDtsUs}`;
  return {
    gopStart: origin,
    sampleIndex: first.index,
    key: first.key,
    ptsUs: first.ptsUs,
    dtsUs: first.dtsUs,
    expectedPtsUs,
    expectedDtsUs,
    ok: reason == null,
    reason,
  };
}

function viewOf(data: unknown): Uint8Array {
  if (!data) return new Uint8Array(0);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(0);
}
