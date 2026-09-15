/**
 * Optional live AnalyserNode tap for Visualz setFeatures + mix meters.
 * MediaElementSource can only be created once per element, so sources are
 * cached for the page lifetime. If Web Audio is unavailable or tap fails,
 * the host must use the synthetic 120 BPM AudioFeatures fallback.
 */

import { createFeatureExtractor, isSilentEnergy, type FeatureExtractor } from "./feature-extractor";
import type { AudioFeatures } from "./types";

/** Default mix keys. Extra audio tracks use their stable ids. */
export const MIX_LANES = ["V1", "V2", "A1", "A2"] as const;
export type MixLane = string;

export type MixPeaks = { master: number } & Record<string, number>;

export interface MixGains {
  master: number;
  pans?: Record<string, number>;
  V1pan?: number;
  V2pan?: number;
  A1pan?: number;
  A2pan?: number;
  [lane: string]: number | Record<string, number> | undefined;
}

export interface PlaybackTap {
  sample(timeMs: number): AudioFeatures;
  resume(): void;
  disconnect(): void;
  setGains(gains: MixGains): void;
  peaks(): MixPeaks;
  connect(id: string, el: HTMLMediaElement | null): boolean;
}

const sourceCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
let sharedCtx: AudioContext | null = null;

function audioCtor(): typeof AudioContext | undefined {
  if (typeof AudioContext !== "undefined") return AudioContext;
  return (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function sharedAudioContext(): AudioContext | null {
  if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    sharedCtx = null;
    return null;
  }
}

function sourceFor(ctx: AudioContext, el: HTMLMediaElement): MediaElementAudioSourceNode | null {
  const cached = sourceCache.get(el);
  if (cached) return cached;
  try {
    const source = ctx.createMediaElementSource(el);
    sourceCache.set(el, source);
    return source;
  } catch {
    return null;
  }
}

function panOf(gains: MixGains, id: string): number | undefined {
  const fromMap = gains.pans?.[id];
  if (fromMap != null) return fromMap;
  const legacy = (gains as Record<string, number | undefined>)[`${id}pan`];
  return legacy;
}

export function createPlaybackTap(
  elements: Partial<Record<string, HTMLMediaElement | null>> = {},
): PlaybackTap | null {
  const ctx = sharedAudioContext();
  if (!ctx) return null;

  const mixer = ctx.createGain();
  mixer.gain.value = 1;
  const masterAnalyser = ctx.createAnalyser();
  masterAnalyser.fftSize = 512;
  mixer.connect(masterAnalyser);
  masterAnalyser.connect(ctx.destination);

  const trackGains: Record<string, GainNode> = {};
  const trackPanners: Record<string, StereoPannerNode | null> = {};
  const trackAnalysers: Record<string, AnalyserNode> = {};
  const laneIds: string[] = [];
  let connected = 0;

  const connectLane = (id: string, el: HTMLMediaElement | null): boolean => {
    if (!el) return false;
    if (trackGains[id]) return true;
    const source = sourceFor(ctx, el);
    if (!source) return false;
    try {
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      let panner: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === "function") {
        panner = ctx.createStereoPanner();
        panner.pan.value = 0;
        source.connect(gain);
        gain.connect(panner);
        panner.connect(analyser);
      } else {
        source.connect(gain);
        gain.connect(analyser);
      }
      analyser.connect(mixer);
      trackGains[id] = gain;
      trackPanners[id] = panner;
      trackAnalysers[id] = analyser;
      if (!laneIds.includes(id)) laneIds.push(id);
      connected += 1;
      return true;
    } catch {
      return false;
    }
  };

  for (const [id, el] of Object.entries(elements)) {
    connectLane(id, el ?? null);
  }

  if (connected === 0) {
    try {
      mixer.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }

  let extractor: FeatureExtractor;
  try {
    extractor = createFeatureExtractor(ctx, mixer);
  } catch {
    try {
      mixer.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }

  const peakBuf = new Float32Array(512);
  const readPeak = (node: AnalyserNode): number => {
    try {
      node.getFloatTimeDomainData(peakBuf);
    } catch {
      return 0;
    }
    let p = 0;
    for (let i = 0; i < peakBuf.length; i += 1) p = Math.max(p, Math.abs(peakBuf[i] ?? 0));
    return p;
  };

  return {
    sample(timeMs: number) {
      return extractor.sample(timeMs);
    },
    resume() {
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    },
    connect(id, el) {
      return connectLane(id, el);
    },
    setGains(gains) {
      const now = ctx.currentTime;
      for (const id of laneIds) {
        const node = trackGains[id];
        if (node) {
          const value = Math.max(0, Number(gains[id]) || 0);
          try {
            node.gain.cancelScheduledValues(now);
            node.gain.setTargetAtTime(value, now, 0.012);
          } catch {
            node.gain.value = value;
          }
        }
        const panner = trackPanners[id];
        const pan = panOf(gains, id);
        if (panner && pan != null) panner.pan.value = Math.max(-1, Math.min(1, pan));
      }
      mixer.gain.value = Math.max(0, gains.master);
    },
    peaks() {
      const out: MixPeaks = { master: readPeak(masterAnalyser) };
      for (const id of laneIds) {
        const node = trackAnalysers[id];
        out[id] = node ? readPeak(node) : 0;
      }
      return out;
    },
    disconnect() {
      extractor.disconnect();
      try {
        mixer.disconnect();
      } catch {
        /* ignore */
      }
      // Keep shared AudioContext + MediaElementSources; they cannot be recreated.
    },
  };
}

/**
 * Prefer live analyser when it has energy. Visualz silence gate (`rms`/`bass`
 * floors) counts as no-sound — caller supplies quiet features when the project
 * audio path is active, or `featuresAt` only for an empty project.
 */
export function preferLiveFeatures(
  live: AudioFeatures | null | undefined,
  fallback: AudioFeatures,
): AudioFeatures {
  if (!live) return fallback;
  if (isSilentEnergy(live.rms, live.bass) && !live.onset) return fallback;
  return live;
}
