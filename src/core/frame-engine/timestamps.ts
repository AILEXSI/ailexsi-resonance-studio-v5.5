/**
 * WebCodecs timestamp mapping (AFE-04).
 *
 * Chosen mapping — prove with tests, do not guess:
 *
 *   sample.dtsTimescale  → decode / submit order only (never EncodedVideoChunk.timestamp)
 *   sample.ptsTimescale  → EncodedVideoChunk.timestamp  (microseconds)
 *   EncodedVideoChunk.timestamp → VideoFrame.timestamp  (WebCodecs copies the integer)
 *
 * Match decoded output back to a sample by exact PTS microseconds (see PtsIndexMap).
 * DTS is not an identity key: B-frames make output order ≠ submit order.
 *
 * Units: media timescale ticks on the sample; WebCodecs uses integer microseconds.
 * Rounding is nearest-even-free `Math.round` of (ticks / timescale * 1e6).
 * Negative PTS (CTTS v1 / edit-list) is legal and stays negative in microseconds.
 */

export function ticksToUs(ticks: number, timescale: number): number {
  if (timescale <= 0 || !Number.isFinite(timescale) || !Number.isFinite(ticks)) {
    return 0;
  }
  return Math.round((ticks / timescale) * 1_000_000);
}

/** EncodedVideoChunk.timestamp := sample PTS in microseconds. */
export function samplePtsToChunkTimestampUs(ptsTimescale: number, timescale: number): number {
  return ticksToUs(ptsTimescale, timescale);
}

/** EncodedVideoChunk.duration := sample duration in microseconds (min 1). */
export function sampleDurationToChunkDurationUs(durationTimescale: number, timescale: number): number {
  return Math.max(1, ticksToUs(durationTimescale, timescale));
}

/** Inverse of samplePtsToChunkTimestampUs for documentation / oracle checks. */
export function chunkTimestampUsToTicks(timestampUs: number, timescale: number): number {
  if (timescale <= 0 || !Number.isFinite(timestampUs)) return 0;
  return (timestampUs / 1_000_000) * timescale;
}

export type WebCodecsTimestampMapping = {
  dtsTimescale: number;
  ptsTimescale: number;
  durationTimescale: number;
  timescale: number;
  chunkTimestampUs: number;
  chunkDurationUs: number;
  /** VideoFrame.timestamp is specified to equal EncodedVideoChunk.timestamp. */
  expectedVideoFrameTimestampUs: number;
};

export function mapSampleToWebCodecs(
  sample: { dtsTimescale: number; ptsTimescale: number; durationTimescale: number },
  timescale: number,
): WebCodecsTimestampMapping {
  const chunkTimestampUs = samplePtsToChunkTimestampUs(sample.ptsTimescale, timescale);
  const chunkDurationUs = sampleDurationToChunkDurationUs(sample.durationTimescale, timescale);
  return {
    dtsTimescale: sample.dtsTimescale,
    ptsTimescale: sample.ptsTimescale,
    durationTimescale: sample.durationTimescale,
    timescale,
    chunkTimestampUs,
    chunkDurationUs,
    expectedVideoFrameTimestampUs: chunkTimestampUs,
  };
}
