import { describe, expect, it } from "vitest";
import { probeAac } from "../../src/core/exporter/audio";
import { validateMp4Ftyp } from "../../src/core/exporter/ftyp";
import { audioInputForMux, mp4HasAudioTrack, muxAvcToMp4 } from "../../src/core/exporter/mp4";

const avcC = new Uint8Array([
  1, 0x42, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x08, 0x67, 0x42, 0x00, 0x1f, 0xaa, 0xbb, 0xcc, 0xdd, 0x01,
  0x00, 0x05, 0x68, 0xee, 0xff, 0x00, 0x11,
]);
const nal = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x65, 1, 2, 3, 4, 5, 6, 7]);

/** AAC-LC AudioSpecificConfig: 44.1 kHz stereo. Not a live encoder output. */
const AAC_LC_44100_STEREO_ASC = new Uint8Array([0x12, 0x10]);
const AAC_FRAME = new Uint8Array([0x21, 0x00, 0x49, 0x90, 0x02, 0xff, 0xf1, 0x50]);

function videoOnly() {
  return muxAvcToMp4({
    width: 16,
    height: 16,
    fps: 30,
    description: avcC,
    samples: [{ data: nal, timestampUs: 0, durationUs: 33333, key: true }],
  });
}

describe("MP4 mux audio track (synthetic AAC fixture)", () => {
  it("video-only mux has no soun/mp4a track", () => {
    const bytes = videoOnly();
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
    expect(mp4HasAudioTrack(bytes)).toBe(false);
  });

  it("audioInputForMux is undefined without encoded samples", () => {
    expect(audioInputForMux(null, { sampleRate: 44100, channels: 2 })).toBeUndefined();
    expect(
      audioInputForMux({ description: AAC_LC_44100_STEREO_ASC, samples: [] }, { sampleRate: 44100, channels: 2 }),
    ).toBeUndefined();
  });

  it("muxer is given an AAC track and the MP4 contains soun + mp4a", () => {
    const encoded = {
      description: AAC_LC_44100_STEREO_ASC,
      samples: [{ data: AAC_FRAME, timestampUs: 0, durationUs: 23220 }],
    };
    const probe = { sampleRate: 44100, channels: 2 };
    const audio = audioInputForMux(encoded, probe);
    expect(audio).toEqual({
      sampleRate: 44100,
      channels: 2,
      description: AAC_LC_44100_STEREO_ASC,
      samples: encoded.samples,
    });

    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: avcC,
      samples: [{ data: nal, timestampUs: 0, durationUs: 33333, key: true }],
      audio,
    });
    const check = validateMp4Ftyp(bytes);
    expect(check.ok).toBe(true);
    expect(check.brands).toContain("mp41");
    expect(mp4HasAudioTrack(bytes)).toBe(true);
    const ascii = Array.from(bytes)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    expect(ascii).toContain("soun");
    expect(ascii).toContain("mp4a");
    expect(ascii).toContain("esds");
    const payload = bytes.subarray(bytes.length - AAC_FRAME.length);
    expect([...payload]).toEqual([...AAC_FRAME]);
  });

  it("jsdom has no AudioEncoder so live AAC stays unverified here", async () => {
    expect(typeof AudioEncoder === "undefined" || (await probeAac()) === null).toBe(true);
  });
});
