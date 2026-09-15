import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession } from "../../src/app/session";
import { addAudioTrack } from "../../src/core/audio-tracks";
import { jobFromProject } from "../../src/core/exporter";
import {
  isTrackAudible,
  mixClipsAt,
  trackIdsOf,
  type Project,
} from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { createEmptyProject, deserializeProject, serializeProject } from "../../src/core/project";
import {
  arrangeRows,
  assignTracksToGroup,
  createTrackGroup,
  ensureTrackGroup,
  groupsOf,
  lastAudioChromeHost,
  renameTrackGroup,
  syncTrackGroups,
} from "../../src/core/track-groups";
import { asset, clip } from "../helpers";

function withStems(project: Project = createEmptyProject()): Project {
  const extra = addAudioTrack(project).project;
  const a3 = extra.tracks.find((t) => t.kind === "audio" && t.id !== "A1" && t.id !== "A2")!.id;
  return {
    ...extra,
    assets: [asset({ id: "aa", kind: "audio", durationMs: 2000 })],
    clips: [
      clip({ id: "c1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 1000 }),
      clip({ id: "c2", assetId: "aa", trackId: "A2", startMs: 0, durationMs: 1000 }),
      clip({ id: "c3", assetId: "aa", trackId: a3, startMs: 0, durationMs: 1000 }),
    ],
    inPointMs: 0,
    outPointMs: 2000,
  };
}

function mixSemantics(project: Project) {
  const job = jobFromProject(project);
  return {
    trackIds: trackIdsOf(project),
    muteSoloVolPan: project.tracks.map((t) => ({
      id: t.id,
      muted: t.muted,
      solo: t.solo,
      volume: t.volume,
      pan: t.pan,
    })),
    audible: trackIdsOf(project).map((id) => [id, isTrackAudible(project, id)]),
    mixAt100: mixClipsAt(project, 100).map((c) => c.id),
    job: job.tracks.map((t) => ({
      id: t.id,
      pan: t.pan,
      clipGains: t.clips.map((c) => c.gain),
      clipIds: t.clips.map((c) => c.id),
    })),
    master: project.masterVolume,
  };
}

describe("track / chapter groups", () => {
  it("creates a named group, assigns audio only, and persists membership + display name", () => {
    const start = withStems();
    const created = createTrackGroup(start, {
      name: "Chapter IV — New Reality",
      trackIds: ["A1", "A2", "V1"],
    });
    expect(created.error).toBeUndefined();
    expect(created.group?.name).toBe("Chapter IV — New Reality");
    const grouped = created.project;
    expect(grouped.tracks.find((t) => t.id === "A1")?.groupId).toBe(created.group!.id);
    expect(grouped.tracks.find((t) => t.id === "A2")?.groupId).toBe(created.group!.id);
    expect(grouped.tracks.find((t) => t.id === "V1")?.groupId).toBeUndefined();
    expect(groupsOf(grouped).map((g) => g.name)).toEqual(["Chapter IV — New Reality"]);

    const loaded = deserializeProject(serializeProject(grouped));
    expect(loaded.schemaVersion).toBe(5);
    expect(loaded.groups?.map((g) => ({ id: g.id, name: g.name }))).toEqual([
      { id: created.group!.id, name: "Chapter IV — New Reality" },
    ]);
    expect(loaded.tracks.find((t) => t.id === "A1")?.groupId).toBe(created.group!.id);
    expect(loaded.tracks.find((t) => t.id === "A2")?.groupId).toBe(created.group!.id);
  });

  it("hydrates groups from a legacy stem groupId when Project.groups is missing", () => {
    const start = withStems();
    start.tracks = start.tracks.map((t) =>
      t.id === "A1" || t.id === "A2" ? { ...t, groupId: "01" } : t,
    );
    const raw = JSON.parse(serializeProject(start)) as { groups?: unknown; tracks: Array<Record<string, unknown>> };
    delete raw.groups;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(groupsOf(loaded).some((g) => g.id === "01" && g.name === "01")).toBe(true);
    expect(loaded.tracks.find((t) => t.id === "A1")?.groupId).toBe("01");
    expect(syncTrackGroups(start).groups?.map((g) => g.id)).toContain("01");
  });

  it("maps ensureTrackGroup + assign from an existing stem prefix without breaking it", () => {
    let project = withStems();
    project = ensureTrackGroup(project, "01", "01");
    project = assignTracksToGroup(project, ["A1", "A2"], "01");
    expect(project.tracks.find((t) => t.id === "A1")?.groupId).toBe("01");
    expect(groupsOf(project).find((g) => g.id === "01")?.name).toBe("01");
    const renamed = renameTrackGroup(project, "01", "Chapter IV — New Reality");
    expect(groupsOf(renamed).find((g) => g.id === "01")?.name).toBe("Chapter IV — New Reality");
    expect(renamed.tracks.find((t) => t.id === "A1")?.groupId).toBe("01");
  });

  it("collapse / expand is UI state only — mix and export semantics stay identical", () => {
    const start = withStems();
    start.tracks = start.tracks.map((t) => (t.id === "A2" ? { ...t, muted: true, volume: 0.5, pan: -0.25 } : t));
    const grouped = createTrackGroup(start, { name: "Chapter IV — New Reality", trackIds: ["A1", "A2"] }).project;
    const before = mixSemantics(grouped);
    const expanded = arrangeRows(grouped, { collapsedGroupIds: [] });
    const collapsed = arrangeRows(grouped, { collapsedGroupIds: [groupsOf(grouped)[0]!.id] });
    expect(expanded.some((row) => row.kind === "track" && row.trackId === "A1")).toBe(true);
    expect(collapsed.some((row) => row.kind === "track" && row.trackId === "A1")).toBe(false);
    expect(collapsed.some((row) => row.kind === "group" && row.collapsed)).toBe(true);
    expect(mixSemantics(grouped)).toEqual(before);
    expect(grouped.tracks.find((t) => t.id === "A2")?.muted).toBe(true);
    expect(grouped.tracks.find((t) => t.id === "A2")?.volume).toBe(0.5);
    expect(isTrackAudible(grouped, "A2")).toBe(false);
    expect(isTrackAudible(grouped, "A1")).toBe(true);
  });

  it("grouping itself does not change mute / volume / routing / export gains", () => {
    const start = withStems();
    const before = mixSemantics(start);
    const grouped = assignTracksToGroup(start, ["A1", "A2"], "ch-04");
    expect(mixSemantics(grouped)).toEqual(before);
    const ungrouped = assignTracksToGroup(grouped, ["A1", "A2"], null);
    expect(ungrouped.tracks.find((t) => t.id === "A1")?.groupId).toBeUndefined();
    expect(groupsOf(ungrouped)).toEqual([]);
    expect(mixSemantics(ungrouped)).toEqual(before);
  });

  it("keeps +/− chrome on the last audio lane, or on the collapsed last group", () => {
    const start = withStems();
    const a3 = start.tracks.find((t) => t.kind === "audio" && t.id !== "A1" && t.id !== "A2")!.id;
    const grouped = createTrackGroup(start, { name: "Chapter IV", trackIds: [a3] }).project;
    const gid = groupsOf(grouped)[0]!.id;
    const open = arrangeRows(grouped);
    expect(lastAudioChromeHost(grouped, open)).toEqual({ kind: "track", trackId: a3 });
    const shut = arrangeRows(grouped, { collapsedGroupIds: [gid] });
    expect(shut.some((row) => row.kind === "track" && row.trackId === a3)).toBe(false);
    expect(lastAudioChromeHost(grouped, shut)).toEqual({ kind: "group", groupId: gid });
  });

  it("create / assign / rename commands are undoable", () => {
    let session = createSession(createMemoryBlobStore());
    session = applyCommand(session, { type: "createTrackGroup", name: "Chapter IV — New Reality", trackIds: ["A1", "A2"] });
    const gid = groupsOf(session.project)[0]!.id;
    expect(session.project.tracks.find((t) => t.id === "A1")?.groupId).toBe(gid);
    session = applyCommand(session, { type: "renameTrackGroup", groupId: gid, name: "New Reality" });
    expect(groupsOf(session.project)[0]?.name).toBe("New Reality");
    session = applyCommand(session, { type: "assignTracksToGroup", trackIds: ["A1"], groupId: null });
    expect(session.project.tracks.find((t) => t.id === "A1")?.groupId).toBeUndefined();
    session = applyCommand(session, { type: "undo" });
    expect(session.project.tracks.find((t) => t.id === "A1")?.groupId).toBe(gid);
    session = applyCommand(session, { type: "undo" });
    expect(groupsOf(session.project)[0]?.name).toBe("Chapter IV — New Reality");
  });
});
