/**
 * Progressive track-header overflow — presentation only.
 * Every present control is either direct or in the overflow set, never both/neither.
 * Identity is never overflowed. Width is measured (or laneLabelPx fallback); not persisted.
 */

import { LANE_LABEL_MAX_PX, LANE_LABEL_MIN_PX } from "../../core/layout-prefs";

export const HEADER_WIDTH_WIDE_PX = LANE_LABEL_MAX_PX;
export const HEADER_WIDTH_MEDIUM_PX = 96;
export const HEADER_WIDTH_NARROW_PX = 84;
/** Divider floor — identity + Mute + overflow. Not Solo/W/VOL/Group. */
export const HEADER_WIDTH_MIN_PX = LANE_LABEL_MIN_PX;

/** Extra chrome inset so the direct row breathes before secondaries pile on. */
export const HEADER_PAD_PX = 8;
export const HEADER_CONTROL_GAP_PX = 4;
export const HEADER_OVERFLOW_BTN_PX = 16;
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
  identity: 28,
  mute: 20,
  solo: 20,
  write: 26,
  volume: 28,
  groupAssign: 40,
  groupCreate: 22,
  addAudio: 16,
  removeAudio: 16,
  scene: 48,
};

/** Identity + Mute stay on the header; secondaries overflow first. */
const PINNED_DIRECT: readonly HeaderControlId[] = ["identity", "mute"];

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

/** Tightest usable row: `A1 [M] [▾]`. Divider must not go below this. */
export function headerUsableMinPx(): number {
  return (
    HEADER_PAD_PX +
    HEADER_CONTROL_MIN_PX.identity +
    HEADER_CONTROL_GAP_PX +
    HEADER_CONTROL_MIN_PX.mute +
    HEADER_CONTROL_GAP_PX +
    HEADER_OVERFLOW_BTN_PX
  );
}

export function headerOverflowLabel(
  id: HeaderControlId,
  state: {
    muted?: boolean;
    soloed?: boolean;
    writeArmed?: boolean;
    volumeLaneOpen?: boolean;
    sceneName?: string;
    groupName?: string;
  } = {},
): string {
  switch (id) {
    case "mute":
      return state.muted ? "Unmute" : "Mute";
    case "solo":
      return state.soloed ? "Unsolo" : "Solo";
    case "write":
      return state.writeArmed ? "Disarm write automation" : "Write automation";
    case "volume":
      return state.volumeLaneOpen ? "Hide volume automation" : "Volume automation";
    case "scene":
      return state.sceneName ? `Scene · ${state.sceneName}` : "Scene";
    case "groupAssign":
      return state.groupName ? `Chapter group · ${state.groupName}` : "Chapter group";
    case "groupCreate":
      return "Group selected audio tracks";
    case "addAudio":
      return "Add audio track";
    case "removeAudio":
      return "Remove audio track";
    case "identity":
      return "Track";
    default:
      return id;
  }
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

  const pinned = chrome.filter((id) => PINNED_DIRECT.includes(id));
  const rest = chrome.filter((id) => !PINNED_DIRECT.includes(id));
  const reservedBudget = chromeBudget(widthPx, input.pack, true);
  const pinnedWidth = rowMinWidthPx(pinned);
  const restBudget =
    pinned.length === 0
      ? reservedBudget
      : Math.max(0, reservedBudget - pinnedWidth - (rest.length > 0 ? HEADER_CONTROL_GAP_PX : 0));
  const reserved = fitChrome(rest, restBudget);
  return {
    kind: input.kind,
    pack: input.pack,
    widthPx,
    visible: ["identity", ...pinned, ...reserved.visible],
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
