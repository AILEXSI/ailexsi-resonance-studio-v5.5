import { useEffect, useMemo, useState } from "react";
import {
  FILMSTRIP_THUMB_PX,
  buildPeakMipmap,
  envelopeForWidth,
  envelopeToPath,
  envelopeWidthPx,
  filmstripTimes,
  type MinMaxPeaks,
  type PeakMipmap,
} from "../../core/clip-preview";
import { decodeAudio, isPlayableSource, loadVideo, seekVideo } from "../../core/exporter/media";
import type { Clip, MediaAsset } from "../../core/models";
import { loadStill } from "../../core/still";

const WAVE_H = 36;
const mipCache = new Map<string, PeakMipmap>();
const thumbCache = new Map<string, string>();

export function AudioClipWave(props: {
  clip: Clip;
  asset: MediaAsset;
  clipWidthPx: number;
  envelope?: MinMaxPeaks | null;
  samples?: ArrayLike<number> | null;
}) {
  const { clip, asset, clipWidthPx, envelope: injected, samples } = props;
  const [mip, setMip] = useState<PeakMipmap | null>(null);
  const width = envelopeWidthPx(clipWidthPx);

  useEffect(() => {
    if (injected || samples) {
      setMip(null);
      return;
    }
    const url = asset.objectUrl;
    if (!url || !isPlayableSource(url)) return;
    const cached = mipCache.get(url);
    if (cached) {
      setMip(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const buf = await decodeAudio(url);
        const channel = buf.getChannelData(0);
        const next = buildPeakMipmap(channel);
        mipCache.set(url, next);
        if (!cancelled) setMip(next);
      } catch {
        /* keep green fill */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.objectUrl, injected, samples]);

  const peaks = useMemo(() => {
    if (injected) return injected;
    const source = samples ? samples : mip;
    if (!source) return null;
    return envelopeForWidth(source, {
      widthPx: width,
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs,
      durationMs: asset.durationMs,
    });
  }, [injected, samples, mip, width, clip.sourceInMs, clip.sourceOutMs, asset.durationMs]);

  if (!peaks || peaks.max.length === 0) return null;
  const d = envelopeToPath(peaks, width, WAVE_H);
  if (!d) return null;
  return (
    <svg
      className="clip-wave"
      data-testid={`clip-wave-${clip.id}`}
      data-peak-count={peaks.max.length}
      viewBox={`0 0 ${width} ${WAVE_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

async function grabThumb(url: string, timeMs: number): Promise<string | null> {
  const key = `${url}@${Math.round(timeMs)}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  try {
    const el = await loadVideo(url);
    await seekVideo(el, timeMs / 1000);
    const canvas = document.createElement("canvas");
    canvas.width = FILMSTRIP_THUMB_PX;
    canvas.height = 36;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
    const src = canvas.toDataURL("image/jpeg", 0.65);
    thumbCache.set(key, src);
    return src;
  } catch {
    return null;
  }
}

/** Same poster as timeline filmstrip/still — one cache, no second store. */
export function binPosterKind(asset: MediaAsset): "video" | "image" | null {
  if (asset.missing || !asset.objectUrl || !isPlayableSource(asset.objectUrl)) return null;
  if (asset.kind === "image" || asset.kind === "video") return asset.kind;
  return null;
}

export function binPosterTimeMs(asset: MediaAsset): number | null {
  const kind = binPosterKind(asset);
  if (!kind) return null;
  if (kind === "image") return 0;
  const times = filmstripTimes({
    sourceInMs: 0,
    sourceOutMs: Math.max(1, asset.durationMs),
    clipWidthPx: FILMSTRIP_THUMB_PX,
    kind: "video",
  });
  return times[0] ?? 0;
}

export async function posterThumbForAsset(asset: MediaAsset): Promise<string | null> {
  const kind = binPosterKind(asset);
  if (!kind || !asset.objectUrl) return null;
  if (kind === "image") return grabStillThumb(asset.objectUrl);
  const timeMs = binPosterTimeMs(asset) ?? 0;
  return grabThumb(asset.objectUrl, timeMs);
}

async function grabStillThumb(url: string): Promise<string | null> {
  const key = `${url}@still`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  try {
    const img = await loadStill(url);
    const canvas = document.createElement("canvas");
    canvas.width = FILMSTRIP_THUMB_PX;
    canvas.height = 36;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const src = canvas.toDataURL("image/jpeg", 0.65);
    thumbCache.set(key, src);
    return src;
  } catch {
    return null;
  }
}

export function VideoClipStrip(props: {
  clip: Clip;
  asset: MediaAsset;
  clipWidthPx: number;
  fetchFrame?: (timeMs: number) => Promise<string | null>;
}) {
  const { clip, asset, clipWidthPx, fetchFrame } = props;
  const [thumbs, setThumbs] = useState<Array<{ timeMs: number; src: string }>>([]);

  useEffect(() => {
    const url = asset.objectUrl;
    const times = filmstripTimes({
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs,
      clipWidthPx,
      kind: asset.kind,
    });
    let cancelled = false;
    const loader =
      fetchFrame ??
      (url && isPlayableSource(url)
        ? asset.kind === "image"
          ? () => grabStillThumb(url)
          : (t: number) => grabThumb(url, t)
        : null);
    if (!loader) return;
    setThumbs([]);
    void (async () => {
      const next: Array<{ timeMs: number; src: string }> = [];
      for (const timeMs of times) {
        const src = await loader(timeMs);
        if (cancelled) return;
        if (src) {
          next.push({ timeMs, src });
          setThumbs([...next]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.kind, asset.objectUrl, clip.sourceInMs, clip.sourceOutMs, clipWidthPx, fetchFrame]);

  if (thumbs.length === 0) return null;
  return (
    <div className="clip-filmstrip" data-testid={`clip-filmstrip-${clip.id}`} aria-hidden="true">
      {thumbs.map((t) => (
        <img key={t.timeMs} src={t.src} alt="" />
      ))}
    </div>
  );
}
