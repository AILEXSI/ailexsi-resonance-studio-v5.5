/**
 * AI-0 contract schemas — structured timeline references in AI messages.
 * Click behavior (future): seek playhead + optionally select the object.
 * Units: milliseconds internally; UI may format as mm:ss.cc via formatTimecode.
 */

import type { Clip, TrackId } from "../../../src/core/models";

export interface TimelineReference {
  startMs: number;
  endMs?: number;
  trackId?: TrackId;
  clipId?: Clip["id"];
  visEventId?: string;
  markerId?: string;
}

export interface ContextReference {
  kind: "selection" | "playhead" | "track" | "clip" | "project" | "timeline-range" | "mix" | "frame";
  display?: string;
  /** Resolved stable id. Display names are not identifiers (LAW-05). */
  id?: string;
  startMs?: number;
  endMs?: number;
}
