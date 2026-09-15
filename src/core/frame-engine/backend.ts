import { isPlayableSource, loadVideo, seekVideo } from "../exporter/media";
import { AfeError, throwIfAborted } from "./errors";
import { parseIsoBmff } from "./mp4-reader";
import { afePerfTime, afePerfTimeAsync } from "./perf";
import { AfeScheduler } from "./scheduler";
import type {
  AfeMemoryStats,
  DrawableFrame,
  FrameSourceBackend,
  FrameSourceBackendId,
  OpenedFrameSource,
} from "./types";

const EMPTY_MEMORY: AfeMemoryStats = {
  decodedCached: 0,
  maxDecodedCached: 0,
  approxBytes: 0,
  peakDecodedCached: 0,
};

async function loadSourceBytes(src: string, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (!isPlayableSource(src)) {
    throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "blocked or unreadable source");
  }
  return afePerfTimeAsync("sourceOpen", async () => {
    const res = await fetch(src, { signal });
    if (!res.ok) throw new AfeError("AFE_DECODE_FAILED", `Failed to read media (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  });
}

class HtmlDrawable implements DrawableFrame {
  constructor(
    private readonly video: HTMLVideoElement,
    readonly timestamp: number,
  ) {}

  get duration(): number {
    return 0;
  }

  get codedWidth(): number {
    return this.video.videoWidth;
  }

  get codedHeight(): number {
    return this.video.videoHeight;
  }

  draw(ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void {
    ctx.drawImage(this.video, dx, dy, dw, dh);
  }

  drawWithFit(ctx: CanvasRenderingContext2D, _opts: { fit: "contain" }): void {
    const canvas = ctx.canvas;
    const srcW = this.video.videoWidth;
    const srcH = this.video.videoHeight;
    if (srcW < 2 || srcH < 2) return;
    const scale = Math.min(canvas.width / srcW, canvas.height / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    ctx.drawImage(this.video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }

  close(): void {
    /* HTMLVideoElement is cached; nothing to close */
  }
}

class AilexsiOpened implements OpenedFrameSource {
  readonly identity = "ailexsi" as const;
  private readonly scheduler: AfeScheduler;

  constructor(movie: ReturnType<typeof parseIsoBmff>) {
    this.scheduler = new AfeScheduler(movie);
  }

  getFrameAt(timeSec: number, signal?: AbortSignal) {
    return this.scheduler.getFrameAt(timeSec, signal);
  }

  getFramesAt(timesSec: readonly number[], signal?: AbortSignal) {
    return this.scheduler.getFramesAt(timesSec, signal);
  }

  close(): void {
    afePerfTime("cleanup", () => {
      this.scheduler.close();
    });
  }

  memoryStats() {
    return this.scheduler.memoryStats();
  }

  stallSnapshot(extra?: Parameters<AfeScheduler["stallSnapshot"]>[0]) {
    return this.scheduler.stallSnapshot(extra);
  }
}

/** Preview / test helper only. Export never opens this path. */
class HtmlVideoOpened implements OpenedFrameSource {
  readonly identity = "htmlvideo" as const;

  constructor(private readonly src: string) {}

  async getFrameAt(timeSec: number, signal?: AbortSignal): Promise<DrawableFrame | null> {
    throwIfAborted(signal);
    const video = await loadVideo(this.src);
    throwIfAborted(signal);
    await seekVideo(video, timeSec);
    throwIfAborted(signal);
    if (video.videoWidth < 2) return null;
    return new HtmlDrawable(video, video.currentTime);
  }

  async *getFramesAt(timesSec: readonly number[], signal?: AbortSignal): AsyncIterable<DrawableFrame | null> {
    for (const t of timesSec) {
      yield await this.getFrameAt(t, signal);
    }
  }

  close(): void {
    /* media.ts owns the element cache */
  }

  memoryStats(): AfeMemoryStats {
    return EMPTY_MEMORY;
  }
}

export class AilexsiFrameSourceBackend implements FrameSourceBackend {
  readonly identity = "ailexsi" as const;

  async open(src: string, signal?: AbortSignal): Promise<OpenedFrameSource> {
    const bytes = await loadSourceBytes(src, signal);
    throwIfAborted(signal);
    const movie = parseIsoBmff(bytes);
    return new AilexsiOpened(movie);
  }
}

export class HtmlVideoFrameSourceBackend implements FrameSourceBackend {
  readonly identity = "htmlvideo" as const;

  async open(src: string, signal?: AbortSignal): Promise<OpenedFrameSource> {
    throwIfAborted(signal);
    if (!isPlayableSource(src)) {
      throw new AfeError("AFE_UNSUPPORTED_CONTAINER", "blocked source");
    }
    return new HtmlVideoOpened(src);
  }
}

export function createFrameSourceBackend(id: FrameSourceBackendId): FrameSourceBackend {
  if (id === "htmlvideo") return new HtmlVideoFrameSourceBackend();
  return new AilexsiFrameSourceBackend();
}

export async function openFrameSource(
  id: FrameSourceBackendId,
  src: string,
  signal?: AbortSignal,
): Promise<OpenedFrameSource> {
  return createFrameSourceBackend(id).open(src, signal);
}
