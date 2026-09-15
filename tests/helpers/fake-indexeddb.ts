/**
 * Minimal IndexedDB shim for exercising createIndexedDbBlobStore in Node/jsdom.
 * This is not a browser page-reload. Tests using it stay TEST-VERIFIED.
 */

type Row = Record<string, unknown>;

class FakeReq<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  succeed(value: T) {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.(new Event("success")));
  }
}

class FakeStore {
  constructor(private rows: Map<string, Row>) {}
  put(record: Row) {
    const id = String(record.id);
    this.rows.set(id, record);
    const req = new FakeReq<string>();
    req.succeed(id);
    return req;
  }
  get(id: string) {
    const req = new FakeReq<Row | undefined>();
    req.succeed(this.rows.get(id));
    return req;
  }
  delete(id: string) {
    this.rows.delete(id);
    const req = new FakeReq<undefined>();
    req.succeed(undefined);
    return req;
  }
  getAllKeys() {
    const req = new FakeReq<string[]>();
    req.succeed([...this.rows.keys()]);
    return req;
  }
  clear() {
    this.rows.clear();
    const req = new FakeReq<undefined>();
    req.succeed(undefined);
    return req;
  }
}

class FakeTx {
  oncomplete: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  error: DOMException | null = null;
  constructor(private store: FakeStore) {
    // After put/get in the same turn; do not complete before the store write.
    setTimeout(() => this.oncomplete?.(new Event("complete")), 0);
  }
  objectStore() {
    return this.store;
  }
}

class FakeDB {
  objectStoreNames = { contains: (name: string) => name === "media-blobs" };
  constructor(private rows: Map<string, Row>) {}
  createObjectStore() {
    return new FakeStore(this.rows);
  }
  transaction() {
    return new FakeTx(new FakeStore(this.rows));
  }
  close() {}
}

export function installFakeIndexedDB(): () => void {
  const rows = new Map<string, Row>();
  const prev = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  const factory = {
    open() {
      const req = new FakeReq<FakeDB>();
      (req as FakeReq<FakeDB> & { onupgradeneeded: ((ev: Event) => void) | null }).onupgradeneeded = null;
      const db = new FakeDB(rows);
      queueMicrotask(() => {
        const upgraded = req as FakeReq<FakeDB> & { onupgradeneeded: ((ev: Event) => void) | null };
        req.result = db;
        upgraded.onupgradeneeded?.(new Event("upgradeneeded"));
        req.onsuccess?.(new Event("success"));
      });
      return req as unknown as IDBOpenDBRequest;
    },
  };
  (globalThis as { indexedDB: IDBFactory }).indexedDB = factory as unknown as IDBFactory;
  return () => {
    if (prev) (globalThis as { indexedDB: IDBFactory }).indexedDB = prev;
    else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  };
}
