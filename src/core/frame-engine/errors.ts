import type { AfeErrorCode } from "./types";

export class AfeError extends Error {
  readonly code: AfeErrorCode;
  /** Unused in V5.5 (no secondary export backend). Kept for AfeError shape. */
  readonly fallbackSafe: boolean;

  constructor(code: AfeErrorCode, message: string, fallbackSafe = true) {
    super(`${code}: ${message}`);
    this.name = "AfeError";
    this.code = code;
    this.fallbackSafe = fallbackSafe && code !== "AFE_ABORTED";
  }
}

export function isAfeError(e: unknown): e is AfeError {
  return e instanceof AfeError;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  const msg = reason instanceof Error ? reason.message : reason != null ? String(reason) : "aborted";
  throw new AfeError("AFE_ABORTED", msg, false);
}

export function abortedError(signal?: AbortSignal): AfeError {
  const reason = signal?.reason;
  const msg = reason instanceof Error ? reason.message : reason != null ? String(reason) : "aborted";
  return new AfeError("AFE_ABORTED", msg, false);
}
