import { classifyFile } from "./media";

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function isZipFile(file: Pick<File, "name" | "type">): boolean {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return true;
  return file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

function findEocd(view: DataView): number {
  const len = view.byteLength;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i -= 1) {
    if (u32(view, i) === SIG_EOCD) return i;
  }
  throw new Error("Not a ZIP archive");
}

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

function entryBaseName(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  const parts = cleaned.split("/").filter(Boolean);
  return parts.at(-1) ?? cleaned;
}

function skipZipEntry(path: string): boolean {
  const cleaned = path.replace(/\\/g, "/");
  if (cleaned.endsWith("/")) return true;
  const base = entryBaseName(cleaned);
  if (!base || base === "." || base === "..") return true;
  if (cleaned.startsWith("__MACOSX/") || cleaned.includes("/__MACOSX/")) return true;
  if (base === ".DS_Store" || base.startsWith("._")) return true;
  return false;
}

function arrayBufferFromBytes(data: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(data.byteLength);
  new Uint8Array(out).set(data);
  return out;
}

async function readFileBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Deflate ZIP needs DecompressionStream");
  }
  const stream = new Blob([arrayBufferFromBytes(data)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function mimeHint(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".wav")) return "audio/wav";
  if (n.endsWith(".mp3")) return "audio/mpeg";
  if (n.endsWith(".m4a")) return "audio/mp4";
  if (n.endsWith(".aac")) return "audio/aac";
  if (n.endsWith(".ogg")) return "audio/ogg";
  if (n.endsWith(".flac")) return "audio/flac";
  if (n.endsWith(".mp4")) return "video/mp4";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

export async function expandZipToMediaFiles(file: File): Promise<File[]> {
  const buf = await readFileBuffer(file);
  if (buf.byteLength < 22) throw new Error(`${file.name}: ZIP is empty`);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const eocd = findEocd(view);
  const count = u16(view, eocd + 10);
  let cdOff = u32(view, eocd + 16);
  const out: File[] = [];
  for (let i = 0; i < count; i += 1) {
    if (cdOff + 46 > buf.byteLength || u32(view, cdOff) !== SIG_CD) {
      throw new Error(`${file.name}: ZIP directory is truncated`);
    }
    const flags = u16(view, cdOff + 8);
    const method = u16(view, cdOff + 10);
    const compSize = u32(view, cdOff + 20);
    const nameLen = u16(view, cdOff + 28);
    const extraLen = u16(view, cdOff + 30);
    const commentLen = u16(view, cdOff + 32);
    const localOff = u32(view, cdOff + 42);
    const nameBytes = bytes.subarray(cdOff + 46, cdOff + 46 + nameLen);
    const path = decodeZipName(nameBytes, (flags & 0x800) !== 0);
    cdOff += 46 + nameLen + extraLen + commentLen;
    if (skipZipEntry(path)) continue;
    if (localOff + 30 > buf.byteLength) continue;
    const localNameLen = u16(view, localOff + 26);
    const localExtraLen = u16(view, localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    if (dataOff + compSize > buf.byteLength) continue;
    const packed = bytes.subarray(dataOff, dataOff + compSize);
    let raw: Uint8Array;
    if (method === METHOD_STORE) raw = packed;
    else if (method === METHOD_DEFLATE) raw = await inflateRaw(packed);
    else continue;
    const name = entryBaseName(path);
    const extracted = new File([arrayBufferFromBytes(raw)], name, { type: mimeHint(name) });
    try {
      classifyFile(extracted);
    } catch {
      continue;
    }
    out.push(extracted);
  }
  return out;
}

export async function expandImportFiles(
  files: readonly File[],
): Promise<{ files: File[]; errors: string[] }> {
  const out: File[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!isZipFile(file)) {
      out.push(file);
      continue;
    }
    try {
      const inner = await expandZipToMediaFiles(file);
      if (inner.length === 0) {
        errors.push(`${file.name}: no audio/video/images in ZIP`);
        continue;
      }
      out.push(...inner);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { files: out, errors };
}
