import {
  emptyProjectFileMemory,
  normalizeProjectFileMemory,
  type ProjectFileMemory,
  type ProjectFileStore,
} from "./project-file";

export function createMemoryProjectFileStore(initial?: ProjectFileMemory): ProjectFileStore {
  let memory = normalizeProjectFileMemory(initial ?? emptyProjectFileMemory());
  return {
    async load() {
      return memory;
    },
    async save(next) {
      memory = normalizeProjectFileMemory(next);
    },
  };
}

const DB_NAME = "resonance-studio-v5-5-project-file";
const STORE = "kv";
const KEY = "project-file";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
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

export function createIndexedDbProjectFileStore(): ProjectFileStore {
  return {
    async load() {
      try {
        const db = await openDb();
        const row = await new Promise<ProjectFileMemory | null>((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(KEY);
          req.onsuccess = () => {
            const raw = req.result as
              | (ProjectFileMemory & { id?: string })
              | undefined;
            if (!raw) {
              resolve(null);
              return;
            }
            resolve(normalizeProjectFileMemory(raw));
          };
          req.onerror = () => reject(req.error);
        });
        db.close();
        return row ?? emptyProjectFileMemory();
      } catch {
        return emptyProjectFileMemory();
      }
    },
    async save(memory) {
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put({ id: KEY, ...memory });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      } catch {
        /* permission / private mode */
      }
    },
  };
}
