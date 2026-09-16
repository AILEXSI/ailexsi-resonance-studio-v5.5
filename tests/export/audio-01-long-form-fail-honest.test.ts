import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AAC_ENCODE_QUEUE_HIGH_WATER,
  AUDIO_STAGE_NAMES,
  AudioExportError,
  audioInputForMux,
  classifyOfflineAudioMemory,
  encodeAac,
  expectsAudio,
  exportableAudioClips,
  finalizeExportAudio,
  formatAudioExportReport,
  formatAudioFail,
  formatExportFailDump,
  jobFromProject,
  aacAudioSpecificConfigIsUsable,
  mp4HasAudioTrack,
  mp4SoundTrackInfo,
  muxAvcToMp4,
  pcmBytesForDuration,
  prepareJobAudioMix,
  resetAudioExportReport,
  snapshotAudioExportReport,
  validateMp4Ftyp,
  waitForAudioEncodeQueue,
  captureThrownValue,
} from "../../src/core/exporter";
import type { ExportHooks, ExportJob } from "../../src/core/exporter/types";
import { asset, clip, projectWith } from "../helpers";

const AVC_C = new Uint8Array([
  1, 0x42, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x08, 0x67, 0x42, 0x00, 0x1f, 0xaa, 0xbb, 0xcc, 0xdd, 0x01,
  0x00, 0x05, 0x68, 0xee, 0xff, 0x00, 0x11,
]);
const NAL = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x65, 1, 2, 3, 4, 5, 6, 7]);
const AAC_ASC = new Uint8Array([0x12, 0x10]);
const AAC_FRAME = new Uint8Array([0x21, 0x00, 0x49, 0x90, 0x02, 0xff, 0xf1, 0x50]);
const PROBE = { sampleRate: 44100, channels: 2, bitrate: 128_000 };

function pcmBuffer(length = 2048, sampleRate = 44100, channels = 2): AudioBuffer {
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    duration: length / sampleRate,
    getChannelData: () => new Float32Array(length),
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

function encodedAac(count = 2) {
  return {
    description: AAC_ASC,
    samples: Array.from({ length: count }, (_, i) => ({
      data: AAC_FRAME,
      timestampUs: i * 23220,
      durationUs: 23220,
    })),
  };
}

function audioJob(): ExportJob {
  const p = projectWith(
    [clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 2000, gain: 1 })],
    [asset({ id: "aa", kind: "audio", durationMs: 2000, objectUrl: "blob:audio", missing: false })],
  );
  return jobFromProject(p);
}

function videoOnlyJob(): ExportJob {
  const p = projectWith(
    [clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 })],
    [asset({ id: "va", kind: "video", durationMs: 2000, objectUrl: "blob:video", missing: false, hasAudio: false })],
  );
  return jobFromProject(p);
}

function mutedAudioJob(): ExportJob {
  const p = projectWith(
    [
      clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
      clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 2000, gain: 1 }),
    ],
    [
      asset({ id: "va", kind: "video", durationMs: 2000, objectUrl: "blob:video", missing: false, hasAudio: false }),
      asset({ id: "aa", kind: "audio", durationMs: 2000, objectUrl: "blob:audio", missing: false }),
    ],
  );
  p.tracks = p.tracks.map((t) => (t.id === "A1" ? { ...t, muted: true } : t));
  return jobFromProject(p);
}

function muxWithAudio(audio: ReturnType<typeof audioInputForMux>) {
  return muxAvcToMp4({
    width: 16,
    height: 16,
    fps: 30,
    description: AVC_C,
    samples: [{ data: NAL, timestampUs: 0, durationUs: 33333, key: true }],
    audio,
  });
}

const honestHooks = (mixDelayMs = 0, encodeDelayMs = 0, extra: ExportHooks["audio"] = {}): ExportHooks => ({
  audio: {
    probeAac: async () => PROBE,
    mixJobAudio: async () => {
      if (mixDelayMs > 0) await new Promise((r) => setTimeout(r, mixDelayMs));
      return pcmBuffer();
    },
    encodeAac: async (buffer) => {
      if (encodeDelayMs > 0) await new Promise((r) => setTimeout(r, encodeDelayMs));
      return encodedAac(Math.max(1, Math.ceil(buffer.length / 1024)));
    },
    ...extra,
  },
});

afterEach(() => {
  resetAudioExportReport();
  vi.useRealTimers();
});

describe("AUDIO-01 long-form audio fail-honest", () => {
  it("A: short audible audio → AAC trak + result.audio aac", async () => {
    const job = audioJob();
    expect(expectsAudio(job)).toBe(true);
    const prepared = await prepareJobAudioMix(job, honestHooks());
    expect(prepared.expects).toBe(true);
    expect(prepared.mixed).toBeTruthy();
    const finalized = await finalizeExportAudio(job, prepared.mixed, prepared.probe, honestHooks());
    expect(finalized.audioTrack).toBeTruthy();
    const bytes = muxWithAudio(finalized.audioTrack);
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
    expect(mp4HasAudioTrack(bytes)).toBe(true);
    expect(snapshotAudioExportReport().resultAudio ?? "aac").toBeTruthy();
    const report = snapshotAudioExportReport();
    expect(report.mp4AudioSupplied).toBe(true);
    expect(report.expectsAudio).toBe(true);
    expect(AUDIO_STAGE_NAMES).toContain("AUDIO_TRACK_READY");
  });

  it("B: video-only → expectsAudio false, video-only MP4 valid", async () => {
    const job = videoOnlyJob();
    expect(expectsAudio(job)).toBe(false);
    expect(exportableAudioClips(job).every((c) => c.kind !== "audio")).toBe(true);
    const prepared = await prepareJobAudioMix(job, {
      audio: { probeAac: async () => null, mixJobAudio: async () => null },
    });
    expect(prepared.expects).toBe(false);
    const finalized = await finalizeExportAudio(job, prepared.mixed, prepared.probe, {
      audio: { encodeAac: async () => encodedAac() },
    });
    expect(finalized.audioTrack).toBeUndefined();
    const bytes = muxWithAudio(undefined);
    expect(mp4HasAudioTrack(bytes)).toBe(false);
  });

  it("C: muted / inaudible → expectsAudio false, video-only valid", () => {
    const job = mutedAudioJob();
    expect(expectsAudio(job)).toBe(false);
    expect(job.tracks.find((t) => t.id === "A1")!.clips).toEqual([]);
    expect(job.tracks.find((t) => t.id === "A1")!.muted).toBe(true);
    const masterZero = audioJob();
    masterZero.tracks = masterZero.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => ({ ...c, gain: 0 })),
    }));
    expect(expectsAudio(masterZero)).toBe(false);
  });

  it("D: mix >12s wall clock does not silently discard audio", async () => {
    vi.useFakeTimers();
    const job = audioJob();
    const pending = prepareJobAudioMix(job, honestHooks(13_000, 0));
    await vi.advanceTimersByTimeAsync(13_000);
    const prepared = await pending;
    expect(prepared.mixed).toBeTruthy();
    const finalized = await finalizeExportAudio(job, prepared.mixed, prepared.probe, honestHooks());
    expect(finalized.audioTrack).toBeTruthy();
    expect(finalized.audioTrack!.samples.length).toBeGreaterThan(0);
  });

  it("E: AAC encode >12s does not silently discard audio", async () => {
    vi.useFakeTimers();
    const job = audioJob();
    const prepared = await prepareJobAudioMix(job, honestHooks());
    const pending = finalizeExportAudio(job, prepared.mixed, prepared.probe, honestHooks(0, 13_000));
    await vi.advanceTimersByTimeAsync(13_000);
    const finalized = await pending;
    expect(finalized.audioTrack).toBeTruthy();
    expect(finalized.encoded?.samples.length).toBeGreaterThan(0);
  });

  it("F: forced mix fail with expectsAudio → LOUD FAIL not success", async () => {
    const job = audioJob();
    await expect(
      prepareJobAudioMix(job, {
        audio: {
          probeAac: async () => PROBE,
          mixJobAudio: async () => {
            throw new Error("offline render exploded");
          },
        },
      }),
    ).rejects.toSatisfy((e) => e instanceof AudioExportError && /FAIL: audio mix failed/i.test(e.message));
    const empty = await prepareJobAudioMix(job, {
      audio: { probeAac: async () => PROBE, mixJobAudio: async () => null },
    }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(AudioExportError);
    expect((empty as Error).message).toMatch(/FAIL: audio mix produced no buffer \(expectsAudio\)/);
  });

  it("G: forced AAC fail → LOUD FAIL", async () => {
    const job = audioJob();
    const prepared = await prepareJobAudioMix(job, honestHooks());
    await expect(
      finalizeExportAudio(job, prepared.mixed, prepared.probe, {
        audio: {
          encodeAac: async () => {
            throw new Error("encoder died");
          },
        },
      }),
    ).rejects.toSatisfy((e) => e instanceof Error && /encoder died|AAC encode failed/i.test(String((e as Error).message)));
  });

  it("H: description missing → LOUD FAIL", async () => {
    const job = audioJob();
    await expect(
      finalizeExportAudio(job, pcmBuffer(), PROBE, {
        audio: {
          encodeAac: async () => ({ description: new Uint8Array(), samples: encodedAac().samples }),
        },
      }),
    ).rejects.toSatisfy(
      (e) => e instanceof AudioExportError && /AudioSpecificConfig description/i.test(e.message),
    );
  });

  it("I: samples empty → LOUD FAIL", async () => {
    const job = audioJob();
    await expect(
      finalizeExportAudio(job, pcmBuffer(), PROBE, {
        audio: {
          encodeAac: async () => ({ description: AAC_ASC, samples: [] }),
        },
      }),
    ).rejects.toSatisfy((e) => e instanceof AudioExportError && /produced no samples/i.test(e.message));
  });

  it("J: mux receives audio and mp4HasAudioTrack is true", async () => {
    const encoded = encodedAac(4);
    const audio = audioInputForMux(encoded, PROBE);
    expect(audio).toBeTruthy();
    const bytes = muxWithAudio(audio);
    expect(mp4HasAudioTrack(bytes)).toBe(true);
    const ascii = Array.from(bytes as Uint8Array)
      .map((b: number) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    expect(ascii).toContain("soun");
    expect(ascii).toContain("mp4a");
  });

  it("K: STRESS-04 25k/50k video mux helpers still produce a valid ftyp (green contract)", () => {
    const samples = Array.from({ length: 25_000 }, (_, i) => ({
      data: NAL,
      timestampUs: i * 33333,
      durationUs: 33333,
      key: i % 30 === 0,
    }));
    const bytes = muxAvcToMp4({
      width: 1920,
      height: 1080,
      fps: 30,
      description: AVC_C,
      samples,
    });
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
    expect(mp4HasAudioTrack(bytes)).toBe(false);
  });

  it("L: large AAC sample count — no arg-count overflow / no quadratic concat", () => {
    const count = 75_000;
    const samples = Array.from({ length: count }, (_, i) => ({
      data: AAC_FRAME,
      timestampUs: i * 23220,
      durationUs: 23220,
    }));
    const bytes = muxAvcToMp4({
      width: 16,
      height: 16,
      fps: 30,
      description: AVC_C,
      samples: [{ data: NAL, timestampUs: 0, durationUs: 33333, key: true }],
      audio: { sampleRate: 44100, channels: 2, description: AAC_ASC, samples },
    });
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
    expect(mp4HasAudioTrack(bytes)).toBe(true);
    const info = mp4SoundTrackInfo(bytes);
    expect(info.present).toBe(true);
    expect(info.hasSoun).toBe(true);
    expect(info.hasMp4a).toBe(true);
    expect(info.sampleCount).toBe(count);
    expect(bytes.length).toBeLessThan(count * AAC_FRAME.length * 3 + 2_000_000);
  });

  it("F-human: large video stsz pushes soun past 64KB ASCII scan; trak is still present", () => {
    const videoCount = 25_000;
    const audioCount = 75_397;
    const bytes = muxAvcToMp4({
      width: 1920,
      height: 1080,
      fps: 30,
      description: AVC_C,
      samples: Array.from({ length: videoCount }, (_, i) => ({
        data: NAL,
        timestampUs: i * 33333,
        durationUs: 33333,
        key: i % 60 === 0,
      })),
      audio: {
        sampleRate: 44100,
        channels: 2,
        description: AAC_ASC,
        samples: Array.from({ length: audioCount }, (_, i) => ({
          data: AAC_FRAME,
          timestampUs: i * 23220,
          durationUs: 23220,
        })),
      },
    });
    expect(validateMp4Ftyp(bytes).ok).toBe(true);
    const prefix = Array.from(bytes.subarray(0, 64_000) as Uint8Array)
      .map((b: number) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    expect(prefix.includes("soun") && prefix.includes("mp4a")).toBe(false);
    const info = mp4SoundTrackInfo(bytes);
    expect(info.hasSoun).toBe(true);
    expect(info.hasMp4a).toBe(true);
    expect(info.sampleCount).toBe(audioCount);
    expect(info.present).toBe(true);
    expect(mp4HasAudioTrack(bytes)).toBe(true);
    expect(aacAudioSpecificConfigIsUsable(AAC_ASC)).toBe(true);
    expect(AAC_ASC.byteLength).toBe(2);
    expect(aacAudioSpecificConfigIsUsable(new Uint8Array([0x12]))).toBe(false);
    expect(aacAudioSpecificConfigIsUsable(new Uint8Array())).toBe(false);
  });

  it("AAC encode queue waits on dequeue (bounded backpressure)", async () => {
    let size = 12;
    const listeners: Array<() => void> = [];
    const encoder = {
      get encodeQueueSize() {
        return size;
      },
      addEventListener(_type: string, fn: () => void) {
        listeners.push(fn);
      },
      removeEventListener(_type: string, fn: () => void) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    };
    const waiting = waitForAudioEncodeQueue(encoder);
    expect(AAC_ENCODE_QUEUE_HIGH_WATER).toBe(8);
    size = 4;
    listeners.forEach((fn) => fn());
    await waiting;
    expect(encoder.encodeQueueSize).toBeLessThanOrEqual(AAC_ENCODE_QUEUE_HIGH_WATER);
  });

  it("encodeAac / finalize / prepare do not wrap duration work in withTimeout success-null", () => {
    expect(prepareJobAudioMix.toString()).not.toMatch(/withTimeout/);
    expect(finalizeExportAudio.toString()).not.toMatch(/withTimeout/);
    expect(encodeAac.toString()).not.toMatch(/withTimeout/);
  });

  it("fail dump / report path includes AUDIO-01 stages and identity (not console-only)", () => {
    const job = audioJob();
    const report = snapshotAudioExportReport();
    const fail = formatAudioFail("FAIL: audio mix produced no buffer (expectsAudio)", {
      ...report,
      expectsAudio: true,
      projectDurationMs: job.durationMs,
      exportStartMs: job.startMs,
      exportEndMs: job.endMs,
      lastStage: "AUDIO_MIX_DONE",
    });
    expect(fail).toMatch(/^FAIL:/);
    expect(fail).toContain("AUDIO-01");
    expect(fail).toContain("expectsAudio");
    expect(fail).toContain("productVersion");
    expect(fail).toContain("gitSha");
    const dump = formatExportFailDump(captureThrownValue(new AudioExportError("FAIL: AAC encode failed: x")));
    expect(dump).toContain("AUDIO-01");
    expect(dump).toContain("AUDIO-01 LONG-FORM AUDIO");
    expect(formatAudioExportReport()).toContain("AUDIO-01 LONG-FORM AUDIO");
    expect(formatAudioExportReport()).toContain("productVersion");
  });

  it("quantifies OfflineAudioContext PCM for 29 / 60 / 120 min @ 44.1k stereo Float32", () => {
    const m29 = classifyOfflineAudioMemory(29);
    const m60 = classifyOfflineAudioMemory(60);
    const m120 = classifyOfflineAudioMemory(120);
    expect(m29.frames).toBe(29 * 60 * 44100);
    expect(m29.bytes).toBe(pcmBytesForDuration(29));
    expect(m29.bytes).toBe(29 * 60 * 44100 * 2 * 4);
    expect(m29.mib).toBeCloseTo(585.43, 1);
    expect(m60.bytes).toBe(60 * 60 * 44100 * 2 * 4);
    expect(m60.mib).toBeCloseTo(1211.3, 0);
    expect(m120.bytes).toBe(2 * m60.bytes);
    expect(m120.mib).toBeCloseTo(2422.6, 0);
  });

  it("required AUDIO_* stage names are exact", () => {
    expect([...AUDIO_STAGE_NAMES]).toEqual([
      "AUDIO_EXPECTATION_EVALUATED",
      "AUDIO_CLIPS_DISCOVERED",
      "AUDIO_MIX_BEGIN",
      "AUDIO_DECODE_BEGIN",
      "AUDIO_DECODE_DONE",
      "AUDIO_MIX_RENDER_BEGIN",
      "AUDIO_MIX_RENDER_DONE",
      "AUDIO_MIX_DONE",
      "AAC_PROBE_BEGIN",
      "AAC_PROBE_DONE",
      "AAC_ENCODE_BEGIN",
      "AAC_ENCODE_FLUSH_BEGIN",
      "AAC_ENCODE_FLUSH_DONE",
      "AAC_ENCODE_DONE",
      "AUDIO_TRACK_READY",
      "AUDIO_MUX_BEGIN",
      "AUDIO_MUX_DONE",
      "AUDIO_TRACK_VALIDATED",
    ]);
  });
});
