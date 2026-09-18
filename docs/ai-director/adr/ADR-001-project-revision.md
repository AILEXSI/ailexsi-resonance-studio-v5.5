# ADR-001 — Project revision / conflict identity

**Status:** Accepted for AI-6 (not implemented in AI-0)  
**Date:** 2026-09-18  
**Baseline:** V5.6 @ `35b6503`

## Context

Architecture v0.2 requires `projectRevision: number` and `TRANSACTION_CONFLICT` when `baseRevision !== currentRevision`.

Inspection of V5.6:

| Candidate | Actual behavior | Usable as revision? |
| --- | --- | --- |
| `Project.schemaVersion` | Literal `5` — file format, not edit counter | **No** |
| `Project.updatedAt` | ISO string; `touch()` / many mutators refresh it. Clock-based, not monotonic if clock skews. Mute/volume also update via `setTrackVolume` without history. | **No** (not monotonic, not dirty-aligned) |
| `HistoryStack.past.length` | Increments only when `withHistory` / drag-commit / `pushHistory` runs | **Partial** — mute/solo/volume/pan/master/IN-OUT/VIS scene/playhead do **not** push history |
| `isProjectDirty` | Compares `savedPastLength` / `savedFutureLength` to stack lengths | Dirty ≠ revision; mute does not dirty |
| Content hash of `Project` | Does not exist | — |

Evidence: `src/core/models.ts` `Project`; `src/core/project.ts` `PROJECT_SCHEMA_VERSION`; `src/core/timeline.ts` `pushHistory`; `src/app/session.ts` `isProjectDirty`, `withHistory`.

## Decision

**Smallest deterministic revision mechanism (do not implement in AI-0):**

Add `projectRevision: number` to `Project` (default `0`) and increment it **only** inside `withHistory` / the equivalent drag-commit history push / `applyCommitVolumeWrite`. Do **not** increment on playhead, zoom, scroll, selection, or live drag preview.

Conflict rule for AI Apply:

```
if (transaction.baseRevision !== session.project.projectRevision) → TRANSACTION_CONFLICT
```

Until that field exists, AI-6 must not claim conflict detection. Do **not** pretend `updatedAt` or `schemaVersion` is a revision.

## Consequences

- Mixer mute/solo/static fader remain non-revisioned until they join `withHistory` or get an explicit increment. That is existing V5.6 behavior — preserve it; document that AI must not treat those fields as transaction-safe until they are history-wrapped.
- Save/load: persist `projectRevision` in JSON when added; missing on old files → `0`.
- Undo/redo restores the snapshotted `Project`, so revision naturally rewinds. That matches snapshot history.

## Rejected alternatives

- Hash of serialized project: expensive on every playhead tick if naively applied; playhead is inside `Project`.
- History length alone: redo/undo and revert-to-save make length a poor external id; two different states can share a length after revert.
