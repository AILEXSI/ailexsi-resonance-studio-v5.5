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

/**
 * AFE-08: emit the first `emitLimit` submitted timestamps immediately,
 * hold the rest in decodeQueue, and hang on flush(). Models the Windows
 * shape — requested VIDEO is done; speculative queue must be cancelled.
 */
export class EmitThenHoldHangFlushDecoder {
  static emitLimit = 12;
  decodeQueueSize = 0;
  submitted: number[] = [];
  emitted = 0;
  closed = false;
  resetCount = 0;
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
    this.output(new FakeVideoFrame(chunk.timestamp));
    this.emitted += 1;
    this.decodeQueueSize = Math.max(0, this.submitted.length - EmitThenHoldHangFlushDecoder.emitLimit);
    for (const fn of this.listeners) fn();
  }

  async flush(): Promise<void> {
    return new Promise(() => {
      /* hang — speculative drain must not wait here */
    });
  }

  reset(): void {
    this.submitted = [];
    this.emitted = 0;
    this.decodeQueueSize = 0;
    this.resetCount += 1;
  }

  close(): void {
    this.closed = true;
    this.decodeQueueSize = 0;
  }

  addEventListener(eventType: string, fn: () => void): void {
    if (eventType === "dequeue") this.listeners.add(fn);
  }

  removeEventListener(_eventType: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
}

export function installEmitThenHoldHangFlushDecoder(emitLimit: number): () => void {
  EmitThenHoldHangFlushDecoder.emitLimit = emitLimit;
  return installDecoderCtor(EmitThenHoldHangFlushDecoder);
}

/**
 * AFE-10: first decoder instance holds (forces GOP recreate). The recreated
 * instance emits only after `need` decode-order submits — models WebView2
 * holding sample 38 until later DPB input arrives (submitted 44 → 140).
 */
export class RecoverThenNeedDecoder {
  static instances = 0;
  static need = 36;
  readonly born: number;
  decodeQueueSize = 0;
  submitted: number[] = [];
  emitted = 0;
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
    this.born = RecoverThenNeedDecoder.instances++;
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
    this.decodeQueueSize = this.submitted.length - this.emitted;
    this.tryEmit();
  }

  tryEmit(): void {
    if (this.submitted.length < RecoverThenNeedDecoder.need) return;
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

export function installRecoverThenNeedDecoder(need: number): () => void {
  RecoverThenNeedDecoder.instances = 0;
  RecoverThenNeedDecoder.need = need;
  return installDecoderCtor(RecoverThenNeedDecoder);
}

/**
 * AFE-11: first instance holds (GOP recreate). Recreated instance never emits,
 * including on flush — true missing exact PTS after useful input is exhausted.
 */
export class RecoverThenNeverEmitDecoder {
  static instances = 0;
  readonly born: number;
  decodeQueueSize = 0;
  submitted: number[] = [];
  closed = false;
  private readonly listeners = new Set<() => void>();

  constructor(_opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.born = RecoverThenNeverEmitDecoder.instances++;
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

export function installRecoverThenNeverEmitDecoder(): () => void {
  RecoverThenNeverEmitDecoder.instances = 0;
  return installDecoderCtor(RecoverThenNeverEmitDecoder);
}

/**
 * AFE-12: emit the first `emitLimit` chunks via microtask, then stick if
 * decodeQueue reached `floodStickAt` before those emits ran (sync flood).
 * If the producer waits (queue stays below floodStickAt), keep emitting.
 * First instance holds so the scheduler GOP-recreates.
 */
export class RecoverThenFloodStuckDecoder {
  static instances = 0;
  static emitLimit = 12;
  static floodStickAt = 64;
  readonly born: number;
  decodeQueueSize = 0;
  submitted: number[] = [];
  emitted = 0;
  stuck = false;
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
    this.born = RecoverThenFloodStuckDecoder.instances++;
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
    if (this.born === 0) return;
    if (
      this.decodeQueueSize >= RecoverThenFloodStuckDecoder.floodStickAt &&
      this.emitted >= RecoverThenFloodStuckDecoder.emitLimit
    ) {
      this.stuck = true;
      return;
    }
    queueMicrotask(() => this.tryEmit());
  }

  tryEmit(): void {
    if (this.closed || this.stuck) return;
    if (
      this.decodeQueueSize >= RecoverThenFloodStuckDecoder.floodStickAt &&
      this.emitted >= RecoverThenFloodStuckDecoder.emitLimit
    ) {
      this.stuck = true;
      return;
    }
    if (this.emitted >= this.submitted.length) return;
    this.output(new FakeVideoFrame(this.submitted[this.emitted++]!));
    this.decodeQueueSize = this.submitted.length - this.emitted;
    for (const fn of this.listeners) fn();
    if (this.emitted < this.submitted.length && !this.stuck) {
      queueMicrotask(() => this.tryEmit());
    }
  }

  async flush(): Promise<void> {
    if (this.stuck) {
      return new Promise(() => {
        /* hang — flood-stuck hardware does not drain */
      });
    }
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
    this.stuck = false;
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

export function installRecoverThenFloodStuckDecoder(opts?: {
  emitLimit?: number;
  floodStickAt?: number;
}): () => void {
  RecoverThenFloodStuckDecoder.instances = 0;
  RecoverThenFloodStuckDecoder.emitLimit = opts?.emitLimit ?? 12;
  RecoverThenFloodStuckDecoder.floodStickAt = opts?.floodStickAt ?? 64;
  return installDecoderCtor(RecoverThenFloodStuckDecoder);
}

/**
 * AFE-12 hypothesis proof: emit first `emitLimit` synchronously, hold the
 * rest in decodeQueue, hang on flush. Models submitted140 / queue125 /
 * lastDecoded stuck without any capacity wait.
 */
export class EmitThenHoldFloodDecoder {
  static emitLimit = 12;
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
    if (this.emitted < EmitThenHoldFloodDecoder.emitLimit) {
      this.output(new FakeVideoFrame(chunk.timestamp));
      this.emitted += 1;
    }
    this.decodeQueueSize = Math.max(0, this.submitted.length - EmitThenHoldFloodDecoder.emitLimit);
    for (const fn of this.listeners) fn();
  }

  async flush(): Promise<void> {
    return new Promise(() => {
      /* hang */
    });
  }

  reset(): void {
    this.submitted = [];
    this.emitted = 0;
    this.decodeQueueSize = 0;
  }

  close(): void {
    this.closed = true;
    this.decodeQueueSize = 0;
  }

  addEventListener(eventType: string, fn: () => void): void {
    if (eventType === "dequeue") this.listeners.add(fn);
  }

  removeEventListener(_eventType: string, fn: () => void): void {
    this.listeners.delete(fn);
  }
}

export function installEmitThenHoldFloodDecoder(emitLimit = 12): () => void {
  EmitThenHoldFloodDecoder.emitLimit = emitLimit;
  return installDecoderCtor(EmitThenHoldFloodDecoder);
}

/**
 * AFE-13: first instance holds (force GOP recreate). Recreated instance
 * emits `emitBeforeFreeze` then freezes at HIGH_WATER — lastDecoded stuck,
 * queue stays full. A later instance (`emitOnInstance`, default 2) emits
 * all: models the earlier-keyframe walk-back escape. flush() hangs while
 * stuck so mid-run flush cannot pretend to be a pressure release.
 */
export class RecoverThenFreezeAtHighWaterDecoder {
  static instances = 0;
  static emitBeforeFreeze = 12;
  static emitOnInstance = 2;
  /** If set, first instance emits other PTS and holds this one (mid-run recreate). */
  static holdPtsOnFirstInstance: number | null = null;
  readonly born: number;
  decodeQueueSize = 0;
  submitted: number[] = [];
  emitted = 0;
  stuck = false;
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
    this.born = RecoverThenFreezeAtHighWaterDecoder.instances++;
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
    if (this.born === 0) {
      const holdPts = RecoverThenFreezeAtHighWaterDecoder.holdPtsOnFirstInstance;
      if (holdPts == null || chunk.timestamp === holdPts) return;
      queueMicrotask(() => {
        if (this.closed) return;
        this.output(new FakeVideoFrame(chunk.timestamp));
        this.emitted += 1;
        this.decodeQueueSize = this.submitted.length - this.emitted;
        for (const fn of this.listeners) fn();
      });
      return;
    }
    if (this.born >= RecoverThenFreezeAtHighWaterDecoder.emitOnInstance) {
      queueMicrotask(() => this.emitAll());
      return;
    }
    if (this.emitted < RecoverThenFreezeAtHighWaterDecoder.emitBeforeFreeze && !this.stuck) {
      queueMicrotask(() => this.tryEmitLimited());
      return;
    }
    this.stuck = true;
  }

  tryEmitLimited(): void {
    if (this.closed || this.stuck) return;
    if (this.emitted >= RecoverThenFreezeAtHighWaterDecoder.emitBeforeFreeze) {
      this.stuck = true;
      return;
    }
    if (this.emitted >= this.submitted.length) return;
    this.output(new FakeVideoFrame(this.submitted[this.emitted++]!));
    this.decodeQueueSize = this.submitted.length - this.emitted;
    for (const fn of this.listeners) fn();
    if (this.emitted < RecoverThenFreezeAtHighWaterDecoder.emitBeforeFreeze && this.emitted < this.submitted.length) {
      queueMicrotask(() => this.tryEmitLimited());
    } else {
      this.stuck = true;
    }
  }

  emitAll(): void {
    if (this.closed) return;
    while (this.emitted < this.submitted.length) {
      this.output(new FakeVideoFrame(this.submitted[this.emitted++]!));
    }
    this.decodeQueueSize = 0;
    this.stuck = false;
    for (const fn of this.listeners) fn();
  }

  async flush(): Promise<void> {
    if (this.stuck) {
      return new Promise(() => {
        /* hang — frozen HIGH_WATER must not flush as pressure release */
      });
    }
    this.emitAll();
  }

  reset(): void {
    this.submitted = [];
    this.emitted = 0;
    this.decodeQueueSize = 0;
    this.stuck = false;
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

export function installRecoverThenFreezeAtHighWaterDecoder(opts?: {
  emitBeforeFreeze?: number;
  emitOnInstance?: number;
  holdPtsOnFirstInstance?: number | null;
}): () => void {
  RecoverThenFreezeAtHighWaterDecoder.instances = 0;
  RecoverThenFreezeAtHighWaterDecoder.emitBeforeFreeze = opts?.emitBeforeFreeze ?? 12;
  RecoverThenFreezeAtHighWaterDecoder.emitOnInstance = opts?.emitOnInstance ?? 2;
  RecoverThenFreezeAtHighWaterDecoder.holdPtsOnFirstInstance = opts?.holdPtsOnFirstInstance ?? null;
  return installDecoderCtor(RecoverThenFreezeAtHighWaterDecoder);
}

/**
 * AFE-14: queue grows on decode(); tests drain to a floor via dequeue events.
 * Proves resume-only-at-LOW_WATER (not refill on every dequeue).
 */
export class ControllableQueueDecoder {
  static last: ControllableQueueDecoder | null = null;
  decodeQueueSize = 0;
  submitted: number[] = [];
  closed = false;
  private readonly output: HoldDecoderOptions["output"];
  private readonly listeners = new Set<() => void>();

  constructor(opts: { output: (frame: FakeVideoFrame) => void; error: (e: DOMException) => void }) {
    this.output = opts.output;
    ControllableQueueDecoder.last = this;
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
    this.decodeQueueSize += 1;
  }

  drain(n = 1, emit = false): void {
    const count = Math.min(n, this.decodeQueueSize);
    for (let i = 0; i < count; i++) {
      this.decodeQueueSize -= 1;
      if (emit) {
        const ts = this.submitted[this.submitted.length - this.decodeQueueSize - 1] ?? 0;
        this.output(new FakeVideoFrame(ts));
      }
    }
    for (const fn of this.listeners) fn();
  }

  async flush(): Promise<void> {
    /* */
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

export function installControllableQueueDecoder(): () => void {
  ControllableQueueDecoder.last = null;
  return installDecoderCtor(ControllableQueueDecoder);
}
