/**
 * Exe save/open via plugin-dialog + plugin-fs. Chrome FSA stays in project-file.ts.
 */

import {
  LAST_PROJECT_FILENAME,
  dirFromPath,
  fileNameFromPath,
  joinDirAndFile,
  lastProjectMissingStatus,
  lastProjectPayload,
  parseLastProjectText,
  type LastProjectRef,
} from "./last-project";
import { nextVersionedFileName } from "./exporter/filename-version";

export interface TauriProjectFs {
  openDialog(opts: { defaultPath?: string }): Promise<string | null>;
  saveDialog(opts: { defaultPath?: string }): Promise<string | null>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readAppDataText(name: string): Promise<string>;
  writeAppDataText(name: string, text: string): Promise<void>;
  appDataExists(name: string): Promise<boolean>;
}

export type TauriAutostart =
  | { kind: "loaded"; text: string; ref: LastProjectRef }
  | { kind: "missing"; status: string; ref: LastProjectRef }
  | { kind: "none" };

export async function writeLastProject(fs: TauriProjectFs, path: string, name?: string): Promise<LastProjectRef> {
  const ref = lastProjectPayload({
    path,
    name: name?.trim() || fileNameFromPath(path),
  });
  await fs.writeAppDataText(LAST_PROJECT_FILENAME, JSON.stringify(ref));
  return ref;
}

export async function readLastProject(fs: TauriProjectFs): Promise<LastProjectRef | null> {
  try {
    if (!(await fs.appDataExists(LAST_PROJECT_FILENAME))) return null;
    return parseLastProjectText(await fs.readAppDataText(LAST_PROJECT_FILENAME));
  } catch {
    return null;
  }
}

/** Autostart: load last path or report missing. Never throws. Does not write. */
export async function autostartLastProject(fs: TauriProjectFs): Promise<TauriAutostart> {
  const ref = await readLastProject(fs);
  if (!ref) return { kind: "none" };
  try {
    if (!(await fs.exists(ref.path))) {
      return { kind: "missing", status: lastProjectMissingStatus(ref.name), ref };
    }
    const text = await fs.readText(ref.path);
    return { kind: "loaded", text, ref };
  } catch {
    return { kind: "missing", status: lastProjectMissingStatus(ref.name), ref };
  }
}

export function versionedSaveDefaultPath(opts: {
  filename: string;
  lastPath?: string | null;
  extraNames?: readonly string[];
}): string {
  const lastName = opts.lastPath ? fileNameFromPath(opts.lastPath) : "";
  const existing = [lastName, ...(opts.extraNames ?? [])].filter(Boolean);
  const next = nextVersionedFileName(opts.filename, existing);
  const dir = opts.lastPath ? dirFromPath(opts.lastPath) : "";
  return dir ? joinDirAndFile(dir, next) : next;
}

export async function tauriSaveProject(
  fs: TauriProjectFs,
  opts: { json: string; filename: string; lastPath?: string | null; forcePicker?: boolean },
): Promise<{ cancelled: true } | { path: string; name: string; status: string }> {
  let path = opts.forcePicker ? null : opts.lastPath ?? null;
  if (!path) {
    const defaultPath = versionedSaveDefaultPath({
      filename: opts.filename,
      lastPath: opts.lastPath,
    });
    path = await fs.saveDialog({ defaultPath });
  }
  if (!path) return { cancelled: true };
  await fs.writeText(path, opts.json);
  const ref = await writeLastProject(fs, path, fileNameFromPath(path));
  return { path: ref.path, name: ref.name, status: `Gespeichert: ${ref.name}` };
}

export async function tauriOpenProject(
  fs: TauriProjectFs,
): Promise<{ cancelled: true } | { text: string; path: string; name: string; status: string }> {
  const path = await fs.openDialog({});
  if (!path) return { cancelled: true };
  const text = await fs.readText(path);
  const ref = await writeLastProject(fs, path, fileNameFromPath(path));
  return { text, path: ref.path, name: ref.name, status: `Geladen: ${ref.name}` };
}

export async function createPluginTauriProjectFs(): Promise<TauriProjectFs> {
  const dialog = await import("@tauri-apps/plugin-dialog");
  const fs = await import("@tauri-apps/plugin-fs");
  const filters = [{ name: "Resonance project", extensions: ["json"] }];
  return {
    async openDialog() {
      const picked = await dialog.open({ multiple: false, directory: false, filters });
      return typeof picked === "string" ? picked : null;
    },
    async saveDialog(opts) {
      const picked = await dialog.save({ defaultPath: opts.defaultPath, filters });
      return typeof picked === "string" ? picked : null;
    },
    readText: (path) => fs.readTextFile(path),
    writeText: (path, text) => fs.writeTextFile(path, text),
    exists: async (path) => Boolean(await fs.exists(path)),
    readAppDataText: (name) => fs.readTextFile(name, { baseDir: fs.BaseDirectory.AppData }),
    writeAppDataText: async (name, text) => {
      try {
        await fs.mkdir(".", { baseDir: fs.BaseDirectory.AppData, recursive: true });
      } catch {
        /* already exists */
      }
      await fs.writeTextFile(name, text, { baseDir: fs.BaseDirectory.AppData });
    },
    appDataExists: async (name) => Boolean(await fs.exists(name, { baseDir: fs.BaseDirectory.AppData })),
  };
}

export async function tryReadSourcePathBlob(path: string): Promise<Blob | null> {
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    const bytes = await fs.readFile(path);
    return new Blob([bytes]);
  } catch {
    return null;
  }
}

const MEDIA_EXTENSIONS = [
  "mp4",
  "mov",
  "webm",
  "mkv",
  "m4v",
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "zip",
];

export function mediaExtensionsForKind(kind?: "video" | "audio" | "image"): string[] {
  if (kind === "video") return ["mp4", "mov", "webm", "mkv", "m4v"];
  if (kind === "audio") return ["wav", "mp3", "m4a", "aac", "flac", "ogg"];
  if (kind === "image") return ["png", "jpg", "jpeg", "webp", "gif"];
  return MEDIA_EXTENSIONS;
}

function fileWithDiskPath(bytes: Uint8Array, path: string): File {
  const name = fileNameFromPath(path) || "media";
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], name);
  Object.defineProperty(file, "path", { value: path, configurable: true });
  return file;
}

/** Dialog pick in the exe. Attaches the real disk path onto each File. */
export async function pickTauriMediaFiles(opts: {
  multiple?: boolean;
  kind?: "video" | "audio" | "image";
} = {}): Promise<File[] | null> {
  const dialog = await import("@tauri-apps/plugin-dialog");
  const fs = await import("@tauri-apps/plugin-fs");
  const picked = await dialog.open({
    multiple: opts.multiple === true,
    directory: false,
    filters: [{ name: "Media", extensions: mediaExtensionsForKind(opts.kind) }],
  });
  if (!picked) return null;
  const paths = (Array.isArray(picked) ? picked : [picked]).filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  const files: File[] = [];
  for (const path of paths) {
    const bytes = await fs.readFile(path);
    files.push(fileWithDiskPath(bytes, path));
  }
  return files;
}

export function sourcePathsOfAssets(assets: ReadonlyArray<{ sourcePath?: string }>): string[] {
  return assets
    .map((a) => (typeof a.sourcePath === "string" ? a.sourcePath.trim() : ""))
    .filter(Boolean);
}

/** Grant plugin-fs access to remembered media paths. Not C:\\ wholesale. */
export async function allowMediaSourcePaths(paths: readonly string[]): Promise<void> {
  const clean = [...new Set(paths.filter((p) => typeof p === "string" && p.trim().length > 0))];
  if (clean.length === 0) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("allow_media_paths", { paths: clean });
  } catch {
    /* hydrate may mark missing + Relink */
  }
}
