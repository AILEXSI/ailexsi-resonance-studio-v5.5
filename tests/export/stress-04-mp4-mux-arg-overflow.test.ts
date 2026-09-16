import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateMp4Ftyp } from "../../src/core/exporter/ftyp";
import {
  boxParts,
  concatParts,
  fullBoxParts,
  mp4HasAudioTrack,
  mp4MuxInternals,
  muxAvcToMp4,
  type AacSample,
  type AvcSample,
} from "../../src/core/exporter/mp4";
import { readBoxes, type ParsedBox } from "../../src/core/frame-engine";

const AVC_C = new Uint8Array([
  1, 0x42, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x08,
  0x67, 0x42, 0x00, 0x1f, 0xaa, 0xbb, 0xcc, 0xdd,
  0x01, 0x00, 0x05, 0x68, 0xee, 0xff, 0x00, 0x11,
]);
const NAL = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x65, 1, 2, 3, 4, 5, 6, 7]);
const AAC_ASC = new Uint8Array([0x12, 0x10]);
const AAC_FRAME = new Uint8Array([0x21, 0x00, 0x49, 0x90, 0x02, 0xff, 0xf1, 0x50]);

/** Captured from muxer at 04fc687 before the STRESS-04 rewrite. */
const GOLDEN_VIDEO_HEX =
  "000000206674797069736f6d0000020069736f6d69736f32617663316d703431000002776d6f6f760000006c6d7668640000000000000000000000000000753000000bb80001000001000000000000000000000000010000000000000000000000000000000100000000000000000000000000004000000000000000000000000000000000000000000000000000000000000002000002037472616b0000005c746b6864000000070000000000000000000000010000000000000bb80000000000000000000000000000000000010000000000000000000000000000000100000000000000000000000000004000000000100000001000000000019f6d646961000000206d6468640000000000000000000000000000753000000bb855c400000000002d68646c72000000000000000076696465000000000000000000000000566964656f48616e646c6572000000014a6d696e6600000014766d68640000000100000000000000000000002464696e660000001c6472656600000000000000010000000c75726c20000000010000010a7374626c00000086737473640000000000000001000000766176633100000000000000010000000000000000000000000000000000100010004800000048000000000000000141494c455853492056352e3500000000000000000000000000000000000000000018ffff00000020617663430142001fffe100086742001faabbccdd01000568eeff00110000001873747473000000000000000100000003000003e80000001c737473630000000000000001000000010000000300000001000000207374737a0000000000000000000000030000000c0000000800000008000000147374636f00000000000000010000029f0000001473747373000000000000000100000001000000246d64617400000008650102030405060700000004410908070000000441060504";

const GOLDEN_AV_HEX =
  "000000206674797069736f6d0000020069736f6d69736f32617663316d7034310000042f6d6f6f760000006c6d76686400000000000000000000000000007530000007d00001000001000000000000000000000000010000000000000000000000000000000100000000000000000000000000004000000000000000000000000000000000000000000000000000000000000003000001ff7472616b0000005c746b68640000000700000000000000000000000100000000000007d00000000000000000000000000000000000010000000000000000000000000000000100000000000000000000000000004000000000100000001000000000019b6d646961000000206d64686400000000000000000000000000007530000007d055c400000000002d68646c72000000000000000076696465000000000000000000000000566964656f48616e646c657200000001466d696e6600000014766d68640000000100000000000000000000002464696e660000001c6472656600000000000000010000000c75726c2000000001000001067374626c00000086737473640000000000000001000000766176633100000000000000010000000000000000000000000000000000100010004800000048000000000000000141494c455853492056352e3500000000000000000000000000000000000000000018ffff00000020617663430142001fffe100086742001faabbccdd01000568eeff00110000001873747473000000000000000100000002000003e80000001c7374736300000000000000010000000100000002000000010000001c7374737a0000000000000000000000020000000c00000008000000147374636f0000000000000001000004570000001473747373000000000000000100000001000001bc7472616b0000005c746b68640000000700000000000000000000000200000000000007d0000000000000000000000000000000000001000000000000000000000000000000010000000000000000000000000000400000000000000000000000000001586d646961000000206d6468640000000000000000000000000000ac440000080055c400000000002d68646c720000000000000000736f756e000000000000000000000000536f756e6448616e646c657200000001036d696e6600000010736d686400000000000000000000002464696e660000001c6472656600000000000000010000000c75726c2000000001000000c77374626c0000005b7374736400000000000000010000004b6d703461000000000000000100000000000000000002001000000000ac4400000000002765736473000000000319000100041140150001000001f4000001f400050212100601020000001873747473000000000000000100000002000004000000001c7374736300000000000000010000000100000002000000010000001c7374737a0000000000000000000000020000000800000004000000147374636f00000000000000010000046b000000286d64617400000008650102030405060700000004410908072100499002fff15021112233";

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf", "edts"]);

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function u32At(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function collectBoxes(bytes: Uint8Array): Map<string, ParsedBox[]> {
  const byType = new Map<string, ParsedBox[]>();
  const visit = (start: number, end: number) => {
    const boxes = readBoxes(bytes, start, end);
    for (const box of boxes) {
      const list = byType.get(box.type) ?? [];
      list.push(box);
      byType.set(box.type, list);
      if (CONTAINERS.has(box.type)) visit(box.payloadStart, box.payloadEnd);
    }
  };
  visit(0, bytes.length);
  return byType;
}

function requireBox(byType: Map<string, ParsedBox[]>, type: string, index = 0): ParsedBox {
  const hit = byType.get(type)?.[index];
  if (!hit) throw new Error(`missing box ${type}#${index}`);
  return hit;
}

function parseStsz(bytes: Uint8Array, box: ParsedBox): { sampleSize: number; entryCount: number; sizes: number[] } {
  const data = box.payloadStart + 4;
  const sampleSize = u32At(bytes, data);
  const entryCount = u32At(bytes, data + 4);
  const sizes: number[] = [];
  if (sampleSize === 0) {
    for (let i = 0; i < entryCount; i++) sizes.push(u32At(bytes, data + 8 + i * 4));
  }
  return { sampleSize, entryCount, sizes };
}

function parseStss(bytes: Uint8Array, box: ParsedBox): number[] {
  const data = box.payloadStart + 4;
  const n = u32At(bytes, data);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(u32At(bytes, data + 4 + i * 4));
  return out;
}

function parseStco(bytes: Uint8Array, box: ParsedBox): number[] {
  const data = box.payloadStart + 4;
  const n = u32At(bytes, data);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(u32At(bytes, data + 4 + i * 4));
  return out;
}

function parseStts(bytes: Uint8Array, box: ParsedBox): { count: number; delta: number }[] {
  const data = box.payloadStart + 4;
  const n = u32At(bytes, data);
  const out: { count: number; delta: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ count: u32At(bytes, data + 4 + i * 8), delta: u32At(bytes, data + 8 + i * 8) });
  }
  return out;
}

function parseMdhdDuration(bytes: Uint8Array, box: ParsedBox): { timescale: number; duration: number } {
  const data = box.payloadStart + 4;
  return { timescale: u32At(bytes, data + 8), duration: u32At(bytes, data + 12) };
}

function parseMvhdDuration(bytes: Uint8Array, box: ParsedBox): { timescale: number; duration: number } {
  const data = box.payloadStart + 4;
  return { timescale: u32At(bytes, data + 8), duration: u32At(bytes, data + 12) };
}

function makeVideoSamples(count: number, opts?: { keyEvery?: number; varySize?: boolean; varyDelta?: boolean }): AvcSample[] {
  const keyEvery = opts?.keyEvery ?? 30;
  const samples: AvcSample[] = new Array(count);
  const shared = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 1, 2, 3]);
  for (let i = 0; i < count; i++) {
    const extra = opts?.varySize ? (i % 5) : 0;
    const data = extra === 0 ? shared : new Uint8Array([...shared, extra]);
    samples[i] = {
      data,
      timestampUs: i * 33_333,
      durationUs: opts?.varyDelta && i % 2 === 1 ? 40_000 : 33_333,
      key: i % keyEvery === 0,
    };
  }
  return samples;
}

function makeAudioSamples(count: number): AacSample[] {
  const shared = new Uint8Array([0x21, 0x00, 0x49, 0x90]);
  const samples: AacSample[] = new Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = { data: shared, timestampUs: i * 23_220, durationUs: 23_220 };
  }
  return samples;
}

describe("STRESS-04 MP4 mux argument overflow", () => {
  it("A: small video-only mux is byte-identical to the pre-fix golden", () => {
    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: AVC_C,
      samples: [
        { data: NAL, timestampUs: 0, durationUs: 33333, key: true },
        { data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x41, 9, 8, 7]), timestampUs: 33333, durationUs: 33333, key: false },
        { data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x41, 6, 5, 4]), timestampUs: 66666, durationUs: 33334, key: false },
      ],
    });
    expect(hexOf(bytes)).toBe(GOLDEN_VIDEO_HEX);
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
  });

  it("A: small video+audio mux is byte-identical to the pre-fix golden", () => {
    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: AVC_C,
      samples: [
        { data: NAL, timestampUs: 0, durationUs: 33333, key: true },
        { data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x41, 9, 8, 7]), timestampUs: 33333, durationUs: 33333, key: false },
      ],
      audio: {
        sampleRate: 44100,
        channels: 2,
        description: AAC_ASC,
        samples: [
          { data: AAC_FRAME, timestampUs: 0, durationUs: 23220 },
          { data: new Uint8Array([0x21, 0x11, 0x22, 0x33]), timestampUs: 23220, durationUs: 23220 },
        ],
      },
    });
    expect(hexOf(bytes)).toBe(GOLDEN_AV_HEX);
    expect(mp4HasAudioTrack(bytes)).toBe(true);
  });

  it("concatParts / boxParts / fullBoxParts never spread a large list", () => {
    const n = 25_000;
    const parts: Uint8Array[] = new Array(n);
    for (let i = 0; i < n; i++) parts[i] = new Uint8Array([i & 0xff]);
    const joined = concatParts(parts);
    expect(joined.length).toBe(n);
    expect(joined[0]).toBe(0);
    expect(joined[255]).toBe(255);
    expect(joined[n - 1]).toBe((n - 1) & 0xff);

    const boxed = boxParts("mdat", parts);
    expect(boxed.length).toBe(8 + n);
    expect(String.fromCharCode(boxed[4]!, boxed[5]!, boxed[6]!, boxed[7]!)).toBe("mdat");
    expect(u32At(boxed, 0)).toBe(8 + n);

    const full = fullBoxParts("stsz", 0, 0, parts);
    expect(full.length).toBe(12 + n);
    expect(String.fromCharCode(full[4]!, full[5]!, full[6]!, full[7]!)).toBe("stsz");
  });

  it("B: 25_000 video samples mux without RangeError and have valid structure", () => {
    const count = 25_000;
    const samples = makeVideoSamples(count, { keyEvery: 30, varySize: true });
    const t0 = performance.now();
    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: AVC_C,
      samples,
    });
    const elapsedMs = performance.now() - t0;
    expect(bytes.length).toBeGreaterThan(8);
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
    expect(validateMp4Ftyp(bytes).brands).toEqual(expect.arrayContaining(["isom", "iso2", "avc1", "mp41"]));

    const boxes = collectBoxes(bytes);
    const top = readBoxes(bytes, 0, bytes.length);
    expect(top.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(boxes.get("trak")).toHaveLength(1);
    expect(boxes.get("moov")).toHaveLength(1);
    expect(boxes.get("mdat")).toHaveLength(1);

    const stsz = parseStsz(bytes, requireBox(boxes, "stsz"));
    expect(stsz.sampleSize).toBe(0);
    expect(stsz.entryCount).toBe(count);
    expect(stsz.sizes).toHaveLength(count);
    expect(stsz.sizes[0]).toBe(samples[0]!.data.length);
    expect(stsz.sizes[1]).toBe(samples[1]!.data.length);
    expect(stsz.sizes[count - 1]).toBe(samples[count - 1]!.data.length);
    for (let i = 0; i < count; i += 137) {
      expect(stsz.sizes[i]).toBe(samples[i]!.data.length);
    }

    const keys = parseStss(bytes, requireBox(boxes, "stss"));
    expect(keys[0]).toBe(1);
    expect(keys.length).toBe(Math.ceil(count / 30));
    expect(keys[1]).toBe(31);

    const stco = parseStco(bytes, requireBox(boxes, "stco"));
    expect(stco).toHaveLength(1);
    const mdat = requireBox(boxes, "mdat");
    expect(stco[0]).toBe(mdat.payloadStart);
    expect(bytes.subarray(stco[0]!, stco[0]! + samples[0]!.data.length)).toEqual(samples[0]!.data);

    const videoBytes = samples.reduce((n, s) => n + s.data.length, 0);
    expect(mdat.size).toBe(8 + videoBytes);

    const mdhd = parseMdhdDuration(bytes, requireBox(boxes, "mdhd"));
    expect(mdhd.timescale).toBe(30_000);
    const expectedTicks = samples.reduce(
      (n, s) => n + Math.max(1, Math.round((s.durationUs / 1_000_000) * 30_000)),
      0,
    );
    expect(mdhd.duration).toBe(expectedTicks);
    const mvhd = parseMvhdDuration(bytes, requireBox(boxes, "mvhd"));
    expect(mvhd.timescale).toBe(30_000);
    expect(mvhd.duration).toBe(expectedTicks);

    // One sample-data copy into mdat + one copy into the final file via concatParts([ftyp,moov,mdat]).
    expect(elapsedMs).toBeLessThan(15_000);
    expect(bytes.length).toBe(top[0]!.size + top[1]!.size + top[2]!.size);
  });

  it("C: 50_000 video samples mux without spread / argument overflow", () => {
    const count = 50_000;
    const samples = makeVideoSamples(count, { keyEvery: 1 });
    const bytes = muxAvcToMp4({
      width: 32,
      height: 18,
      fps: 30,
      description: AVC_C,
      samples,
    });
    const boxes = collectBoxes(bytes);
    expect(readBoxes(bytes, 0, bytes.length).map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    const stsz = parseStsz(bytes, requireBox(boxes, "stsz"));
    expect(stsz.entryCount).toBe(count);
    expect(stsz.sizes[0]).toBe(8);
    expect(stsz.sizes[count - 1]).toBe(8);
    const keys = parseStss(bytes, requireBox(boxes, "stss"));
    expect(keys).toHaveLength(count);
    expect(keys[count - 1]).toBe(count);
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
  });

  it("D: large audio sample count muxes without RangeError", () => {
    const videoCount = 1_000;
    const audioCount = 60_000;
    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: AVC_C,
      samples: makeVideoSamples(videoCount),
      audio: {
        sampleRate: 44100,
        channels: 2,
        description: AAC_ASC,
        samples: makeAudioSamples(audioCount),
      },
    });
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
    expect(mp4HasAudioTrack(bytes)).toBe(true);
    const boxes = collectBoxes(bytes);
    expect(boxes.get("trak")).toHaveLength(2);
    const videoStsz = parseStsz(bytes, requireBox(boxes, "stsz", 0));
    const audioStsz = parseStsz(bytes, requireBox(boxes, "stsz", 1));
    expect(videoStsz.entryCount).toBe(videoCount);
    expect(audioStsz.entryCount).toBe(audioCount);
    expect(audioStsz.sizes.every((n) => n === 4)).toBe(true);
    const videoStco = parseStco(bytes, requireBox(boxes, "stco", 0));
    const audioStco = parseStco(bytes, requireBox(boxes, "stco", 1));
    const mdat = requireBox(boxes, "mdat");
    expect(videoStco[0]).toBe(mdat.payloadStart);
    const videoBytes = videoCount * 8;
    expect(audioStco[0]).toBe(mdat.payloadStart + videoBytes);
    expect(mdat.size).toBe(8 + videoBytes + audioCount * 4);
  });

  it("E: stts stays valid when every delta is unique (would have been 2N+1 fullBox args)", () => {
    const count = 25_000;
    const samples = makeVideoSamples(count, { varyDelta: true, keyEvery: 60 });
    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: AVC_C,
      samples,
    });
    const boxes = collectBoxes(bytes);
    const stts = parseStts(bytes, requireBox(boxes, "stts"));
    expect(stts.length).toBe(count);
    expect(stts[0]).toEqual({ count: 1, delta: 1000 });
    expect(stts[1]).toEqual({ count: 1, delta: 1200 });
    expect(stts[2]).toEqual({ count: 1, delta: 1000 });
    const unique = new Set(stts.map((e) => e.delta));
    expect(unique.size).toBe(2);
    const packed = mp4MuxInternals.packedStts(Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 1000 : 1001)));
    expect(u32At(packed, 12)).toBe(count);
  });

  it("E: chunk offset, duration, and keyframe table match the sample list", () => {
    const samples: AvcSample[] = [
      { data: new Uint8Array([1, 2, 3, 4]), timestampUs: 0, durationUs: 33333, key: true },
      { data: new Uint8Array([5, 6]), timestampUs: 33333, durationUs: 33333, key: false },
      { data: new Uint8Array([7, 8, 9]), timestampUs: 66666, durationUs: 40000, key: true },
      { data: new Uint8Array([10]), timestampUs: 106666, durationUs: 33333, key: false },
    ];
    const bytes = muxAvcToMp4({
      width: 1920,
      height: 1080,
      fps: 30,
      description: AVC_C,
      samples,
    });
    const boxes = collectBoxes(bytes);
    expect(parseStsz(bytes, requireBox(boxes, "stsz")).sizes).toEqual([4, 2, 3, 1]);
    expect(parseStss(bytes, requireBox(boxes, "stss"))).toEqual([1, 3]);
    const mdat = requireBox(boxes, "mdat");
    expect(parseStco(bytes, requireBox(boxes, "stco"))[0]).toBe(mdat.payloadStart);
    expect(Array.from(bytes.subarray(mdat.payloadStart, mdat.payloadEnd))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const ticks = [33333, 33333, 40000, 33333].map((us) => Math.max(1, Math.round((us / 1_000_000) * 30_000)));
    expect(parseMdhdDuration(bytes, requireBox(boxes, "mdhd")).duration).toBe(ticks.reduce((a, b) => a + b, 0));
  });

  it("F: source audit — no sample-count-dependent spread remains in mp4.ts", () => {
    const srcPath = join(dirname(fileURLToPath(import.meta.url)), "../../src/core/exporter/mp4.ts");
    const src = readFileSync(srcPath, "utf8");
    const forbidden = [
      /\.\.\.opts\.samples/,
      /\.\.\.audio\.samples/,
      /\.\.\.keyIndexes/,
      /(?<!function )concat\(\.\.\./,
      /box\(\s*["']\w+["'][\s\S]*?\.\.\./,
      /fullBox\(\s*["']stsz["']/,
      /fullBox\(\s*["']stss["']/,
      /fullBox\(\s*["']stts["']/,
    ];
    for (const re of forbidden) {
      expect(src.match(re), `forbidden spread ${re}`).toBeNull();
    }
    expect(src).toContain("export function concatParts");
    expect(src).toContain("export function boxParts");
    expect(src).toContain("export function fullBoxParts");
    expect(src).toContain("function concatSamplePayloads");
    expect(src).toContain("function stszBoxFromSamples");
    expect(src).toContain("function stssBox");
    expect(src).toContain("function packedStts");

    const spreads = [...src.matchAll(/\.\.\.[A-Za-z_][\w.]*/g)].map((m) => m[0]);
    const allowed = new Set(["...parts", "...values", "...payloads"]);
    for (const token of spreads) {
      expect(allowed.has(token), `unexpected spread ${token}`).toBe(true);
    }
    expect(src).toMatch(/function concat\(\.\.\.parts/);
    expect(src).toMatch(/function u8\(\.\.\.values/);
    expect(src).toMatch(/function box\(type: string, \.\.\.payloads/);
    expect(src).toMatch(/function fullBox\([\s\S]*?\.\.\.payloads/);
    expect(src).not.toMatch(/concatParts\(\.\.\./);
    expect(src).not.toMatch(/boxParts\([^;]*?\.\.\./);
    expect(src).not.toMatch(/fullBoxParts\([^;]*?\.\.\./);
  });

  it("reports allocation strategy for a 21_195-sample human-shaped mux", () => {
    const count = 21_195;
    const samples = makeVideoSamples(count, { keyEvery: 30, varySize: true });
    const payloadBytes = samples.reduce((n, s) => n + s.data.length, 0);
    const bytes = muxAvcToMp4({
      width: 1920,
      height: 1080,
      fps: 30,
      description: AVC_C,
      samples,
    });
    const boxes = collectBoxes(bytes);
    expect(parseStsz(bytes, requireBox(boxes, "stsz")).entryCount).toBe(count);
    expect(bytes.length).toBeGreaterThan(payloadBytes);
    // Temporary: one contiguous STSZ payload (8 + 4N), one sample-payload buffer,
    // one mdat (header + copy), one final file (ftyp+moov+mdat). No quadratic growth.
    const stszBytes = 8 + count * 4;
    expect(requireBox(boxes, "stsz").size).toBe(12 + stszBytes);
    expect(payloadBytes).toBeGreaterThan(count);
    expect(bytes.length).toBeLessThan(payloadBytes * 3 + 2_000_000);
  });
});
