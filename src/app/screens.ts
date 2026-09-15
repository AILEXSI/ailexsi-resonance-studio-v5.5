import { TRACK_IDS, trackIdsOf, type Project, type TrackId } from "../core/models";

export const PRODUCTION_SCREENS = ["arrange", "cutter"] as const;
export type ProductionScreen = (typeof PRODUCTION_SCREENS)[number];

export const ARRANGE_TRACK_IDS: TrackId[] = [...TRACK_IDS];
export const CUTTER_TRACK_IDS: TrackId[] = ["V1", "V2"];

export function tracksForScreen(
  screen: ProductionScreen,
  project?: Pick<Project, "tracks">,
): TrackId[] {
  if (screen === "cutter") return CUTTER_TRACK_IDS;
  return project ? trackIdsOf(project) : ARRANGE_TRACK_IDS;
}

export function cycleProductionScreen(
  current: ProductionScreen,
  dir: 1 | -1,
): ProductionScreen {
  const i = PRODUCTION_SCREENS.indexOf(current);
  const next = (i + dir + PRODUCTION_SCREENS.length) % PRODUCTION_SCREENS.length;
  return PRODUCTION_SCREENS[next]!;
}

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "password",
  "email",
  "url",
  "tel",
  "number",
  "datetime-local",
  "date",
  "time",
  "week",
  "month",
]);

function isContentEditable(el: HTMLElement): boolean {
  return (
    el.isContentEditable ||
    el.contentEditable === "true" ||
    el.getAttribute("contenteditable") === "true"
  );
}

function isTextEditElement(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  if (isContentEditable(el)) return true;
  if (el.getAttribute("role") === "spinbutton") return true;
  return false;
}

/** True only for fields that accept typed text — not range / checkbox / button. */
export function isTextEditFocus(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const el = target as HTMLElement;
  if (isTextEditElement(el)) return true;
  const closest = el.closest("input, textarea, [contenteditable='true'], [contenteditable=true], [role=spinbutton]");
  return closest instanceof HTMLElement && isTextEditElement(closest);
}

export function editorTextEditFocus(target: EventTarget | null): boolean {
  if (isTextEditFocus(target)) return true;
  try {
    if (typeof document !== "undefined") return isTextEditFocus(document.activeElement);
  } catch {
    /* no document */
  }
  return false;
}

/** Mixer / W / VOL chrome may keep focus; Space still play/pauses on these. */
export function blurTransportChrome(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement)) return;
  if (isTextEditFocus(target)) return;
  target.blur();
}

export function isFormFocus(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (isContentEditable(el)) return true;
  if (el.getAttribute("role") === "spinbutton") return true;
  if (el.closest("[contenteditable='true'],[contenteditable=true],[role=spinbutton]")) return true;
  return false;
}

/** Event target or the real active field (injected keys often hit body). */
export function editorFormFocus(target: EventTarget | null): boolean {
  if (isFormFocus(target)) return true;
  try {
    if (typeof document !== "undefined") return isFormFocus(document.activeElement);
  } catch {
    /* no document */
  }
  return false;
}
