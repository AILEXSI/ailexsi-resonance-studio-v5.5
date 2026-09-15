/**
 * Shorten MEDIA labels for the bin. Disk / asset.name stay unchanged.
 * UUID-looking stems become a 6-char prefix + ellipsis + extension.
 */
import type { MediaAsset, MediaKind } from "./models";

const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_HEX = /^[0-9a-f]{16,}$/i;

export type MediaKindFilter = MediaKind | "all";

export function normalizeMediaQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function assetMatchesMediaQuery(
  asset: Pick<MediaAsset, "name" | "kind" | "mimeType">,
  query: string,
): boolean {
  const q = normalizeMediaQuery(query);
  if (!q) return true;
  const name = asset.name.toLowerCase();
  const kind = asset.kind.toLowerCase();
  const mime = (asset.mimeType ?? "").toLowerCase();
  return name.includes(q) || kind.includes(q) || mime.includes(q);
}

export function filterMediaAssets<T extends Pick<MediaAsset, "name" | "kind" | "mimeType">>(
  assets: readonly T[],
  opts: { query?: string; kind?: MediaKindFilter } = {},
): T[] {
  const kind = opts.kind ?? "all";
  return assets.filter((asset) => {
    if (kind !== "all" && asset.kind !== kind) return false;
    return assetMatchesMediaQuery(asset, opts.query ?? "");
  });
}

export function displayMediaName(name: string, max = 22): string {
  if (!name) return name;
  const extMatch = name.match(/(\.[A-Za-z0-9]{1,8})$/);
  const ext = extMatch?.[1] ?? "";
  const stem = ext ? name.slice(0, -ext.length) : name;
  if (UUID.test(stem) || LONG_HEX.test(stem)) {
    const prefix = stem.slice(0, 6);
    return `${prefix}…${ext}`;
  }
  if (name.length <= max) return name;
  const keep = Math.max(8, max - ext.length - 1);
  return `${stem.slice(0, keep)}…${ext}`;
}

/** Lane / mixer label from a stem filename. Drops the extension; truncates long names. */
export function trackLabelFromFilename(fileName: string, max = 18): string {
  const base = (fileName.replace(/\\/g, "/").split("/").pop() ?? fileName).trim();
  if (!base) return "audio";
  const extMatch = base.match(/(\.[A-Za-z0-9]{1,8})$/);
  const stem = extMatch ? base.slice(0, -extMatch[1].length) : base;
  const label = (stem || base).trim();
  if (UUID.test(label) || LONG_HEX.test(label)) return `${label.slice(0, 6)}…`;
  if (label.length <= max) return label;
  return `${label.slice(0, Math.max(8, max - 1))}…`;
}
