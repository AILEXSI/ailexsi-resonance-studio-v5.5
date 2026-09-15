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

/** STEP B: emit only after enough decode-order submits (no flush). */
export class HoldUntilSubmittedDecoder {
  static need = 12;
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
    this.tryEmit();
  }

  tryEmit(): void {
    if (this.submitted.length < HoldUntilSubmittedDecoder.need) return;
    while (this.emitted < this.submitted.length) {
      this.output(new FakeVideoFrame(this.submitted[this.emitted++]!));
      this.decodeQueueSize = this.submitted.length - this.emitted;
    }
    for (const fn of this.listeners) fn();
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

/** STEP C: first decoder instance holds; the recreated instance emits. */
export class RecoverOnResetDecoder {
  static instances = 0;
  readonly born: number;
  decodeQueueSize = 0;
  submitted: number[] = [];
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
    this.born = RecoverOnResetDecoder.instances++;
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
    if (this.born === 0) {
      this.decodeQueueSize = this.submitted.length;
      return;
    }
    this.decodeQueueSize = 0;
    queueMicrotask(() => {
      if (this.closed) return;
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

/** FINAL_FLUSH watchdog: flush() never settles. */
export class HangFlushDecoder {
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
    return new Promise(() => {
      /* hang */
    });
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

/** After recreate, the closed instance still emits — those outputs must be ignored. */
export class StaleAfterResetDecoder {
  static instances = 0;
  readonly born: number;
  decodeQueueSize = 0;
  submitted: number[] = [];
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
    this.born = StaleAfterResetDecoder.instances++;
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
    const ts = chunk.timestamp;
    if (this.born === 0) {
      this.decodeQueueSize = this.submitted.length;
      setTimeout(() => {
        if (!this.closed) return;
        this.output(new FakeVideoFrame(ts + 1));
      }, 30);
      return;
    }
    this.decodeQueueSize = 0;
    queueMicrotask(() => {
      this.output(new FakeVideoFrame(ts));
      for (const fn of this.listeners) fn();
    });
  }

  async flush(): Promise<void> {
    this.decodeQueueSize = 0;
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

export function installHoldDecoder(holdAfter: number): () => void {
  HoldVideoDecoder.holdAfter = holdAfter;
  return installDecoderCtor(HoldVideoDecoder);
}

export function installHoldUntilSubmittedDecoder(need: number): () => void {
  HoldUntilSubmittedDecoder.need = need;
  return installDecoderCtor(HoldUntilSubmittedDecoder);
}

export function installRecoverOnResetDecoder(): () => void {
  RecoverOnResetDecoder.instances = 0;
  return installDecoderCtor(RecoverOnResetDecoder);
}

export function installHangFlushDecoder(): () => void {
  return installDecoderCtor(HangFlushDecoder);
}

export function installStaleAfterResetDecoder(): () => void {
  StaleAfterResetDecoder.instances = 0;
  return installDecoderCtor(StaleAfterResetDecoder);
}
