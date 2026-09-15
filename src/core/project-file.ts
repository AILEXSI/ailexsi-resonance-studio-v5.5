import { fileNameFromPath, normalizeLastProjectPath, parentFolderNameFromPath } from "./last-project";
import type { MediaKind } from "./models";
import {
  existingProjectNamesFromMemory,
  nextVersionedFileName,
} from "./exporter/filename-version";

/** Well-known startIn. First run uses documents — never invent a C:\ path. */
export const DEFAULT_START_IN = "documents" as const;

export type WellKnownStartIn = "documents" | "music" | "downloads" | "desktop";

export interface FileHandleLike {
  name: string;
  kind?: "file";
  createWritable?: () => Promise<{
    write: (data: Blob | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
  getFile?: () => Promise<File>;
  getParent?: () => Promise<DirectoryHandleLike>;
  queryPermission?: (opts?: { mode?: "read" | "readwrite" }) => Promise<PermissionState | string>;
  requestPermission?: (opts?: { mode?: "read" | "readwrite" }) => Promise<PermissionState | string>;
  isSameEntry?: (other: FileHandleLike) => Promise<boolean>;
}

export interface DirectoryEntryLike {
  kind?: "file" | "directory" | string;
  name?: string;
}

export interface DirectoryHandleLike {
  kind?: "directory";
  name?: string;
  queryPermission?: (opts?: { mode?: "read" | "readwrite" }) => Promise<PermissionState | string>;
  requestPermission?: (opts?: { mode?: "read" | "readwrite" }) => Promise<PermissionState | string>;
  values?: () => AsyncIterable<DirectoryEntryLike>;
  entries?: () => AsyncIterable<[string, DirectoryEntryLike]>;
  keys?: () => AsyncIterable<string>;
  getFileHandle?: (name: string, opts?: { create?: boolean }) => Promise<FileHandleLike>;
}

export type StartIn = DirectoryHandleLike | FileHandleLike | WellKnownStartIn;

export interface RecentProject {
  fileHandle: FileHandleLike;
  directoryHandle: DirectoryHandleLike | null;
  lastFileName: string;
}

export interface ProjectFileMemory {
  fileHandle: FileHandleLike | null;
  directoryHandle: DirectoryHandleLike | null;
  lastFileName: string | null;
  /** Tauri/exe disk path. Chrome FSA leaves this null. */
  lastPath?: string | null;
  recents: RecentProject[];
  /** Last successful media export filename (not the project .json). */
  lastExportFileName: string | null;
  /** Recent export filenames in the remembered folder (same stem series). */
  lastExportFileNames: string[];
}

export const MAX_RECENT_PROJECTS = 8;
export const MAX_LAST_EXPORT_NAMES = 64;

export interface SavePickerOptions {
  suggestedName: string;
  startIn: StartIn;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}

export interface OpenPickerOptions {
  multiple: boolean;
  startIn: StartIn;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}

export interface DirectoryPickerOptions {
  startIn: StartIn;
  mode?: "read" | "readwrite";
}

export interface PickerHost {
  showSaveFilePicker?: (opts: SavePickerOptions) => Promise<FileHandleLike>;
  showOpenFilePicker?: (opts: OpenPickerOptions) => Promise<FileHandleLike[]>;
  showDirectoryPicker?: (opts: DirectoryPickerOptions) => Promise<DirectoryHandleLike>;
}

export interface ProjectFileStore {
  load(): Promise<ProjectFileMemory>;
  save(memory: ProjectFileMemory): Promise<void>;
}

const PROJECT_TYPES = [
  {
    description: "Resonance project",
    accept: { "application/json": [".resonance.json", ".json"] },
  },
];

/** Chromium showSaveFilePicker rejects ".resonance.json" (second dot). */
const SAVE_PROJECT_TYPES = [
  {
    description: "Resonance project",
    accept: { "application/json": [".json"] },
  },
];

const MP4_TYPES = [
  {
    description: "MP4 video",
    accept: { "video/mp4": [".mp4"] },
  },
];

const WAV_TYPES = [
  {
    description: "WAV audio",
    accept: { "audio/wav": [".wav"] },
  },
];

const RELINK_VIDEO_TYPES = [
  {
    description: "Video",
    accept: { "video/*": [".mp4", ".webm", ".mov", ".mkv", ".m4v"] },
  },
];

const RELINK_AUDIO_TYPES = [
  {
    description: "Audio",
    accept: { "audio/*": [".wav", ".mp3", ".ogg", ".m4a", ".aac", ".flac"] },
  },
];

const RELINK_IMAGE_TYPES = [
  {
    description: "Image",
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".gif"] },
  },
];

export function emptyProjectFileMemory(): ProjectFileMemory {
  return {
    fileHandle: null,
    directoryHandle: null,
    lastFileName: null,
    lastPath: null,
    recents: [],
    lastExportFileName: null,
    lastExportFileNames: [],
  };
}

function normalizeExportFileNames(raw: unknown, lastExportFileName: string | null): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const name = value.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  push(lastExportFileName);
  if (Array.isArray(raw)) {
    for (const row of raw) push(row);
  }
  return names.slice(0, MAX_LAST_EXPORT_NAMES);
}

export function normalizeProjectFileMemory(
  raw: Partial<ProjectFileMemory> | null | undefined,
): ProjectFileMemory {
  if (!raw) return emptyProjectFileMemory();
  const recents = Array.isArray(raw.recents)
    ? raw.recents
        .filter((row): row is RecentProject =>
          Boolean(row && row.fileHandle && typeof row.lastFileName === "string" && row.lastFileName),
        )
        .slice(0, MAX_RECENT_PROJECTS)
    : [];
  const lastPath = typeof raw.lastPath === "string" ? normalizeLastProjectPath(raw.lastPath) : "";
  const lastExportFileName =
    typeof raw.lastExportFileName === "string" && raw.lastExportFileName.trim()
      ? raw.lastExportFileName.trim()
      : null;
  return {
    fileHandle: raw.fileHandle ?? null,
    directoryHandle: raw.directoryHandle ?? null,
    lastFileName: raw.lastFileName ?? null,
    lastPath: lastPath || null,
    recents,
    lastExportFileName,
    lastExportFileNames: normalizeExportFileNames(raw.lastExportFileNames, lastExportFileName),
  };
}

export function withExportFileName(memory: ProjectFileMemory, fileName: string): ProjectFileMemory {
  const prev = normalizeProjectFileMemory(memory);
  const name = fileName.trim();
  if (!name) return prev;
  const rest = prev.lastExportFileNames.filter((row) => row.toLowerCase() !== name.toLowerCase());
  return {
    ...prev,
    lastExportFileName: name,
    lastExportFileNames: [name, ...rest].slice(0, MAX_LAST_EXPORT_NAMES),
  };
}

/** After Tauri Speichern / Speichern unter / Öffnen — no FSA handles. */
export function rememberTauriProjectPath(path: string, name?: string): ProjectFileMemory {
  const lastPath = normalizeLastProjectPath(path);
  const lastFileName = name?.trim() || fileNameFromPath(lastPath) || null;
  return {
    ...emptyProjectFileMemory(),
    lastFileName,
    lastPath: lastPath || null,
  };
}

export function upsertRecent(recents: RecentProject[], entry: RecentProject): RecentProject[] {
  const rest = recents.filter((row) => row.lastFileName !== entry.lastFileName);
  return [entry, ...rest].slice(0, MAX_RECENT_PROJECTS);
}

/** Panel copy only — never invent a drive letter or /Users path. */
export function projectPanelView(memory: Partial<ProjectFileMemory>): {
  fileName: string;
  folderLabel: string;
  folderRemembered: boolean;
} {
  const lastPath = typeof memory.lastPath === "string" ? normalizeLastProjectPath(memory.lastPath) : "";
  const fileName =
    memory.lastFileName ?? memory.fileHandle?.name ?? (lastPath ? fileNameFromPath(lastPath) : null);
  const dirName =
    typeof memory.directoryHandle?.name === "string" && memory.directoryHandle.name.length > 0
      ? memory.directoryHandle.name
      : null;
  const pathFolder = lastPath ? parentFolderNameFromPath(lastPath) : "";
  const folderRemembered = Boolean(memory.directoryHandle || memory.fileHandle || lastPath);
  if (dirName) {
    return {
      fileName: fileName ?? "Noch nicht gespeichert",
      folderLabel: dirName,
      folderRemembered: true,
    };
  }
  if (pathFolder) {
    return {
      fileName: fileName ?? "Noch nicht gespeichert",
      folderLabel: pathFolder,
      folderRemembered: true,
    };
  }
  if (folderRemembered && fileName) {
    return {
      fileName,
      folderLabel: lastPath ? `${fileName} — Pfad gemerkt` : `${fileName} — Ordner gemerkt`,
      folderRemembered: true,
    };
  }
  if (folderRemembered) {
    return {
      fileName: fileName ?? "Noch nicht gespeichert",
      folderLabel: lastPath ? "Pfad gemerkt" : "Ordner gemerkt",
      folderRemembered: true,
    };
  }
  return {
    fileName: fileName ?? "Noch nicht gespeichert",
    folderLabel: "Kein Ordner gemerkt",
    folderRemembered: false,
  };
}

export function hasFileSystemAccess(host: PickerHost): boolean {
  return typeof host.showSaveFilePicker === "function" && typeof host.showOpenFilePicker === "function";
}

/** Last project folder if we have a handle; otherwise documents. */
export function startInForPicker(memory: ProjectFileMemory): StartIn {
  return memory.directoryHandle ?? memory.fileHandle ?? DEFAULT_START_IN;
}

export function savePickerOptions(suggestedName: string, memory: ProjectFileMemory): SavePickerOptions {
  return {
    suggestedName,
    startIn: startInForPicker(memory),
    types: SAVE_PROJECT_TYPES,
  };
}

export function openPickerOptions(memory: ProjectFileMemory): OpenPickerOptions {
  return {
    multiple: false,
    startIn: startInForPicker(memory),
    types: PROJECT_TYPES,
  };
}

export function relinkPickerOptions(kind: MediaKind, memory: ProjectFileMemory): OpenPickerOptions {
  return {
    multiple: false,
    startIn: startInForPicker(memory),
    types: kind === "image" ? RELINK_IMAGE_TYPES : kind === "video" ? RELINK_VIDEO_TYPES : RELINK_AUDIO_TYPES,
  };
}

export function relinkAcceptAttr(kind: MediaKind): string {
  if (kind === "image") return "image/*";
  return kind === "video" ? "video/*" : "audio/*";
}

export async function pickRelinkMediaFile(opts: {
  host: PickerHost;
  memory: ProjectFileMemory;
  kind: MediaKind;
}): Promise<{ kind: "picked"; file: File } | { kind: "cancelled" } | { kind: "fallback" }> {
  if (typeof opts.host.showOpenFilePicker !== "function") return { kind: "fallback" };
  try {
    const [handle] = await opts.host.showOpenFilePicker(relinkPickerOptions(opts.kind, opts.memory));
    if (!handle?.getFile) return { kind: "cancelled" };
    const file = await handle.getFile();
    return { kind: "picked", file };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") return { kind: "cancelled" };
    throw e;
  }
}

/** MP4 save picker. Do not reuse PROJECT_TYPES (json). */
export function exportPickerOptions(suggestedName: string, memory: ProjectFileMemory): SavePickerOptions {
  return {
    suggestedName,
    startIn: startInForPicker(memory),
    types: MP4_TYPES,
  };
}

/** WAV save picker. Same startIn as MP4; do not reuse PROJECT_TYPES or MP4_TYPES. */
export function wavExportPickerOptions(suggestedName: string, memory: ProjectFileMemory): SavePickerOptions {
  return {
    suggestedName,
    startIn: startInForPicker(memory),
    types: WAV_TYPES,
  };
}

export type ExportDestination =
  | { kind: "cancelled" }
  | { kind: "fallback" }
  | { kind: "picked"; handle: FileHandleLike; fileName: string; memory: ProjectFileMemory };

/**
 * Native save picker before encode. Cancel is AbortError — no encode.
 * Remembers the parent directory for next startIn; does not replace the
 * project .json fileHandle with the MP4 handle.
 */
export async function pickExportDestination(opts: {
  host: PickerHost;
  store: ProjectFileStore;
  memory: ProjectFileMemory;
  suggestedName: string;
  pickerOptions?: (suggestedName: string, memory: ProjectFileMemory) => SavePickerOptions;
}): Promise<ExportDestination> {
  if (typeof opts.host.showSaveFilePicker !== "function") {
    return { kind: "fallback" };
  }
  let handle: FileHandleLike;
  try {
    const options = (opts.pickerOptions ?? exportPickerOptions)(opts.suggestedName, opts.memory);
    handle = await opts.host.showSaveFilePicker(options);
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") return { kind: "cancelled" };
    throw e;
  }
  if (!handle) return { kind: "cancelled" };
  const fileName = handle.name || opts.suggestedName;
  const dir = await directoryOf(handle);
  const memory = dir
    ? await rememberDirectoryHandle(opts.store, dir, opts.memory)
    : opts.memory;
  return { kind: "picked", handle, fileName, memory };
}

export async function writeExportBlob(handle: FileHandleLike, blob: Blob): Promise<void> {
  if (typeof handle.createWritable !== "function") {
    throw new Error("Export file handle is not writable");
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function exportStatusFsa(fileName: string, bytes?: number): string {
  return bytes != null ? `Exported ${fileName} (${bytes} bytes)` : `Exported ${fileName}`;
}

export function exportStatusFallback(fileName: string, bytes?: number): string {
  return `${exportStatusFsa(fileName, bytes)} — Browser-Downloads (Pfad unbekannt)`;
}

export function saveStatusFsa(fileName: string): string {
  return `Gespeichert: ${fileName} — Projektordner gemerkt`;
}

export function loadStatusFsa(fileName: string): string {
  return `Geladen: ${fileName}`;
}

export function saveStatusFallback(fileName: string): string {
  return `Gespeichert: ${fileName} — Browser-Downloads (Pfad unbekannt)`;
}

export function loadStatusFallback(fileName: string): string {
  return `Geladen: ${fileName} — Datei gewählt (Pfad unbekannt)`;
}

export function lastLoadedStatus(fileName: string): string {
  return `Zuletzt geladen: ${fileName} — Öffnen klicken`;
}

export function statusHasFakePath(status: string): boolean {
  return /[A-Za-z]:[\\/]/.test(status) || /\/home\//.test(status) || /\/Users\//.test(status);
}

export async function queryGranted(
  handle: { queryPermission?: FileHandleLike["queryPermission"] } | null,
  mode: "read" | "readwrite",
): Promise<boolean> {
  if (!handle?.queryPermission) return false;
  try {
    return (await handle.queryPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

export async function directoryOf(file: FileHandleLike): Promise<DirectoryHandleLike | null> {
  if (typeof file.getParent !== "function") return null;
  try {
    return await file.getParent();
  } catch {
    return null;
  }
}

export async function rememberFileHandle(
  store: ProjectFileStore,
  fileHandle: FileHandleLike,
  previous: ProjectFileMemory = emptyProjectFileMemory(),
): Promise<ProjectFileMemory> {
  const prev = normalizeProjectFileMemory(previous);
  const directoryHandle = (await directoryOf(fileHandle)) ?? prev.directoryHandle;
  const lastFileName = fileHandle.name;
  const recent: RecentProject = { fileHandle, directoryHandle, lastFileName };
  const memory: ProjectFileMemory = {
    ...prev,
    fileHandle,
    directoryHandle,
    lastFileName,
    lastPath: null,
    recents: upsertRecent(prev.recents ?? [], recent),
  };
  await store.save(memory);
  return memory;
}

export async function rememberExportFileName(
  store: ProjectFileStore,
  memory: ProjectFileMemory,
  fileName: string,
): Promise<ProjectFileMemory> {
  const next = withExportFileName(memory, fileName);
  await store.save(next);
  return next;
}

export async function rememberDirectoryHandle(
  store: ProjectFileStore,
  directoryHandle: DirectoryHandleLike,
  previous: ProjectFileMemory = emptyProjectFileMemory(),
): Promise<ProjectFileMemory> {
  const memory: ProjectFileMemory = {
    ...normalizeProjectFileMemory(previous),
    directoryHandle,
  };
  await store.save(memory);
  return memory;
}

export async function tryReadGrantedFile(
  memory: ProjectFileMemory,
): Promise<{ kind: "ready"; text: string; fileName: string } | { kind: "needsOpen"; fileName: string } | null> {
  if (!memory.lastFileName && !memory.fileHandle) return null;
  const name = memory.fileHandle?.name ?? memory.lastFileName;
  if (!name) return null;
  if (!memory.fileHandle) return { kind: "needsOpen", fileName: name };
  const granted = await queryGranted(memory.fileHandle, "read");
  if (!granted || typeof memory.fileHandle.getFile !== "function") {
    return { kind: "needsOpen", fileName: name };
  }
  try {
    const file = await memory.fileHandle.getFile();
    return { kind: "ready", text: await readFileText(file), fileName: file.name || name };
  } catch {
    return { kind: "needsOpen", fileName: name };
  }
}

async function writeSavedHandle(opts: {
  host: PickerHost;
  store: ProjectFileStore;
  memory: ProjectFileMemory;
  filename: string;
  json: string;
  fallbackDownload: (filename: string, text: string) => void;
  handle: FileHandleLike;
}): Promise<{ status: string; memory: ProjectFileMemory; usedFallback: boolean; cancelled?: boolean }> {
  if (!opts.handle.createWritable) {
    opts.fallbackDownload(opts.handle.name || opts.filename, opts.json);
    return {
      status: saveStatusFallback(opts.handle.name || opts.filename),
      memory: opts.memory,
      usedFallback: true,
    };
  }
  const writable = await opts.handle.createWritable();
  await writable.write(opts.json);
  await writable.close();
  const memory = await rememberFileHandle(opts.store, opts.handle, opts.memory);
  return { status: saveStatusFsa(opts.handle.name), memory, usedFallback: false };
}

type WindowPickers = {
  showSaveFilePicker?: PickerHost["showSaveFilePicker"];
  showOpenFilePicker?: PickerHost["showOpenFilePicker"];
  showDirectoryPicker?: PickerHost["showDirectoryPicker"];
};

/** Live window lookup — do not snapshot/bind at render; FSA can be missing until the click. */
export function nativeWindowSavePicker(): PickerHost["showSaveFilePicker"] | undefined {
  const w = typeof window !== "undefined" ? (window as unknown as WindowPickers) : undefined;
  const fn = w?.showSaveFilePicker;
  if (typeof fn !== "function") return undefined;
  return (opts) => fn.call(w, opts);
}

export function resolveSavePicker(host: PickerHost): PickerHost["showSaveFilePicker"] | undefined {
  if (typeof host.showSaveFilePicker === "function") return host.showSaveFilePicker;
  return nativeWindowSavePicker();
}

export function suggestedProjectPickerName(filename: string, memory: ProjectFileMemory): string {
  return nextVersionedFileName(filename, existingProjectNamesFromMemory(memory));
}

async function pickSaveHandle(
  host: PickerHost,
  filename: string,
  memory: ProjectFileMemory,
): Promise<{ handle?: FileHandleLike; cancelled?: boolean }> {
  const picker = resolveSavePicker(host);
  if (typeof picker !== "function") return {};
  try {
    const suggested = suggestedProjectPickerName(filename, memory);
    return { handle: await picker(savePickerOptions(suggested, memory)) };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") return { cancelled: true };
    throw e;
  }
}

export async function runSave(opts: {
  host: PickerHost;
  store: ProjectFileStore;
  memory: ProjectFileMemory;
  filename: string;
  json: string;
  fallbackDownload: (filename: string, text: string) => void;
}): Promise<{ status: string; memory: ProjectFileMemory; usedFallback: boolean; cancelled?: boolean }> {
  let handle = opts.memory.fileHandle;
  const canWrite = handle ? await queryGranted(handle, "readwrite") : false;
  if (handle && canWrite && typeof handle.createWritable === "function") {
    return writeSavedHandle({ ...opts, handle });
  }

  const picker = resolveSavePicker(opts.host);
  if (typeof picker !== "function") {
    const suggested = suggestedProjectPickerName(opts.filename, opts.memory);
    opts.fallbackDownload(suggested, opts.json);
    return {
      status: saveStatusFallback(suggested),
      memory: { ...opts.memory, lastFileName: suggested },
      usedFallback: true,
    };
  }

  const picked = await pickSaveHandle(opts.host, opts.filename, opts.memory);
  if (picked.cancelled || !picked.handle) {
    return { status: "", memory: opts.memory, usedFallback: false, cancelled: true };
  }
  return writeSavedHandle({ ...opts, handle: picked.handle });
}

/** Always open the save picker (Speichern unter). Never reuse the last file handle. */
export async function runSaveAs(opts: {
  host: PickerHost;
  store: ProjectFileStore;
  memory: ProjectFileMemory;
  filename: string;
  json: string;
  fallbackDownload: (filename: string, text: string) => void;
}): Promise<{ status: string; memory: ProjectFileMemory; usedFallback: boolean; cancelled?: boolean }> {
  const picker = resolveSavePicker(opts.host);
  if (typeof picker !== "function") {
    const suggested = suggestedProjectPickerName(opts.filename, opts.memory);
    opts.fallbackDownload(suggested, opts.json);
    return {
      status: saveStatusFallback(suggested),
      memory: { ...opts.memory, lastFileName: suggested },
      usedFallback: true,
    };
  }
  // First await must be showSaveFilePicker so the click gesture stays valid.
  const picked = await pickSaveHandle(opts.host, opts.filename, opts.memory);
  if (picked.cancelled || !picked.handle) {
    return { status: "", memory: opts.memory, usedFallback: false, cancelled: true };
  }
  return writeSavedHandle({ ...opts, handle: picked.handle });
}

export async function runChooseFolder(opts: {
  host: PickerHost;
  store: ProjectFileStore;
  memory: ProjectFileMemory;
}): Promise<{ memory: ProjectFileMemory; status: string; cancelled?: boolean }> {
  if (typeof opts.host.showDirectoryPicker !== "function") {
    return { memory: opts.memory, status: "Ordner wählen nicht verfügbar" };
  }
  try {
    const directoryHandle = await opts.host.showDirectoryPicker({
      startIn: startInForPicker(opts.memory),
      mode: "readwrite",
    });
    const memory = await rememberDirectoryHandle(opts.store, directoryHandle, opts.memory);
    const name = directoryHandle.name;
    return {
      memory,
      status: name ? `Ordner gemerkt: ${name}` : "Ordner gemerkt",
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") {
      return { memory: opts.memory, status: "", cancelled: true };
    }
    throw e;
  }
}

export async function runOpenRecent(opts: {
  store: ProjectFileStore;
  memory: ProjectFileMemory;
  recent: RecentProject;
}): Promise<
  | { kind: "opened"; text: string; fileName: string; status: string; memory: ProjectFileMemory }
  | { kind: "needsPicker" }
> {
  const handle = opts.recent.fileHandle;
  if (handle.requestPermission) {
    try {
      const perm = await handle.requestPermission({ mode: "read" });
      if (perm !== "granted") return { kind: "needsPicker" };
    } catch {
      return { kind: "needsPicker" };
    }
  }
  if (typeof handle.getFile !== "function") return { kind: "needsPicker" };
  try {
    const file = await handle.getFile();
    const text = await readFileText(file);
    const previous: ProjectFileMemory = {
      ...normalizeProjectFileMemory(opts.memory),
      directoryHandle: opts.recent.directoryHandle ?? opts.memory.directoryHandle,
    };
    const memory = await rememberFileHandle(opts.store, handle, previous);
    const fileName = file.name || handle.name;
    return { kind: "opened", text, fileName, status: loadStatusFsa(fileName), memory };
  } catch {
    return { kind: "needsPicker" };
  }
}

export async function runOpen(opts: {
  host: PickerHost;
  store: ProjectFileStore;
  memory: ProjectFileMemory;
}): Promise<
  | { kind: "opened"; text: string; fileName: string; status: string; memory: ProjectFileMemory }
  | { kind: "fallback" }
  | { kind: "cancelled" }
> {
  if (!hasFileSystemAccess(opts.host) || !opts.host.showOpenFilePicker) {
    return { kind: "fallback" };
  }
  try {
    const [handle] = await opts.host.showOpenFilePicker(openPickerOptions(opts.memory));
    if (!handle?.getFile) return { kind: "cancelled" };
    const file = await handle.getFile();
    const text = await readFileText(file);
    const memory = await rememberFileHandle(opts.store, handle, opts.memory);
    const fileName = file.name || handle.name;
    return { kind: "opened", text, fileName, status: loadStatusFsa(fileName), memory };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "AbortError") return { kind: "cancelled" };
    throw e;
  }
}

export async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Response(file).text();
}

export function browserPickerHost(): PickerHost {
  return {
    get showSaveFilePicker() {
      return nativeWindowSavePicker();
    },
    get showOpenFilePicker() {
      const w = typeof window !== "undefined" ? (window as unknown as WindowPickers) : undefined;
      const fn = w?.showOpenFilePicker;
      if (typeof fn !== "function") return undefined;
      return (opts: OpenPickerOptions) => fn.call(w, opts);
    },
    get showDirectoryPicker() {
      const w = typeof window !== "undefined" ? (window as unknown as WindowPickers) : undefined;
      const fn = w?.showDirectoryPicker;
      if (typeof fn !== "function") return undefined;
      return (opts: DirectoryPickerOptions) => fn.call(w, opts);
    },
  };
}
