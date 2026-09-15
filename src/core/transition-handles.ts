import { collectSnapTargets, snapTime, type SnapTarget } from "./timeline";
import type { Project } from "./models";

/**
 * Pixel drag on a transition duration edge → integer ms.
 * Snaps the window *end* (startMs + duration) when project.snap is on.
 * Min 0. Does not write audioDurationMs or video durationMs itself.
 */
export function durationMsFromHandleDrag(opts: {
  originDurationMs: number;
  startMs: number;
  deltaPx: number;
  zoomPxPerSec: number;
  snap?: boolean;
  snapTargets?: readonly SnapTarget[];
}): number {
  const zoom = opts.zoomPxPerSec > 0 ? opts.zoomPxPerSec : 1;
  const rawEnd = opts.startMs + opts.originDurationMs + (opts.deltaPx / zoom) * 1000;
  const endMs = opts.snap && opts.snapTargets
    ? snapTime(rawEnd, [...opts.snapTargets]).timeMs
    : rawEnd;
  return Math.max(0, Math.round(endMs - opts.startMs));
}

export function transitionDurationSnapTargets(project: Project): SnapTarget[] {
  return collectSnapTargets(project);
}
