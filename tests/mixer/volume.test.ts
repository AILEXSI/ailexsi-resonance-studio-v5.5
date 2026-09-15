import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { applyMasterVolume, applyToggleSolo, applyTrackVolume, createSession } from "../../src/app/session";
import { jobFromProject } from "../../src/core/exporter/job";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import {
  dbToLinear,
  equalPowerPan,
  formatDb,
  formatPan,
  linearToDb,
  mixLinearGain,
  peakToDb,
} from "../../src/core/volume";
import { asset, clip, projectWith } from "../helpers";

describe("mixer volume curve", () => {
  it("0 dB is unity; -6 dB is ~0.5 linear (10^(dB/20)); bottom is silence", () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 8);
    expect(linearToDb(1)).toBeCloseTo(0, 8);
    // 20 * log10(0.5) = -6.0205999…
    expect(dbToLinear(-6)).toBeCloseTo(0.501187, 4);
    expect(linearToDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(dbToLinear(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(linearToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe("-∞ dB");
  });

  it("meter helper maps peak to dB", () => {
    expect(peakToDb(1)).toBeCloseTo(0, 8);
    expect(peakToDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(peakToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("mute zeros the mix even if faders are up", () => {
    expect(mixLinearGain(1, 1, 1, true)).toBe(0);
    expect(mixLinearGain(1, 1, 1, false)).toBeCloseTo(1, 8);
    expect(mixLinearGain(1, 1, 1, false, 0.5)).toBeCloseTo(0.5, 8);
    expect(mixLinearGain(1, 1, 1, false, 1)).toBeCloseTo(1, 8);
  });
});

describe("session + project volume persist", () => {
  it("round-trips track and master volume in .resonance.json", () => {
    let session = createSession(createMemoryBlobStore());
    session.project = projectWith(
      [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "a", kind: "audio", durationMs: 1000 })],
    );
    session = applyTrackVolume(session, "A1", dbToLinear(-6));
    session = applyMasterVolume(session, dbToLinear(0));
    const a1 = session.project.tracks.find((t) => t.id === "A1");
    expect(a1?.volume).toBeCloseTo(dbToLinear(-6), 5);
    expect(session.project.masterVolume).toBeCloseTo(1, 8);

    const loaded = deserializeProject(serializeProject(session.project));
    expect(loaded.tracks.find((t) => t.id === "A1")?.volume).toBeCloseTo(dbToLinear(-6), 5);
    expect(loaded.masterVolume).toBeCloseTo(1, 8);
    expect(loaded.tracks.find((t) => t.id === "V1")?.volume).toBe(1);
  });

  it("round-trips track solo; legacy JSON missing solo defaults to false", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyToggleSolo(session, "A1");
    expect(session.project.tracks.find((t) => t.id === "A1")?.solo).toBe(true);
    const loaded = deserializeProject(serializeProject(session.project));
    expect(loaded.tracks.find((t) => t.id === "A1")?.solo).toBe(true);
    expect(loaded.tracks.find((t) => t.id === "A2")?.solo).toBe(false);

    const raw = JSON.parse(serializeProject(session.project)) as {
      tracks: Array<{ solo?: boolean }>;
    };
    for (const t of raw.tracks) delete t.solo;
    const legacy = deserializeProject(JSON.stringify(raw));
    expect(legacy.tracks.every((t) => t.solo === false)).toBe(true);
  });

  it("legacy JSON without volume defaults to unity", () => {
    const session = createSession(createMemoryBlobStore());
    const raw = JSON.parse(serializeProject(session.project)) as {
      tracks: Array<{ volume?: number }>;
      masterVolume?: number;
    };
    for (const t of raw.tracks) delete t.volume;
    delete raw.masterVolume;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.tracks.every((t) => t.volume === 1)).toBe(true);
    expect(loaded.masterVolume).toBe(1);
  });

  it("legacy JSON without pan defaults to center; setTrackPan persists", () => {
    const session = createSession(createMemoryBlobStore());
    expect(session.project.tracks.every((t) => t.pan === 0)).toBe(true);
    const raw = JSON.parse(serializeProject(session.project)) as {
      tracks: Array<{ pan?: number }>;
    };
    for (const t of raw.tracks) delete t.pan;
    const legacy = deserializeProject(JSON.stringify(raw));
    expect(legacy.tracks.every((t) => t.pan === 0)).toBe(true);

    const panned = applyCommand(session, { type: "setTrackPan", trackId: "A1", pan: -1 });
    expect(panned.project.tracks.find((t) => t.id === "A1")!.pan).toBe(-1);
    expect(panned.project.tracks.find((t) => t.id === "A2")!.pan).toBe(0);
    const loaded = deserializeProject(serializeProject(panned.project));
    expect(loaded.tracks.find((t) => t.id === "A1")!.pan).toBe(-1);
  });
});

describe("equal-power pan", () => {
  it("hard L / center / hard R", () => {
    const left = equalPowerPan(-1);
    expect(left.left).toBeCloseTo(1, 8);
    expect(left.right).toBeCloseTo(0, 8);
    const center = equalPowerPan(0);
    expect(center.left).toBeCloseTo(Math.SQRT1_2, 8);
    expect(center.right).toBeCloseTo(Math.SQRT1_2, 8);
    const right = equalPowerPan(1);
    expect(right.left).toBeCloseTo(0, 8);
    expect(right.right).toBeCloseTo(1, 8);
    expect(formatPan(0)).toBe("C");
    expect(formatPan(-1)).toBe("L100");
    expect(formatPan(1)).toBe("R100");
  });

  it("jobFromProject copies track pan onto export tracks", () => {
    let session = createSession(createMemoryBlobStore());
    session.project = projectWith(
      [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 })],
      [asset({ id: "a", kind: "audio", durationMs: 1000, objectUrl: "blob:t", missing: false })],
    );
    session = applyCommand(session, { type: "setTrackPan", trackId: "A1", pan: 0.5 });
    const job = jobFromProject(session.project);
    expect(job.tracks.find((t) => t.id === "A1")!.pan).toBeCloseTo(0.5, 8);
    expect(job.tracks.find((t) => t.id === "V1")!.pan).toBe(0);
  });
});
