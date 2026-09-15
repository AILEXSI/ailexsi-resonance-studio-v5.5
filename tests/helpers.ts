import { createEmptyProject } from "../src/core/project";
import type { Clip, MediaAsset, Project } from "../src/core/models";

export function asset(partial: Partial<MediaAsset> & Pick<MediaAsset, "id" | "kind">): MediaAsset {
  return {
    name: partial.name ?? partial.id,
    mimeType:
      partial.mimeType ??
      (partial.kind === "video" ? "video/mp4" : partial.kind === "image" ? "image/png" : "audio/wav"),
    durationMs: partial.durationMs ?? 2000,
    blobId: partial.blobId ?? partial.id,
    objectUrl: partial.objectUrl,
    missing: partial.missing ?? false,
    width: partial.width,
    height: partial.height,
    ...partial,
  };
}

export function clip(partial: Partial<Clip> & Pick<Clip, "id" | "assetId" | "trackId">): Clip {
  const durationMs = partial.durationMs ?? 1000;
  return {
    startMs: partial.startMs ?? 0,
    durationMs,
    sourceInMs: partial.sourceInMs ?? 0,
    sourceOutMs: partial.sourceOutMs ?? durationMs,
    gain: partial.gain ?? 1,
    fadeInMs: partial.fadeInMs ?? 0,
    fadeOutMs: partial.fadeOutMs ?? 0,
    rate: partial.rate ?? 1,
    ...partial,
  };
}

export function projectWith(clips: Clip[], assets: MediaAsset[] = []): Project {
  const project = createEmptyProject("Test");
  return { ...project, clips, assets };
}
