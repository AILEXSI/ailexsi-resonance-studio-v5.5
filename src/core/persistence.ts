import type { MediaAsset, Project } from "./models";

export interface StoredBlob {
  id: string;
  blob: Blob;
  name: string;
  mimeType: string;
  savedAt: number;
}

export interface BlobStore {
  put(record: StoredBlob): Promise<void>;
  get(id: string): Promise<StoredBlob | null>;
  delete(id: string): Promise<void>;
  listIds(): Promise<string[]>;
  clear(): Promise<void>;
}

export function createMemoryBlobStore(): BlobStore {
  const map = new Map<string, StoredBlob>();
  return {
    async put(record) {
      map.set(record.id, record);
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async delete(id) {
      map.delete(id);
    },
    async listIds() {
      return [...map.keys()];
    },
    async clear() {
      map.clear();
    },
  };
}

const DB_NAME = "resonance-studio-v6-0";
const STORE = "media-blobs";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export function createIndexedDbBlobStore(): BlobStore {
  return {
    async put(record) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    async get(id) {
      const db = await openDb();
      const row = await new Promise<StoredBlob | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve((req.result as StoredBlob | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return row;
    },
    async delete(id) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    async listIds() {
      const db = await openDb();
      const ids = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve((req.result as string[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return ids;
    },
    async clear() {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
  };
}

export function missingPrefix(name: string): string {
  return name.startsWith("missing:") ? name : `missing:${name}`;
}

export async function persistAssetBlob(
  store: BlobStore,
  asset: MediaAsset,
  blob: Blob,
): Promise<void> {
  await store.put({
    id: asset.blobId,
    blob,
    name: asset.name,
    mimeType: asset.mimeType,
    savedAt: Date.now(),
  });
}

export type SourcePathReader = (path: string) => Promise<Blob | null>;

function objectUrlOf(blob: Blob): string | undefined {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(blob)
    : undefined;
}

export async function hydrateProject(
  project: Project,
  store: BlobStore,
  readSource?: SourcePathReader,
): Promise<Project> {
  const assets: MediaAsset[] = [];
  for (const asset of project.assets) {
    try {
      const row = await store.get(asset.blobId);
      if (row?.blob) {
        assets.push({
          ...asset,
          name: row.name || asset.name,
          mimeType: row.mimeType || asset.mimeType,
          objectUrl: objectUrlOf(row.blob),
          missing: false,
        });
        continue;
      }
      const fromDisk =
        asset.sourcePath && readSource ? await readSource(asset.sourcePath) : null;
      if (fromDisk) {
        assets.push({
          ...asset,
          objectUrl: objectUrlOf(fromDisk),
          missing: false,
        });
        continue;
      }
      assets.push({
        ...asset,
        objectUrl: undefined,
        missing: true,
        name: asset.name.replace(/^missing:/, ""),
      });
    } catch {
      assets.push({
        ...asset,
        objectUrl: undefined,
        missing: true,
      });
    }
  }
  return { ...project, assets };
}

export function missingAssets(project: Project): MediaAsset[] {
  return project.assets.filter((a) => a.missing || !a.objectUrl);
}

export function describeMissing(asset: MediaAsset): string {
  return missingPrefix(asset.name);
}
