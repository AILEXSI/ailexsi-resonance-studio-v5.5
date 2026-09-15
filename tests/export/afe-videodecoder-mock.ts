/** WebCodecs stand-in: emits frame i only after i+hold future samples (or flush). */

export class FakeVideoFrame {
  readonly codedWidth = 16;
  readonly codedHeight = 9;
  readonly displayWidth = 16;
  readonly displayHeight = 9;
  closed = false;
  constructor(readonly timestamp: number) {}
  close(): void {
    this.closed = true;
  }
  clone(): FakeVideoFrame {
    return new FakeVideoFrame(this.timestamp);
  }
}

export class FakeEncodedChunk {
  readonly byteLength: number;
  constructor(
    readonly init: { type: string; timestamp: number; duration?: number; data?: BufferSource },
  ) {
    this.byteLength = init.data && "byteLength" in init.data ? Number(init.data.byteLength) : 0;
  }
  get timestamp(): number {
    return this.init.timestamp;
  }
  get type(): string {
    return this.init.type;
  }
}

export type HoldDecoderOptions = {
  holdAfter: number;
  output: (frame: FakeVideoFrame) => void;
  error: (e: DOMException) => void;
};

export class HoldVideoDecoder {
  static holdAfter = 8;
  decodeQueueSize = 0;
  submitted: number[] = [];
  emitted = 0;
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
  }

  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: true };
  }

  configure(): void {
    /* */
  }

  decode(chunk: { timestamp: number }): void {
    if (this.closed) return;
    this.submitted.push(chunk.timestamp);
    this.decodeQueueSize = 1;
    queueMicrotask(() => {
      this.tryEmit();
      this.decodeQueueSize = 0;
      for (const fn of this.listeners) fn();
    });
  }

  tryEmit(): void {
    const hold = HoldVideoDecoder.holdAfter;
    while (this.emitted < this.submitted.length - hold) {
      this.output(new FakeVideoFrame(this.submitted[this.emitted++]!));
    }
  }

  async flush(): Promise<void> {
    while (this.emitted < this.submitted.length) {
      this.output(new FakeVideoFrame(this.submitted[this.emitted++]!));
    }
    this.decodeQueueSize = 0;
  }

  reset(): void {
    this.submitted = [];
    this.emitted = 0;
    this.decodeQueueSize = 0;
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(eventType: string, fn: () => void): void {
    if (eventType === "dequeue") this.listeners.add(fn);
  }

  removeEventListener(_eventType: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
}

/** Shape Q: decodeQueue stays >0 until flush(); requested PTS stays pending. */
export class QueueHeldVideoDecoder {
  decodeQueueSize = 0;
  submitted: number[] = [];
  emitted = 0;
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
  }

  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: true };
  }

  configure(): void {
    /* */
  }

  decode(chunk: { timestamp: number }): void {
    if (this.closed) return;
    this.submitted.push(chunk.timestamp);
    this.decodeQueueSize = this.submitted.length - this.emitted;
  }

  async flush(): Promise<void> {
    while (this.emitted < this.submitted.length) {
      this.output(new FakeVideoFrame(this.submitted[this.emitted++]!));
    }
    this.decodeQueueSize = 0;
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    this.submitted = [];
    this.emitted = 0;
    this.decodeQueueSize = 0;
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(eventType: string, fn: () => void): void {
    if (eventType === "dequeue") this.listeners.add(fn);
  }

  removeEventListener(_eventType: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
}

/** Shape R: neighbors emit; configured PTS values never appear. */
export class SkipPtsVideoDecoder {
  static skip = new Set<number>();
  decodeQueueSize = 0;
  submitted: number[] = [];
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
  }

  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: true };
  }

  configure(): void {
    /* */
  }

  decode(chunk: { timestamp: number }): void {
    if (this.closed) return;
    this.submitted.push(chunk.timestamp);
    this.decodeQueueSize = 0;
    if (SkipPtsVideoDecoder.skip.has(chunk.timestamp)) return;
    queueMicrotask(() => {
      this.output(new FakeVideoFrame(chunk.timestamp));
      for (const fn of this.listeners) fn();
    });
  }

  async flush(): Promise<void> {
    this.decodeQueueSize = 0;
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    this.submitted = [];
    this.decodeQueueSize = 0;
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(eventType: string, fn: () => void): void {
    if (eventType === "dequeue") this.listeners.add(fn);
  }

  removeEventListener(_eventType: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
}

/** Fail-closed after nudge: flush does not emit the requested PTS. */
export class NeverEmitVideoDecoder {
  decodeQueueSize = 0;
  submitted: number[] = [];
  closed = false;
  private readonly listeners = new Set<() => void>();

  constructor(_opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    /* */
  }

  static async isConfigSupported(): Promise<{ supported: boolean }> {
    return { supported: true };
  }

  configure(): void {
    /* */
  }

  decode(chunk: { timestamp: number }): void {
    if (this.closed) return;
    this.submitted.push(chunk.timestamp);
    this.decodeQueueSize = this.submitted.length;
  }

  async flush(): Promise<void> {
    this.decodeQueueSize = 0;
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    this.submitted = [];
    this.decodeQueueSize = 0;
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(eventType: string, fn: () => void): void {
    if (eventType === "dequeue") this.listeners.add(fn);
  }

  removeEventListener(_eventType: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
}

function installDecoderCtor(Ctor: unknown): () => void {
  const prev = {
    VideoDecoder: (globalThis as { VideoDecoder?: unknown }).VideoDecoder,
    EncodedVideoChunk: (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk,
    VideoFrame: (globalThis as { VideoFrame?: unknown }).VideoFrame,
  };
  (globalThis as { VideoDecoder: unknown }).VideoDecoder = Ctor;
  (globalThis as { EncodedVideoChunk: unknown }).EncodedVideoChunk = FakeEncodedChunk;
  (globalThis as { VideoFrame: unknown }).VideoFrame = FakeVideoFrame;
  return () => {
    if (prev.VideoDecoder) (globalThis as { VideoDecoder: unknown }).VideoDecoder = prev.VideoDecoder;
    else delete (globalThis as { VideoDecoder?: unknown }).VideoDecoder;
    if (prev.EncodedVideoChunk) {
      (globalThis as { EncodedVideoChunk: unknown }).EncodedVideoChunk = prev.EncodedVideoChunk;
    } else delete (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk;
    if (prev.VideoFrame) (globalThis as { VideoFrame: unknown }).VideoFrame = prev.VideoFrame;
    else delete (globalThis as { VideoFrame?: unknown }).VideoFrame;
  };
}

export function installQueueHeldDecoder(): () => void {
  return installDecoderCtor(QueueHeldVideoDecoder);
}

export function installSkipPtsDecoder(skipPts: Iterable<number>): () => void {
  SkipPtsVideoDecoder.skip = new Set(skipPts);
  return installDecoderCtor(SkipPtsVideoDecoder);
}

export function installNeverEmitDecoder(): () => void {
  return installDecoderCtor(NeverEmitVideoDecoder);
}

export function installHoldDecoder(holdAfter: number): () => void {
  const prev = {
    VideoDecoder: (globalThis as { VideoDecoder?: unknown }).VideoDecoder,
    EncodedVideoChunk: (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk,
    VideoFrame: (globalThis as { VideoFrame?: unknown }).VideoFrame,
  };
  HoldVideoDecoder.holdAfter = holdAfter;
  (globalThis as { VideoDecoder: unknown }).VideoDecoder = HoldVideoDecoder;
  (globalThis as { EncodedVideoChunk: unknown }).EncodedVideoChunk = FakeEncodedChunk;
  (globalThis as { VideoFrame: unknown }).VideoFrame = FakeVideoFrame;
  return () => {
    if (prev.VideoDecoder) (globalThis as { VideoDecoder: unknown }).VideoDecoder = prev.VideoDecoder;
    else delete (globalThis as { VideoDecoder?: unknown }).VideoDecoder;
    if (prev.EncodedVideoChunk) {
      (globalThis as { EncodedVideoChunk: unknown }).EncodedVideoChunk = prev.EncodedVideoChunk;
    } else delete (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk;
    if (prev.VideoFrame) (globalThis as { VideoFrame: unknown }).VideoFrame = prev.VideoFrame;
    else delete (globalThis as { VideoFrame?: unknown }).VideoFrame;
  };
}
