# ADR-002 — AI transaction preview strategy

**Status:** Accepted direction for AI-6/AI-7 (not implemented in AI-0)  
**Date:** 2026-09-18  
**Baseline:** V5.6 @ `35b6503`

## Context

LAW-08: Preview is not commit. Architecture v0.2 listed four strategies. Ranking must use existing V5.6 code only.

## Ranking (compatibility with existing code)

| Rank | Option | Existing evidence | Compatibility |
| --- | --- | --- | --- |
| **1** | **D — temporary transaction overlay** (drag-base pattern) | `App.tsx` `dragBaseRef` + `onMoveLive` applies `applyCommand` on `{ ...base, history: { past: [], future: [] } }` then writes `preview.project` into live session; `onMoveCommit` pushes `structuredClone(base.project)` onto `past`. Same for VIS move/stretch. | **Highest.** Already PREVIEW ≠ COMMIT for pointer gestures. Canonical history untouched until commit. |
| **2** | **B — cloned affected state** | `pushHistory` / drag commit use `structuredClone(project)`. `previewMoveVolumeAutomationPoint` returns `{ project, point }` without session write. Volume-write `gesture.before` clones the envelope. | **High.** Pure functions already return next `Project`. |
| **3** | **E — write-gesture live overlay** | `applyVolumeWriteSample` must not clone project / push history; audible override is `gesture.liveValue`. | **High for mixer write; narrow.** |
| **4** | **C — command simulation** | `applyCommand(session, command)` is a pure session→session function. Simulation = call it on a cloned session and discard. | **High mechanically, unused as a named API.** |
| **5** | **A — shadow session/engine** | No second Session, no shadow graph, no worker project. | **Lowest.** Would duplicate the engine. |

## Decision

For `timeline.move_clip` (AI-7):

1. Resolve `clipId` + `targetStartMs`.
2. Build a **draft** by calling existing `moveClip` / `applyMove` / `{ type: "moveClips" }` on a **cloned Session** whose `history` is empty (same as `onMoveLive`).
3. Hold the draft `Project` on the transaction object — **do not** assign it to `App` session.project until Apply.
4. Optional “Show on timeline” may use the drag-live pattern (overlay live project, keep `dragBaseRef` / transaction base). Cancel / Reject restores `base.project` without `pushHistory`.
5. Apply: revision check, then `applyMove` / `applyMoveClips` on the real session so `withHistory` records **one** snapshot.

Do **not** implement a parallel shadow media engine. Do **not** preview by writing canonical `Session.project` and hoping undo will save you — that is commit.

## Consequences

- Preview playback/A-B (AI-11) can later swap which `Project` Preview.tsx receives. Preview.tsx already takes `project` as a prop.
- Mute/scene-pick paths have no preview today; do not use them as the AI preview template.
