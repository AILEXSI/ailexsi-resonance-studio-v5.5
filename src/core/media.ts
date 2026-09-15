import { createId } from "./ids";
import type { MediaAsset, MediaKind, TrackId } from "./models";
import { isPictureKind, kindOfTrack } from "./models";
import { DEFAULT_IMAGE_DURATION_MS } from "./still";

export class ImportError extends Error {
  readonly code: "WRONG_TYPE" | "PROBE_FAILED" | "EMPTY";
  constructor(code: ImportError["code"], message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

export interface MediaProbe {
  durationMs: number;
  width?: number;
  height?: number;
  /** Video file also has a decodable audio track. */
  hasAudio?: boolean;
}

export type ProbeFn = (file: File) => Promise<MediaProbe>;

const VIDEO_MIME = /^video\//i;
const AUDIO_MIME = /^audio\//i;
const IMAGE_MIME = /^image\/(jpeg|jpg|png|webp|gif)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const AUDIO_EXT = /\.(wav|mp3|ogg|m4a|aac|flac)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/i;

/** HTML5 drag payload for a bin asset id. */
export const MEDIA_ASSET_DRAG_TYPE = "application/x-resonance-asset-id";

export const MEDIA_FILE_ACCEPT =
  "audio/*,video/*,image/jpeg,image/png,image/webp,image/gif,image/*,.zip,application/zip";

/** Tauri / WebView2 File.path. Chrome File has no disk path. */
export function diskPathOfFile(file: File): string | undefined {
  const raw = (file as File & { path?: unknown }).path;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function classifyFile(file: File): MediaKind {
  const name = file.name.toLowerCase();
  // Known audio containers win over a lying MIME (application/mp4 / video/mp4 on .m4a).
  if (AUDIO_EXT.test(name)) return "audio";
  if (VIDEO_MIME.test(file.type)) return "video";
  if (AUDIO_MIME.test(file.type)) return "audio";
  if (IMAGE_MIME.test(file.type)) return "image";
  const emptyType = !file.type || file.type === "application/octet-stream";
  if (emptyType && VIDEO_EXT.test(name)) return "video";
  if (emptyType && IMAGE_EXT.test(name)) return "image";
  throw new ImportError(
    "WRONG_TYPE",
    `Rejected ${file.name || "file"}: only audio, video, and images (jpeg/png/webp/gif) are allowed (got ${file.type || "unknown type"})`,
  );
}

function probeImage(file: File): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => {
      URL.revokeObjectURL(url);
    };
    img.onload = () => {
      const width = img.naturalWidth || undefined;
      const height = img.naturalHeight || undefined;
      cleanup();
      resolve({ durationMs: DEFAULT_IMAGE_DURATION_MS, width, height });
    };
    img.onerror = () => {
      cleanup();
      reject(new ImportError("PROBE_FAILED", `Failed to read ${file.name}`));
    };
    img.src = url;
  });
}

export function probeWithElement(file: File): Promise<MediaProbe> {
  const kind = classifyFile(file);
  if (kind === "image") return probeImage(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    const cleanup = () => {
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
    };
    el.onloadedmetadata = () => {
      const durationMs = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
      const width = kind === "video" ? (el as HTMLVideoElement).videoWidth : undefined;
      const height = kind === "video" ? (el as HTMLVideoElement).videoHeight : undefined;
      const hasAudio = kind === "video" ? detectHasAudio(el) : undefined;
      cleanup();
      if (durationMs <= 0) {
        reject(new ImportError("PROBE_FAILED", `Could not read duration of ${file.name}`));
        return;
      }
      resolve({ durationMs, width, height, hasAudio });
    };
    el.onerror = () => {
      cleanup();
      reject(new ImportError("PROBE_FAILED", `Failed to read ${file.name}`));
    };
    el.src = url;
  });
}

/** Placeholder length when probe/decode fails so a clip exists for Relink. */
export const PROBE_FAIL_PLACEHOLDER_MS = DEFAULT_IMAGE_DURATION_MS;

function fallbackMime(kind: MediaKind): string {
  if (kind === "video") return "video/unknown";
  if (kind === "image") return "image/unknown";
  return "audio/unknown";
}

function mimeFromAudioName(name: string): string | undefined {
  const n = name.toLowerCase();
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".aac")) return "audio/aac";
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".ogg")) return "audio/ogg";
  if (n.endsWith(".flac")) return "audio/flac";
  return undefined;
}

function mimeForImportedFile(file: File, kind: MediaKind): string {
  if (kind === "audio" && !AUDIO_MIME.test(file.type)) {
    return mimeFromAudioName(file.name) ?? fallbackMime(kind);
  }
  return file.type || fallbackMime(kind);
}

/** Classified file whose probe failed — missing so Relink can recover. No blob URL. */
export function missingAssetFromImport(file: File): MediaAsset {
  const kind = classifyFile(file);
  const id = createId("asset");
  return {
    id,
    name: file.name,
    kind,
    mimeType: mimeForImportedFile(file, kind),
    durationMs: kind === "image" ? DEFAULT_IMAGE_DURATION_MS : PROBE_FAIL_PLACEHOLDER_MS,
    blobId: id,
    objectUrl: undefined,
    sourcePath: diskPathOfFile(file),
    missing: true,
  };
}

export async function importMediaFile(
  file: File,
  probe: ProbeFn = probeWithElement,
): Promise<MediaAsset> {
  if (!file || file.size <= 0) {
    throw new ImportError("EMPTY", "File is empty");
  }
  const kind = classifyFile(file);
  const meta = await probe(file);
  const durationMs =
    kind === "image" && !(meta.durationMs > 0) ? DEFAULT_IMAGE_DURATION_MS : meta.durationMs;
  const id = createId("asset");
  const objectUrl =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : undefined;
  return {
    id,
    name: file.name,
    kind,
    mimeType: mimeForImportedFile(file, kind),
    durationMs,
    blobId: id,
    objectUrl,
    sourcePath: diskPathOfFile(file),
    missing: false,
    width: meta.width,
    height: meta.height,
    hasAudio: kind === "video" ? meta.hasAudio : undefined,
  };
}

function detectHasAudio(el: HTMLMediaElement): boolean | undefined {
  const media = el as HTMLVideoElement & {
    mozHasAudio?: boolean;
    audioTracks?: { length: number };
  };
  if (media.audioTracks && typeof media.audioTracks.length === "number") {
    return media.audioTracks.length > 0;
  }
  if (typeof media.mozHasAudio === "boolean") return media.mozHasAudio;
  return undefined;
}

export function defaultTrackForKind(kind: MediaKind): "V1" | "A1" {
  return kind === "audio" ? "A1" : "V1";
}

export function assetFitsTrack(kind: MediaKind, trackId: TrackId): boolean {
  return isPictureKind(kind) ? kindOfTrack(trackId) === "video" : kindOfTrack(trackId) === "audio";
}

export function preferredTrackForAsset(kind: MediaKind, target: TrackId): TrackId {
  if (kind === "audio") return kindOfTrack(target) === "audio" ? target : "A1";
  return kindOfTrack(target) === "video" ? target : "V1";
}

export function writeAssetDrag(dt: DataTransfer, assetId: string): void {
  dt.setData(MEDIA_ASSET_DRAG_TYPE, assetId);
  dt.setData("text/plain", assetId);
  dt.effectAllowed = "copy";
}

export function readAssetDrag(dt: DataTransfer): string | null {
  const raw = dt.getData(MEDIA_ASSET_DRAG_TYPE) || dt.getData("text/plain");
  const id = raw.trim();
  return id || null;
}

export function isAssetDrag(dt: DataTransfer): boolean {
  const types = Array.from(dt.types ?? []);
  return types.includes(MEDIA_ASSET_DRAG_TYPE) || types.includes("text/plain");
}

export function resolveMediaDropTrack(
  assetKind: MediaKind,
  overTrackId: TrackId | undefined,
): TrackId | undefined {
  if (!overTrackId) return undefined;
  return assetFitsTrack(assetKind, overTrackId) ? overTrackId : undefined;
}

/** Same place command as bin double-click / import-place, with drop lane + time. */
export function mediaDropPlace(opts: {
  assetId: string;
  assetKind: MediaKind;
  overTrackId?: TrackId;
  startMs: number;
}): { assetId: string; trackId: TrackId; startMs: number } | undefined {
  const trackId = resolveMediaDropTrack(opts.assetKind, opts.overTrackId);
  if (!trackId) return undefined;
  return {
    assetId: opts.assetId,
    trackId,
    startMs: Math.max(0, Math.round(opts.startMs)),
  };
}
