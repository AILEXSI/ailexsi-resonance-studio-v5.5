import { describe, expect, it } from "vitest";
import { AfeError, parseIsoBmff } from "../../src/core/frame-engine";

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function fourcc(tag: string): Uint8Array {
  return new Uint8Array([tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32(8 + payload.length), fourcc(type), payload);
}

describe("AFE typed unsupported / decode errors", () => {
  it("rejects non-ISO-BMFF as AFE_UNSUPPORTED_CONTAINER", () => {
    expect(() => parseIsoBmff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(AfeError);
    try {
      parseIsoBmff(new TextEncoder().encode("not an mp4 file!!!!"));
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AfeError);
      expect((e as AfeError).code).toBe("AFE_UNSUPPORTED_CONTAINER");
      expect((e as AfeError).fallbackSafe).toBe(true);
    }
  });

  it("rejects ftyp-without-moov as AFE_UNSUPPORTED_CONTAINER", () => {
    const ftyp = box("ftyp", concat(fourcc("isom"), u32(0), fourcc("isom")));
    try {
      parseIsoBmff(ftyp);
      expect.fail("expected throw");
    } catch (e) {
      expect((e as AfeError).code).toBe("AFE_UNSUPPORTED_CONTAINER");
    }
  });

  it("rejects moov without a video track as AFE_UNSUPPORTED_CODEC", () => {
    const mdhd = box("mdhd", new Uint8Array(28));
    const hdlrPayload = new Uint8Array(24);
    hdlrPayload[8] = 115; // s
    hdlrPayload[9] = 111; // o
    hdlrPayload[10] = 117; // u
    hdlrPayload[11] = 110; // n
    const hdlr = box("hdlr", hdlrPayload);
    const mdia = box("mdia", concat(mdhd, hdlr));
    const trak = box("trak", mdia);
    const moov = box("moov", trak);
    const ftyp = box("ftyp", concat(fourcc("isom"), u32(0), fourcc("isom")));
    try {
      parseIsoBmff(concat(ftyp, moov));
      expect.fail("expected throw");
    } catch (e) {
      expect((e as AfeError).code).toBe("AFE_UNSUPPORTED_CODEC");
      expect((e as AfeError).fallbackSafe).toBe(true);
    }
  });

  it("rejects fragmented files (moof) as AFE_UNSUPPORTED_SAMPLE_TABLE", () => {
    const ftyp = box("ftyp", concat(fourcc("isom"), u32(0), fourcc("isom")));
    const moov = box("moov", new Uint8Array(0));
    const moof = box("moof", new Uint8Array(0));
    try {
      parseIsoBmff(concat(ftyp, moov, moof));
      expect.fail("expected throw");
    } catch (e) {
      expect((e as AfeError).code).toBe("AFE_UNSUPPORTED_SAMPLE_TABLE");
    }
  });

  it("AfeError codes are the documented containment set", () => {
    const codes = [
      "AFE_UNSUPPORTED_CONTAINER",
      "AFE_UNSUPPORTED_CODEC",
      "AFE_UNSUPPORTED_SAMPLE_TABLE",
      "AFE_DECODE_CONFIG_FAILED",
      "AFE_DECODE_FAILED",
      "AFE_ABORTED",
    ];
    for (const code of codes) {
      const err = new AfeError(code as "AFE_ABORTED", "x");
      expect(err.message.startsWith(code)).toBe(true);
      expect(err.fallbackSafe).toBe(code !== "AFE_ABORTED");
    }
  });
});
