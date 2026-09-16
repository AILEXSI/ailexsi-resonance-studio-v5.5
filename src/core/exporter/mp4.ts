/** Minimal ISO-BMFF muxer for AVC (H.264) WebCodecs output, optional AAC.
 *
 * STRESS-04: sample-count-dependent lists never travel through JS spread /
 * argument lists. Large tables and mdat payloads use pre-sized iterative writes.
 */

/** Iterative concat: one length pass, one allocation, one copy pass. Never spread. */
export function concatParts(parts: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (let i = 0; i < parts.length; i++) {
    len += parts[i]!.length;
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Small fixed-arity helper. Callers must not spread a sample-count list into this. */
function concat(...parts: Uint8Array[]): Uint8Array {
  return concatParts(parts);
}

function u8(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function u16(n: number): Uint8Array {
  return u8((n >> 8) & 0xff, n & 0xff);
}

function u32(n: number): Uint8Array {
  return u8((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function writeU32(out: Uint8Array, offset: number, n: number): void {
  out[offset] = (n >>> 24) & 0xff;
  out[offset + 1] = (n >>> 16) & 0xff;
  out[offset + 2] = (n >>> 8) & 0xff;
  out[offset + 3] = n & 0xff;
}

function fourcc(tag: string): Uint8Array {
  return u8(tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3));
}

/** Non-variadic box. `payloads` may be large; it is never spread into a call. */
export function boxParts(type: string, payloads: readonly Uint8Array[]): Uint8Array {
  const payload = concatParts(payloads);
  return concatParts([u32(8 + payload.length), fourcc(type), payload]);
}

/** Non-variadic full box. Large table payloads stay in one array, not rest args. */
export function fullBoxParts(
  type: string,
  version: number,
  flags: number,
  payloads: readonly Uint8Array[],
): Uint8Array {
  const header = u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff);
  const all = new Array<Uint8Array>(payloads.length + 1);
  all[0] = header;
  for (let i = 0; i < payloads.length; i++) {
    all[i + 1] = payloads[i]!;
  }
  return boxParts(type, all);
}

/** Small fixed-arity box. Sample-count lists must use boxParts / table helpers. */
function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  return boxParts(type, payloads);
}

/** Small fixed-arity full box. Sample-count lists must use fullBoxParts / tables. */
function fullBox(type: string, version: number, flags: number, ...payloads: Uint8Array[]): Uint8Array {
  return fullBoxParts(type, version, flags, payloads);
}

function asciiPad(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const n = Math.min(text.length, size);
  for (let i = 0; i < n; i++) out[i] = text.charCodeAt(i);
  return out;
}

function identityMatrix(): Uint8Array {
  return concat(
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000),
  );
}

export interface AvcSample {
  data: Uint8Array;
  timestampUs: number;
  durationUs: number;
  key: boolean;
}

export interface AacSample {
  data: Uint8Array;
  timestampUs: number;
  durationUs: number;
}

export interface AacTrack {
  sampleRate: number;
  channels: number;
  description: Uint8Array;
  samples: AacSample[];
}

/** Same object `exportWithWebCodecs` passes to `muxAvcToMp4`. Empty encode → no audio trak. */
export function audioInputForMux(
  encoded: { description: Uint8Array; samples: AacSample[] } | null | undefined,
  probe: { sampleRate: number; channels: number } | null | undefined,
): AacTrack | undefined {
  if (!encoded || !probe) return undefined;
  if (encoded.samples.length === 0 || encoded.description.byteLength === 0) return undefined;
  return {
    sampleRate: probe.sampleRate,
    channels: probe.channels,
    description: encoded.description,
    samples: encoded.samples,
  };
}

function extractAvcC(description: Uint8Array): Uint8Array {
  if (description.length >= 8) {
    const tag = String.fromCharCode(
      description[4] ?? 0,
      description[5] ?? 0,
      description[6] ?? 0,
      description[7] ?? 0,
    );
    if (tag === "avcC") {
      const size = ((description[0] ?? 0) << 24) | ((description[1] ?? 0) << 16) | ((description[2] ?? 0) << 8) | (description[3] ?? 0);
      return description.slice(8, size);
    }
  }
  return description;
}

function extractAsc(description: Uint8Array): Uint8Array {
  if (description.length >= 8) {
    const tag = String.fromCharCode(
      description[4] ?? 0,
      description[5] ?? 0,
      description[6] ?? 0,
      description[7] ?? 0,
    );
    if (tag === "esds") {
      return description;
    }
  }
  return description;
}

function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  const size = payload.length;
  if (size < 128) return concat(u8(tag, size), payload);
  return concat(
    u8(
      tag,
      0x80 | ((size >> 21) & 0x7f),
      0x80 | ((size >> 14) & 0x7f),
      0x80 | ((size >> 7) & 0x7f),
      size & 0x7f,
    ),
    payload,
  );
}

/** ISO-BMFF stts. Packed run-length; payload is one pre-sized buffer (no per-entry spread). */
function packedStts(deltas: number[]): Uint8Array {
  const entries: number[] = [];
  for (let i = 0; i < deltas.length; i++) {
    const delta = deltas[i]!;
    const last = entries.length - 2;
    if (last >= 0 && entries[last + 1] === delta) {
      entries[last] += 1;
    } else {
      entries.push(1, delta);
    }
  }
  const entryCount = (entries.length / 2) | 0;
  const payload = new Uint8Array(4 + entries.length * 4);
  writeU32(payload, 0, entryCount);
  for (let i = 0; i < entries.length; i++) {
    writeU32(payload, 4 + i * 4, entries[i]!);
  }
  return fullBoxParts("stts", 0, 0, [payload]);
}

/** ISO-BMFF stsz with sample_size=0 and N explicit sizes. One DataView payload. */
function stszBox(sampleByteLengths: readonly number[]): Uint8Array {
  const n = sampleByteLengths.length;
  const payload = new Uint8Array(8 + n * 4);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  view.setUint32(0, 0);
  view.setUint32(4, n);
  for (let i = 0; i < n; i++) {
    view.setUint32(8 + i * 4, sampleByteLengths[i]!);
  }
  return fullBoxParts("stsz", 0, 0, [payload]);
}

function stszBoxFromSamples(samples: readonly { data: Uint8Array }[]): Uint8Array {
  const n = samples.length;
  const payload = new Uint8Array(8 + n * 4);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  view.setUint32(0, 0);
  view.setUint32(4, n);
  for (let i = 0; i < n; i++) {
    view.setUint32(8 + i * 4, samples[i]!.data.length);
  }
  return fullBoxParts("stsz", 0, 0, [payload]);
}

/** ISO-BMFF stss. One pre-sized payload; key count may equal sample count. */
function stssBox(keySampleNumbers: readonly number[]): Uint8Array {
  const n = keySampleNumbers.length;
  const payload = new Uint8Array(4 + n * 4);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  view.setUint32(0, n);
  for (let i = 0; i < n; i++) {
    view.setUint32(4 + i * 4, keySampleNumbers[i]!);
  }
  return fullBoxParts("stss", 0, 0, [payload]);
}

function keySampleNumbers(samples: readonly AvcSample[]): number[] {
  const keys: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i]!.key) keys.push(i + 1);
  }
  return keys;
}

/** Concat sample bytes into one buffer. Length + copy are iterative; no spread. */
function concatSamplePayloads(samples: readonly { data: Uint8Array }[]): Uint8Array {
  let len = 0;
  for (let i = 0; i < samples.length; i++) {
    len += samples[i]!.data.length;
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < samples.length; i++) {
    const d = samples[i]!.data;
    out.set(d, o);
    o += d.length;
  }
  return out;
}

function esdsFromAsc(asc: Uint8Array, bitrate: number): Uint8Array {
  const dsi = descriptor(0x05, asc);
  const decoderConfig = descriptor(
    0x04,
    concat(u8(0x40), u8(0x15), u8(0, 1, 0), u32(bitrate), u32(bitrate), dsi),
  );
  const sl = descriptor(0x06, u8(0x02));
  const es = descriptor(0x03, concat(u16(1), u8(0), decoderConfig, sl));
  return fullBox("esds", 0, 0, es);
}

function videoTrak(opts: {
  width: number;
  height: number;
  durationMovie: number;
  timescale: number;
  mediaDuration: number;
  avcC: Uint8Array;
  samples: AvcSample[];
  sampleDeltas: number[];
  chunkOffset: number;
}): Uint8Array {
  const stts = packedStts(opts.sampleDeltas);
  const stss = stssBox(keySampleNumbers(opts.samples));
  const stsc = fullBox("stsc", 0, 0, u32(1), u32(1), u32(opts.samples.length), u32(1));
  const stsz = stszBoxFromSamples(opts.samples);
  const stco = fullBox("stco", 0, 0, u32(1), u32(opts.chunkOffset));
  const avc1 = box(
    "avc1",
    new Uint8Array(6),
    u16(1),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(0),
    u16(opts.width),
    u16(opts.height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    asciiPad("AILEXSI V5.5", 32),
    u16(0x0018),
    u16(0xffff),
    box("avcC", opts.avcC),
  );
  const stsd = fullBox("stsd", 0, 0, u32(1), avc1);
  const stbl = box("stbl", stsd, stts, stsc, stsz, stco, stss);
  const dref = fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1));
  const dinf = box("dinf", dref);
  const vmhd = fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0));
  const minf = box("minf", vmhd, dinf, stbl);
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    u32(0),
    fourcc("vide"),
    u32(0),
    u32(0),
    u32(0),
    asciiPad("VideoHandler", 13),
  );
  const mdhd = fullBox(
    "mdhd",
    0,
    0,
    u32(0),
    u32(0),
    u32(opts.timescale),
    u32(opts.mediaDuration),
    u16(0x55c4),
    u16(0),
  );
  const mdia = box("mdia", mdhd, hdlr, minf);
  const tkhd = fullBox(
    "tkhd",
    0,
    0x000007,
    u32(0),
    u32(0),
    u32(1),
    u32(0),
    u32(opts.durationMovie),
    u32(0),
    u32(0),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    identityMatrix(),
    u32(opts.width << 16),
    u32(opts.height << 16),
  );
  return box("trak", tkhd, mdia);
}

function audioTrak(opts: {
  durationMovie: number;
  sampleRate: number;
  channels: number;
  mediaDuration: number;
  asc: Uint8Array;
  samples: AacSample[];
  sampleDeltas: number[];
  chunkOffset: number;
}): Uint8Array {
  const stts = packedStts(opts.sampleDeltas);
  const stsc = fullBox("stsc", 0, 0, u32(1), u32(1), u32(opts.samples.length), u32(1));
  const stsz = stszBoxFromSamples(opts.samples);
  const stco = fullBox("stco", 0, 0, u32(1), u32(opts.chunkOffset));
  const mp4a = box(
    "mp4a",
    new Uint8Array(6),
    u16(1),
    u32(0),
    u32(0),
    u16(opts.channels),
    u16(16),
    u16(0),
    u16(0),
    u32(opts.sampleRate << 16),
    esdsFromAsc(opts.asc, 128_000),
  );
  const stsd = fullBox("stsd", 0, 0, u32(1), mp4a);
  const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
  const dref = fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1));
  const dinf = box("dinf", dref);
  const smhd = fullBox("smhd", 0, 0, u16(0), u16(0));
  const minf = box("minf", smhd, dinf, stbl);
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    u32(0),
    fourcc("soun"),
    u32(0),
    u32(0),
    u32(0),
    asciiPad("SoundHandler", 13),
  );
  const mdhd = fullBox(
    "mdhd",
    0,
    0,
    u32(0),
    u32(0),
    u32(opts.sampleRate),
    u32(opts.mediaDuration),
    u16(0x55c4),
    u16(0),
  );
  const mdia = box("mdia", mdhd, hdlr, minf);
  const tkhd = fullBox(
    "tkhd",
    0,
    0x000007,
    u32(0),
    u32(0),
    u32(2),
    u32(0),
    u32(opts.durationMovie),
    u32(0),
    u32(0),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    identityMatrix(),
    u32(0),
    u32(0),
  );
  return box("trak", tkhd, mdia);
}

export function muxAvcToMp4(opts: {
  width: number;
  height: number;
  fps: number;
  description: Uint8Array;
  samples: AvcSample[];
  audio?: AacTrack;
}): Uint8Array {
  if (opts.samples.length === 0) {
    throw new Error("No encoded samples to mux");
  }
  const avcC = extractAvcC(opts.description);
  if (avcC.length < 7) {
    throw new Error("Missing AVC decoder config (avcC)");
  }

  const timescale = 30000;
  const sampleDeltas = opts.samples.map((s) =>
    Math.max(1, Math.round((s.durationUs / 1_000_000) * timescale)),
  );
  const videoMediaDuration = sampleDeltas.reduce((a, b) => a + b, 0);

  const audio = opts.audio && opts.audio.samples.length > 0 ? opts.audio : undefined;
  const audioDeltas = audio
    ? audio.samples.map((s) =>
        Math.max(1, Math.round((s.durationUs / 1_000_000) * audio.sampleRate)),
      )
    : [];
  const audioMediaDuration = audioDeltas.reduce((a, b) => a + b, 0);
  const audioDurationMovie = audio
    ? Math.max(1, Math.round((audioMediaDuration / audio.sampleRate) * timescale))
    : 0;
  const durationMovie = Math.max(videoMediaDuration, audioDurationMovie);

  const videoPayload = concatSamplePayloads(opts.samples);
  const audioPayload = audio ? concatSamplePayloads(audio.samples) : new Uint8Array(0);
  const mdat = box("mdat", videoPayload, audioPayload);
  const mdatHeaderSize = 8;

  const ftyp = box(
    "ftyp",
    fourcc("isom"),
    u32(0x00000200),
    fourcc("isom"),
    fourcc("iso2"),
    fourcc("avc1"),
    fourcc("mp41"),
  );

  const nextTrackId = audio ? 3 : 2;
  const buildMoov = (videoOffset: number, audioOffset: number): Uint8Array => {
    const video = videoTrak({
      width: opts.width,
      height: opts.height,
      durationMovie,
      timescale,
      mediaDuration: videoMediaDuration,
      avcC,
      samples: opts.samples,
      sampleDeltas,
      chunkOffset: videoOffset,
    });
    const audioTrakBox = audio
      ? audioTrak({
          durationMovie,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          mediaDuration: audioMediaDuration,
          asc: extractAsc(audio.description),
          samples: audio.samples,
          sampleDeltas: audioDeltas,
          chunkOffset: audioOffset,
        })
      : undefined;
    const mvhd = fullBox(
      "mvhd",
      0,
      0,
      u32(0),
      u32(0),
      u32(timescale),
      u32(durationMovie),
      u32(0x00010000),
      u16(0x0100),
      u16(0),
      u32(0),
      u32(0),
      identityMatrix(),
      u32(0),
      u32(0),
      u32(0),
      u32(0),
      u32(0),
      u32(0),
      u32(nextTrackId),
    );
    return audioTrakBox ? box("moov", mvhd, video, audioTrakBox) : box("moov", mvhd, video);
  };

  let moov = buildMoov(0, 0);
  const videoOffset = ftyp.length + moov.length + mdatHeaderSize;
  const audioOffset = videoOffset + videoPayload.length;
  moov = buildMoov(videoOffset, audioOffset);
  return concatParts([ftyp, moov, mdat]);
}

export function mp4HasAudioTrack(bytes: Uint8Array): boolean {
  const text = Array.from(bytes.subarray(0, Math.min(bytes.length, 64_000)))
    .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
    .join("");
  return text.includes("mp4a") && text.includes("soun");
}

/** Exported for STRESS-04 tests that assert table construction without a full movie. */
export const mp4MuxInternals = {
  packedStts,
  stszBox,
  stszBoxFromSamples,
  stssBox,
  concatSamplePayloads,
};
