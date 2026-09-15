import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import {
  applyCommitVolumeWrite,
  applyMixerVolume,
  applyToggleVolumeWriteArm,
  applyVolumeWriteSample,
  createSession,
} from "../../src/app/session";
import { editorFormFocus, editorTextEditFocus, isTextEditFocus } from "../../src/app/screens";
import { audioTracksOf } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { previewAudioGraphKey, previewMediaBindKey } from "../../src/ui/preview/Preview";
import {
  liveWriteAutomationValue,
  WRITE_CAPTURE_MIN_MS,
} from "../../src/core/volume-write";
import { volumeAutomationOf } from "../../src/core/volume-automation";
import { addAudioTrack } from "../../src/core/audio-tracks";
import { createTrackGroup } from "../../src/core/track-groups";
import { asset, clip } from "../helpers";

function armedPlaying(trackId = "A1") {
  let session = createSession(createMemoryBlobStore());
  session = applyToggleVolumeWriteArm(session, trackId);
  session = applyCommand(session, { type: "play" });
  return session;
}

describe("H write buffering / Space (runtime)", () => {
  it("first armed fader move does not clone project, history, or media-bind identity", () => {
    let session = armedPlaying();
    const project = session.project;
    const tracks = session.project.tracks;
    const past = session.history.past.length;
    const future = session.history.future.length;
    const envelope = volumeAutomationOf(tracks.find((t) => t.id === "A1"));
    const bindBefore = previewMediaBindKey({
      playheadMs: session.project.playheadMs,
      playing: session.playing,
      audioGraphKey: previewAudioGraphKey(session.project),
      masterVolume: session.project.masterVolume ?? 1,
    });
    session = applyMixerVolume(session, "A1", 0.4);
    expect(session.volumeWriteGesture).not.toBeNull();
    expect(session.volumeWriteGesture?.liveValue).toBeCloseTo(0.4, 5);
    expect(session.project).toBe(project);
    expect(session.project.tracks).toBe(tracks);
    expect(session.history.past.length).toBe(past);
    expect(session.history.future.length).toBe(future);
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual(envelope.points);
    const bindAfter = previewMediaBindKey({
      playheadMs: session.project.playheadMs,
      playing: session.playing,
      audioGraphKey: previewAudioGraphKey(session.project),
      masterVolume: session.project.masterVolume ?? 1,
    });
    expect(bindAfter).toBe(bindBefore);
    expect(bindAfter).not.toContain("0.4");
  });

  it("1 write still works: commit punches G after the gesture", () => {
    let session = armedPlaying();
    session = applyVolumeWriteSample(session, "A1", 200, 0.5, 1000);
    session = applyVolumeWriteSample(session, "A1", 400, 0.2, 1200);
    session = applyCommitVolumeWrite(session);
    const env = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1"));
    expect(env.enabled).toBe(true);
    expect(env.points.length).toBeGreaterThanOrEqual(2);
    expect(env.points.some((p) => p.value <= 0.5 + 1e-9)).toBe(true);
  });

  it("2 raw pointer events do not each create a full project / history commit", () => {
    let session = armedPlaying();
    const tracks = session.project.tracks;
    const envelope = volumeAutomationOf(tracks.find((t) => t.id === "A1"));
    const past = session.history.past.length;
    const graphKey = audioTracksOf(session.project)
      .map((t) => t.id)
      .join("|");
    for (let i = 0; i < 40; i += 1) {
      session = applyVolumeWriteSample(session, "A1", 100 + i * 5, 0.4 - i * 0.002, 2000 + i);
    }
    expect(session.volumeWriteGesture).not.toBeNull();
    expect(session.project.tracks).toBe(tracks);
    expect(session.history.past.length).toBe(past);
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual(envelope.points);
    expect(
      audioTracksOf(session.project)
        .map((t) => t.id)
        .join("|"),
    ).toBe(graphKey);
  });

  it("3 one gesture is one Undo", () => {
    let session = armedPlaying();
    const past = session.history.past.length;
    session = applyVolumeWriteSample(session, "A1", 0, 0.7, 1000);
    session = applyVolumeWriteSample(session, "A1", 120, 0.4, 1120);
    session = applyVolumeWriteSample(session, "A1", 240, 0.2, 1240);
    expect(session.history.past.length).toBe(past);
    session = applyCommitVolumeWrite(session);
    expect(session.history.past.length).toBe(past + 1);
    const written = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.length;
    session = applyCommand(session, { type: "undo" });
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toEqual([]);
    session = applyCommand(session, { type: "redo" });
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points).toHaveLength(written);
  });

  it("4 coalescing reduces stored event count vs raw pointer events", () => {
    let session = armedPlaying();
    const raw = 80;
    for (let i = 0; i < raw; i += 1) {
      session = applyVolumeWriteSample(session, "A1", 10 + i * 2, 0.5, 3000 + i);
    }
    const stored = session.volumeWriteGesture?.samples.length ?? 0;
    expect(stored).toBeGreaterThanOrEqual(1);
    expect(stored).toBeLessThan(raw);
    expect(WRITE_CAPTURE_MIN_MS).toBeGreaterThan(0);
  });

  it("5 playback graph key is not reset each write sample", () => {
    let session = armedPlaying();
    const key = audioTracksOf(session.project)
      .map((t) => t.id)
      .join("|");
    const tracks = session.project.tracks;
    session = applyVolumeWriteSample(session, "A1", 200, 0.3, 1000);
    session = applyVolumeWriteSample(session, "A1", 280, 0.25, 1080);
    expect(session.project.tracks).toBe(tracks);
    expect(
      audioTracksOf(session.project)
        .map((t) => t.id)
        .join("|"),
    ).toBe(key);
    expect(liveWriteAutomationValue("A1", volumeAutomationOf(tracks.find((t) => t.id === "A1")), 200, "A1", 0.25)).toBeCloseTo(0.25, 8);
    expect(liveWriteAutomationValue("A2", volumeAutomationOf(tracks.find((t) => t.id === "A2")), 200, "A1", 0.25)).toBe(1);
  });

  it("6 Space toggles play/pause with normal UI focus", () => {
    let session = createSession(createMemoryBlobStore());
    const play = dispatchEditorKey(session, false, { key: " " });
    expect(play.type).toBe("session");
    if (play.type !== "session") throw new Error("expected session");
    expect(play.preventDefault).toBe(true);
    expect(play.session.playing).toBe(true);
    const pause = dispatchEditorKey(play.session, true, { key: " ", code: "Space" });
    expect(pause.type).toBe("session");
    if (pause.type !== "session") throw new Error("expected session");
    expect(pause.session.playing).toBe(false);
  });

  it("7 Space after mixer fader focus still play/pauses", () => {
    const fader = document.createElement("input");
    fader.type = "range";
    fader.className = "mix-fader";
    document.body.appendChild(fader);
    fader.focus();
    expect(editorFormFocus(fader)).toBe(true);
    expect(isTextEditFocus(fader)).toBe(false);
    expect(editorTextEditFocus(document.body)).toBe(false);
    const start = createSession(createMemoryBlobStore());
    const action = dispatchEditorKey(start, false, {
      key: " ",
      formFocus: true,
      textEditFocus: false,
    });
    expect(action.type).toBe("session");
    if (action.type === "session") expect(action.session.playing).toBe(true);
    fader.blur();
    fader.remove();
  });

  it("8 Space after automation-lane chrome still play/pauses", () => {
    const point = document.createElement("button");
    point.type = "button";
    point.className = "volume-point";
    document.body.appendChild(point);
    point.focus();
    expect(isTextEditFocus(point)).toBe(false);
    const start = createSession(createMemoryBlobStore());
    const action = dispatchEditorKey(start, false, { key: " ", formFocus: false, textEditFocus: false });
    expect(action.type).toBe("session");
    if (action.type === "session") expect(action.session.playing).toBe(true);
    point.blur();
    point.remove();
  });

  it("9 Space while W is armed still play/pauses", () => {
    let session = applyToggleVolumeWriteArm(createSession(createMemoryBlobStore()), "A1");
    expect(session.volumeWriteArmedIds).toEqual(["A1"]);
    const play = dispatchEditorKey(session, false, { key: " " });
    expect(play.type).toBe("session");
    if (play.type !== "session") throw new Error("expected session");
    expect(play.session.playing).toBe(true);
    expect(play.session.volumeWriteArmedIds).toEqual(["A1"]);
    const pause = dispatchEditorKey(play.session, true, { key: " " });
    expect(pause.type).toBe("session");
    if (pause.type !== "session") throw new Error("expected session");
    expect(pause.session.playing).toBe(false);
  });

  it("10 Space does not fire play/pause in a real text input", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    expect(isTextEditFocus(input)).toBe(true);
    expect(editorTextEditFocus(document.body)).toBe(true);
    const start = createSession(createMemoryBlobStore());
    expect(
      dispatchEditorKey(start, false, { key: " ", formFocus: true, textEditFocus: true }).type,
    ).toBe("none");
    input.blur();
    input.remove();
  });

  it("11 STOP / PAUSE end write cleanly and leave the punched curve", () => {
    let session = armedPlaying();
    session = applyVolumeWriteSample(session, "A1", 100, 0.4, 1000);
    session = applyVolumeWriteSample(session, "A1", 300, 0.2, 1200);
    session = applyCommand(session, { type: "pause" });
    expect(session.playing).toBe(false);
    expect(session.volumeWriteGesture).toBeNull();
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.length).toBeGreaterThan(0);

    session = armedPlaying();
    session = applyVolumeWriteSample(session, "A1", 80, 0.5, 1000);
    session = applyCommand(session, { type: "stop" });
    expect(session.playing).toBe(false);
    expect(session.volumeWriteGesture).toBeNull();
    expect(volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1")).points.length).toBeGreaterThan(0);
  });

  it("12 G model is unchanged: enabled + points, no second engine", () => {
    let session = armedPlaying();
    session = applyVolumeWriteSample(session, "A1", 0, 0.6, 1000);
    session = applyVolumeWriteSample(session, "A1", 200, 0.3, 1200);
    session = applyCommitVolumeWrite(session);
    const env = volumeAutomationOf(session.project.tracks.find((t) => t.id === "A1"));
    expect(Object.keys(env).sort()).toEqual(["enabled", "points"]);
    expect(env.points.every((p) => "timeMs" in p && "value" in p)).toBe(true);
  });

  it("13 D / E / F still compose with buffered write", () => {
    let session = createSession(createMemoryBlobStore());
    session.project = {
      ...session.project,
      assets: [asset({ id: "aa", kind: "audio", durationMs: 2000 })],
      clips: [clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 })],
    };
    session = applyCommand(session, { type: "addAudioTrack" });
    const added = addAudioTrack(session.project);
    expect(added.track).toBeTruthy();
    const grouped = createTrackGroup(session.project, { name: "Ch", trackIds: ["A1"] });
    expect(grouped.group).toBeTruthy();
    session = applyMixerVolume(session, "A1", 0.8);
    expect(session.project.tracks.find((t) => t.id === "A1")!.volume).toBeCloseTo(0.8, 5);
  });
});
