/** AILEXSI Frame Engine — export-only frame source types. */

import type { AfeStallSnapshot } from "./stall";

export type FrameSourceBackendId = "ailexsi" | "htmlvideo";

export type AfeErrorCode =
  | "AFE_UNSUPPORTED_CONTAINER"
  | "AFE_UNSUPPORTED_CODEC"
  | "AFE_UNSUPPORTED_SAMPLE_TABLE"
  | "AFE_DECODE_CONFIG_FAILED"
  | "AFE_DECODE_FAILED"
  | "AFE_DECODE_STALL"
  | "AFE_ABORTED";

export interface DrawableFrame {
  readonly timestamp: number;
  readonly duration: number;
  readonly codedWidth: number;
  readonly codedHeight: number;
  draw(ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void;
  drawWithFit(ctx: CanvasRenderingContext2D, opts: { fit: "contain" }): void;
  close(): void;
}

export interface OpenedFrameSource {
  readonly identity: FrameSourceBackendId;
  getFrameAt(timeSec: number, signal?: AbortSignal): Promise<DrawableFrame | null>;
  getFramesAt(timesSec: readonly number[], signal?: AbortSignal): AsyncIterable<DrawableFrame | null>;
  close(): void;
  memoryStats(): AfeMemoryStats;
  stallSnapshot?(extra?: Partial<AfeStallSnapshot>): AfeStallSnapshot;
}

export interface FrameSourceBackend {
  readonly identity: FrameSourceBackendId;
  open(src: string, signal?: AbortSignal): Promise<OpenedFrameSource>;
}

export interface AfeMemoryStats {
  decodedCached: number;
  maxDecodedCached: number;
  approxBytes: number;
  peakDecodedCached: number;
}

export interface AfeSample {
  /** 0-based decode-order index. */
  index: number;
  byteOffset: number;
  byteSize: number;
  dtsTimescale: number;
  ptsTimescale: number;
  durationTimescale: number;
  isKeyframe: boolean;
}

export interface AfeAvcConfig {
  codec: string;
  description: Uint8Array;
  width: number;
  height: number;
  nalLengthSize: number;
  profileIndication: number;
  profileCompatibility: number;
  levelIndication: number;
}

export type AfeCttsKind = "absent" | "constant" | "variable";

export interface AfeMovie {
  timescale: number;
  editListOffset: number;
  width: number;
  height: number;
  sampleCount: number;
  durationSec: number;
  fpsHint: number;
  samples: AfeSample[];
  /** Decode-order samples sorted by PTS (presentation order). */
  presentation: AfeSample[];
  keyframeIndices: number[];
  /** CTTS v0 unsigned / v1 signed, or null when the box is absent. */
  cttsVersion: 0 | 1 | null;
  cttsKind: AfeCttsKind;
  /** Max (decode_index − presentation_rank); bounds the reorder-ready queue. */
  maxReorderSamples: number;
  avc: AfeAvcConfig;
  bytes: Uint8Array;
}

export interface AfeMismatch {
  file: string;
  requestedSec: number;
  afeFrame: number | null;
  expectedPts: number | null;
  afePts: number | null;
  dts: number | null;
  nearestKeyframe: number | null;
  frameDelta: number | null;
}