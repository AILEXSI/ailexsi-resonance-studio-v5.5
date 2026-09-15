import { describe, expect, it } from "vitest";
import { audioClipsForMix, jobFromProject } from "../../src/core/exporter/job";
import {
  encodeWavPcm,
  exportMixWav,
  readWavPcm,
  wavFileName,
  WAV_MIX_LAYOUT,
} from "../../src/core/exporter/wav";
import { emptyProjectFileMemory, wavExportPickerOptions } from "../../src/core/project-file";
import { asset, clip, projectWith } from "../helpers";
import type { ExportJob } from "../../src/core/exporter/types";

function pcmBuffer(channels: Float32Array[], sampleRate = 44100) {
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length,
    getChannelData: (c: number) => channels[c] ?? new Float32Array(length),
  };
}

function audioProject() {
  return projectWith(
    [
      clip({
        id: "a1c",
        assetId: "a1",
        trackId: "A1",
        startMs: 0,
        durationMs: 1000,
        fadeInMs: 40,
        fadeOutMs: 40,
        gain: 0.8,
      }),
      clip({
        id: "off",
        assetId: "a1",
        trackId: "A1",
        startMs: 2000,
        durationMs: 500,
        enabled: false,
      }),
    ],
    [asset({ id: "a1", kind: "audio", durationMs: 4000, objectUrl: "blob:mix", missing: false })],
  );
}

function emptyJob(partial: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "empty",
    projectId: "p",
    projectName: "empty",
    startMs: 0,
    endMs: 0,
    durationMs: 0,
    width: 16,
    height: 16,
    fps: 30,
    fileName: "empty.mp4",
    tracks: [],
    visualizer: { enabled: false, muted: false, sceneId: "spectrum-bars" },
    ...partial,
  };
}

describe("WAV encode from mix PCM (P58)", () => {
  it("writes PCM16 WAV whose samples match the mix buffer", () => {
    const left = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const right = Float32Array.from([0.25, 0, -0.25, 0.75, -0.75]);
    const bytes = encodeWavPcm(pcmBuffer([left, right], 44100));
    const wav = readWavPcm(bytes);
    expect(wav.sampleRate).toBe(44100);
    expect(wav.channels).toBe(2);
    expect(wav.frames).toBe(5);
    expect(Array.from(wav.samples)).toEqual([
      0, 8192,
      16384, 0,
      -16384, -8192,
      32767, 24575,
      -32768, -24576,
    ]);
  });

  it("job mix rules (mute/solo/enabled/fades) are the same for WAV as for AAC", () => {
    const p = audioProject();
    const mp4 = jobFromProject(p);
    const wav = { ...mp4, fileName: wavFileName(mp4.fileName) };
    expect(wav.fileName).toBe("Test.wav");
    const mix = audioClipsForMix(wav);
    expect(mix.map((c) => c.id)).toEqual(["a1c"]);
    expect(mix[0]?.fadeInMs).toBe(40);
    expect(mix[0]?.fadeOutMs).toBe(40);
    expect(mix[0]?.gain).toBeCloseTo(0.8, 5);
    expect(mix.map((c) => c.id)).toEqual(audioClipsForMix(mp4).map((c) => c.id));
  });

  it("exportMixWav writes the mix PCM and fails when the mix is empty", async () => {
    const left = Float32Array.from([0.5, -0.5]);
    const right = Float32Array.from([0.25, -0.25]);
    const mixed = pcmBuffer([left, right], WAV_MIX_LAYOUT.sampleRate) as AudioBuffer;
    const job = jobFromProject(audioProject());
    const ok = await exportMixWav({ ...job, fileName: wavFileName(job.fileName) }, {}, async () => mixed);
    expect(ok.success).toBe(true);
    expect(ok.audio).toBe("wav");
    expect(ok.mimeType).toBe("audio/wav");
    expect(ok.fileName).toBe("Test.wav");
    expect(ok.blob).toBeTruthy();
    expect(ok.blob!.type).toBe("audio/wav");
    const expected = encodeWavPcm(mixed);
    expect(ok.fileSizeBytes).toBe(expected.byteLength);
    expect(ok.fileSizeBytes).toBe(44 + 2 * 2 * 2);

    const empty = await exportMixWav(emptyJob({ durationMs: 1000, fileName: "cut.mp4" }));
    expect(empty.success).toBe(false);
    expect(empty.error).toMatch(/no audible mix/i);
    expect(empty.blob).toBeFalsy();
    expect(empty.fileName).toBe("cut.wav");
  });

  it("WAV picker is audio/wav only", () => {
    const opts = wavExportPickerOptions("Show.wav", emptyProjectFileMemory());
    expect(opts.suggestedName).toBe("Show.wav");
    expect(opts.types).toEqual([{ description: "WAV audio", accept: { "audio/wav": [".wav"] } }]);
    expect(JSON.stringify(opts.types)).not.toMatch(/mp4|json/i);
  });
});
