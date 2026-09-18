/**
 * Progressive track-header overflow — presentation only.
 * Every present control is either direct or in the overflow set, never both/neither.
 * Identity is never overflowed. Width is measured (or laneLabelPx fallback); not persisted.
 */

export const HEADER_WIDTH_WIDE_PX = 160;
export const HEADER_WIDTH_MEDIUM_PX = 96;
export const HEADER_WIDTH_NARROW_PX = 84;
export const HEADER_WIDTH_MIN_PX = 72;

export const HEADER_PAD_PX = 4;
export const HEADER_CONTROL_GAP_PX = 2;
export const HEADER_OVERFLOW_BTN_PX = 12;
export const HEADER_HYSTERESIS_PX = 6;

export type HeaderTrackKind = "vis" | "video" | "audio";
export type HeaderPack = "stack" | "inline";

export type HeaderControlId =
  | "identity"
  | "mute"
  | "solo"
  | "write"
  | "volume"
  | "groupAssign"
  | "groupCreate"
  | "addAudio"
  | "removeAudio"
  | "scene";

/** Min-width metadata so buttons are not crushed. Identity stays readable. */
export const HEADER_CONTROL_MIN_PX: Record<HeaderControlId, number> = {
  identity: 22,
  mute: 16,
  solo: 16,
  write: 16,
  volume: 20,
  groupAssign: 32,
  groupCreate: 18,
  addAudio: 12,
  removeAudio: 12,
  scene: 36,
};

/** Highest → lowest keep priority. Identity is pinned visible. */
export const HEADER_PRIORITY: Record<HeaderTrackKind, readonly HeaderControlId[]> = {
  vis: ["identity", "mute", "scene"],
  video: ["identity", "mute", "solo"],
  audio: [
    "identity",
    "mute",
    "solo",
    "write",
    "volume",
    "groupAssign",
    "groupCreate",
    "addAudio",
    "removeAudio",
  ],
};

export interface TrackHeaderOverflowPlan {
  kind: HeaderTrackKind;
  pack: HeaderPack;
  widthPx: number;
  visible: HeaderControlId[];
  overflow: HeaderControlId[];
}

export function resolveHeaderWidth(measuredPx: number, fallbackPx: number): number {
  if (Number.isFinite(measuredPx) && measuredPx > 0) return measuredPx;
  if (Number.isFinite(fallbackPx) && fallbackPx > 0) return fallbackPx;
  return HEADER_WIDTH_MEDIUM_PX;
}

/** Ignore sub-band jitter so ResizeObserver noise does not flicker overflow. */
export function stabilizeHeaderWidth(
  prevPx: number,
  nextPx: number,
  bandPx = HEADER_HYSTERESIS_PX,
): number {
  if (!Number.isFinite(nextPx) || nextPx <= 0) {
    return Number.isFinite(prevPx) && prevPx > 0 ? prevPx : 0;
  }
  if (!Number.isFinite(prevPx) || prevPx <= 0) return nextPx;
  if (Math.abs(nextPx - prevPx) < bandPx) return prevPx;
  return nextPx;
}

export function rowMinWidthPx(ids: readonly HeaderControlId[]): number {
  if (ids.length === 0) return 0;
  let sum = 0;
  for (const id of ids) sum += HEADER_CONTROL_MIN_PX[id];
  return sum + HEADER_CONTROL_GAP_PX * (ids.length - 1);
}

function orderedPresent(kind: HeaderTrackKind, present: readonly HeaderControlId[]): HeaderControlId[] {
  const allowed = new Set<HeaderControlId>(HEADER_PRIORITY[kind]);
  const have = new Set(present.filter((id) => allowed.has(id)));
  return HEADER_PRIORITY[kind].filter((id) => have.has(id));
}

function chromeBudget(widthPx: number, pack: HeaderPack, reserveOverflowBtn: boolean): number {
  const inner = Math.max(0, widthPx - HEADER_PAD_PX);
  if (pack === "stack") {
    return reserveOverflowBtn ? Math.max(0, inner - HEADER_OVERFLOW_BTN_PX - HEADER_CONTROL_GAP_PX) : inner;
  }
  const afterIdentity = Math.max(0, inner - HEADER_CONTROL_MIN_PX.identity - HEADER_CONTROL_GAP_PX);
  return reserveOverflowBtn
    ? Math.max(0, afterIdentity - HEADER_OVERFLOW_BTN_PX - HEADER_CONTROL_GAP_PX)
    : afterIdentity;
}

function fitChrome(
  chrome: readonly HeaderControlId[],
  budgetPx: number,
): { visible: HeaderControlId[]; overflow: HeaderControlId[] } {
  const visible: HeaderControlId[] = [];
  const overflow: HeaderControlId[] = [];
  let overflowing = false;
  for (const id of chrome) {
    if (!overflowing && rowMinWidthPx([...visible, id]) <= budgetPx) {
      visible.push(id);
    } else {
      overflowing = true;
      overflow.push(id);
    }
  }
  return { visible, overflow };
}

export function planTrackHeaderOverflow(input: {
  kind: HeaderTrackKind;
  widthPx: number;
  pack: HeaderPack;
  present: readonly HeaderControlId[];
}): TrackHeaderOverflowPlan {
  const widthPx = Number.isFinite(input.widthPx) && input.widthPx > 0 ? input.widthPx : HEADER_WIDTH_MEDIUM_PX;
  const ordered = orderedPresent(input.kind, input.present);
  const chrome = ordered.filter((id) => id !== "identity");
  if (chrome.length === 0) {
    return { kind: input.kind, pack: input.pack, widthPx, visible: ["identity"], overflow: [] };
  }

  const allBudget = chromeBudget(widthPx, input.pack, false);
  if (rowMinWidthPx(chrome) <= allBudget) {
    return {
      kind: input.kind,
      pack: input.pack,
      widthPx,
      visible: ["identity", ...chrome],
      overflow: [],
    };
  }

  const reserved = fitChrome(chrome, chromeBudget(widthPx, input.pack, true));
  return {
    kind: input.kind,
    pack: input.pack,
    widthPx,
    visible: ["identity", ...reserved.visible],
    overflow: reserved.overflow,
  };
}

export function headerControlsExclusive(
  present: readonly HeaderControlId[],
  plan: TrackHeaderOverflowPlan,
): boolean {
  if (!plan.visible.includes("identity")) return false;
  if (plan.overflow.includes("identity")) return false;
  const seen = new Set<HeaderControlId>();
  for (const id of [...plan.visible, ...plan.overflow]) {
    if (seen.has(id)) return false;
    seen.add(id);
  }
  const presentSet = new Set(orderedPresent(plan.kind, present));
  if (seen.size !== presentSet.size) return false;
  for (const id of presentSet) {
    if (!seen.has(id)) return false;
  }
  return true;
}

export function controlIsDirect(plan: TrackHeaderOverflowPlan, id: HeaderControlId): boolean {
  return plan.visible.includes(id);
}

export function controlIsOverflowed(plan: TrackHeaderOverflowPlan, id: HeaderControlId): boolean {
  return plan.overflow.includes(id);
}
