import {
  existingExportNamesFromMemory,
  formatExportFileName,
  mediaExportFileName,
  nextVersionedFileName,
  parseExportFileName,
  readyExportNameFromProject,
} from "./filename-version";
import {
  queryGranted,
  type DirectoryHandleLike,
  type ProjectFileMemory,
} from "../project-file";

export const EXPORT_NAME_PROBE_MAX = 256;
export const EXPORT_NAME_PROBE_MISS_STREAK = 8;

function isFileEntry(entry: { kind?: string } | null | undefined): boolean {
  if (!entry) return true;
  return entry.kind !== "directory";
}

async function ensureDirectoryReadable(dir: DirectoryHandleLike): Promise<boolean> {
  if (typeof dir.queryPermission === "function") {
    try {
      if ((await queryGranted(dir, "read")) === true) return true;
    } catch {
      /* try request / list anyway */
    }
  }
  if (typeof dir.requestPermission === "function") {
    try {
      const perm = await dir.requestPermission({ mode: "read" });
      if (perm !== "granted") return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** File names in a remembered FSA folder. Empty when listing is unavailable. */
export async function listDirectoryFileNames(
  dir: DirectoryHandleLike | null | undefined,
): Promise<string[]> {
  if (!dir) return [];
  if (!(await ensureDirectoryReadable(dir))) return [];

  try {
    if (typeof dir.values === "function") {
      const names: string[] = [];
      for await (const entry of dir.values()) {
        if (!entry || !isFileEntry(entry)) continue;
        if (typeof entry.name === "string" && entry.name) names.push(entry.name);
      }
      return names;
    }
    if (typeof dir.entries === "function") {
      const names: string[] = [];
      for await (const [name, entry] of dir.entries()) {
        if (!isFileEntry(entry)) continue;
        if (typeof name === "string" && name) names.push(name);
      }
      return names;
    }
    if (typeof dir.keys === "function") {
      const names: string[] = [];
      for await (const name of dir.keys()) {
        if (typeof name === "string" && name) names.push(name);
      }
      return names;
    }
  } catch {
    return [];
  }
  return [];
}

async function fileExists(dir: DirectoryHandleLike, name: string): Promise<boolean> {
  if (typeof dir.getFileHandle !== "function") return false;
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * When `values`/`entries` are missing, probe `Stem.ext` plus `.vN` / `_vN`
 * through a miss streak so Documents-style folders still bump.
 */
export async function probeExportSiblingNames(
  dir: DirectoryHandleLike | null | undefined,
  proposed: string,
): Promise<string[]> {
  if (!dir || typeof dir.getFileHandle !== "function") return [];
  if (!(await ensureDirectoryReadable(dir))) return [];
  const parsed = parseExportFileName(proposed);
  if (!parsed.baseStem) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  const take = async (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    if (!(await fileExists(dir, name))) return false;
    seen.add(key);
    names.push(name);
    return true;
  };

  await take(formatExportFileName(parsed.baseStem, null, parsed.ext));
  let misses = 0;
  for (let n = 1; n <= EXPORT_NAME_PROBE_MAX && misses < EXPORT_NAME_PROBE_MISS_STREAK; n += 1) {
    const dotted = `${parsed.baseStem}.v${n}${parsed.ext ? `.${parsed.ext}` : ""}`;
    const underscored = `${parsed.baseStem}_v${n}${parsed.ext ? `.${parsed.ext}` : ""}`;
    const found = (await take(dotted)) || (await take(underscored));
    misses = found ? 0 : misses + 1;
  }
  return names;
}

export async function collectExistingExportNames(
  memory: ProjectFileMemory,
  proposed?: string,
): Promise<string[]> {
  const remembered = existingExportNamesFromMemory(memory);
  const listed = await listDirectoryFileNames(memory.directoryHandle);
  if (listed.length > 0) return [...remembered, ...listed];
  if (proposed && memory.directoryHandle) {
    const probed = await probeExportSiblingNames(memory.directoryHandle, proposed);
    return [...remembered, ...probed];
  }
  return remembered;
}

export async function resolveSuggestedExportFileName(opts: {
  proposed: string;
  memory: ProjectFileMemory;
  listedNames?: readonly string[];
}): Promise<string> {
  const existing =
    opts.listedNames !== undefined
      ? [...existingExportNamesFromMemory(opts.memory), ...opts.listedNames]
      : await collectExistingExportNames(opts.memory, opts.proposed);
  return nextVersionedFileName(opts.proposed, existing);
}

export async function readyExportNameFromProjectAsync(opts: {
  projectName: string;
  memory: ProjectFileMemory;
  ext?: string;
  listedNames?: readonly string[];
}): Promise<string> {
  const proposed = mediaExportFileName(opts.projectName, opts.ext ?? "mp4");
  if (opts.listedNames !== undefined) {
    return readyExportNameFromProject(opts.projectName, opts.memory, opts.listedNames, opts.ext ?? "mp4");
  }
  const existing = await collectExistingExportNames(opts.memory, proposed);
  return nextVersionedFileName(proposed, existing);
}
