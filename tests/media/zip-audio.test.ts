import { describe, expect, it } from "vitest";
import { createSession, importFiles } from "../../src/app/session";
import { expandImportFiles, expandZipToMediaFiles, isZipFile } from "../../src/core/zip-audio";
import { audioTracksOf } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function storedZip(entries: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const local = new Uint8Array(30 + name.length + entry.bytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(18, entry.bytes.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cd = concat(centrals);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, cd, eocd]);
}

function zipFile(name: string, entries: { name: string; bytes: Uint8Array }[]): File {
  const packed = storedZip(entries);
  const buf = new ArrayBuffer(packed.byteLength);
  new Uint8Array(buf).set(packed);
  return new File([buf], name, { type: "application/zip" });
}

describe("ZIP stem expand (no new deps)", () => {
  it("detects zip names and extracts WAV/media, skipping junk", async () => {
    expect(isZipFile({ name: "stems.zip", type: "" })).toBe(true);
    expect(isZipFile({ name: "vocals.wav", type: "audio/wav" })).toBe(false);
    const zip = zipFile("chapter.zip", [
      { name: "stems/vocals.wav", bytes: new Uint8Array([1, 2, 3, 4]) },
      { name: "stems/drums.wav", bytes: new Uint8Array([5, 6, 7, 8]) },
      { name: "readme.txt", bytes: new Uint8Array([9]) },
      { name: "__MACOSX/._vocals.wav", bytes: new Uint8Array([0]) },
    ]);
    const files = await expandZipToMediaFiles(zip);
    expect(files.map((f) => f.name).sort()).toEqual(["drums.wav", "vocals.wav"]);
    expect(files[0]!.type).toMatch(/audio/);
  });

  it("import of a ZIP of WAVs is a stem batch", async () => {
    const zip = zipFile("01-stems.zip", [
      { name: "01_vocals-800ms.wav", bytes: new Uint8Array(64) },
      { name: "01_drums-400ms.wav", bytes: new Uint8Array(64) },
    ]);
    const session = await importFiles(createSession(createMemoryBlobStore()), [zip], async (file) => {
      const m = file.name.match(/(\d+)ms/);
      return { durationMs: m ? Number(m[1]) : 1000 };
    });
    expect(session.project.assets).toHaveLength(2);
    expect(session.project.clips).toHaveLength(2);
    expect(session.project.clips.every((c) => c.startMs === 0)).toBe(true);
    expect(new Set(session.project.clips.map((c) => c.trackId)).size).toBe(2);
    expect(audioTracksOf(session.project).map((t) => t.name)).toEqual(
      expect.arrayContaining(["01_vocals-800ms", "01_drums-400ms"]),
    );
    expect(session.project.tracks.find((t) => t.id === "A1")?.groupId).toBe("01");
    expect(session.project.groups?.some((g) => g.id === "01")).toBe(true);
    expect(session.status).toMatch(/Imported 2 stem/);
  });

  it("reports an empty media ZIP without touching the project", async () => {
    const zip = zipFile("notes.zip", [{ name: "notes.txt", bytes: new Uint8Array([1]) }]);
    const expanded = await expandImportFiles([zip]);
    expect(expanded.files).toHaveLength(0);
    expect(expanded.errors[0]).toMatch(/no audio/);
    const session = await importFiles(createSession(createMemoryBlobStore()), [zip]);
    expect(session.project.assets).toHaveLength(0);
    expect(session.status).toBe("Import failed");
  });
});
