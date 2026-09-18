# AI Director V5.6 — Gap Matrix

**Baseline:** `35b6503cfced27e9a5908a97154dca6693fdc424` (V5.6.0 HUMAN-PROVEN, PRE-AI)  
**Rule:** If the architecture spec differs from proven V5.6, preserve V5.6 and record the mismatch.  
**Phases:** AI-0 = this freeze. Later phases are not implemented here.

Legend: **EXISTS** = production behavior reusable as-is. **PARTIAL** = exists but missing a layer. **MISSING** = no implementation.

| CAPABILITY | EXISTS | PARTIAL | MISSING | CURRENT IMPLEMENTATION | REUSE PLAN | NEW WORK REQUIRED | RISK | PHASE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Canonical project state | ● | | | `Session.project: Project` owned by `App` `useState`. Create: `createEmptyProject`. Mutate: session `apply*` + core. Serialize: `serializeProject`. Restore: `deserializeProject` + `hydrateProject`. | Reuse `Project` / `Session` as the only canonical store. | None for state ownership. | High if a second store is invented. | — |
| Stable IDs | ● | | | `createId(prefix)` → `prefix_${uuid}`. See stable-ID table in recon report. | Address AI tools by these ids only (LAW-05). | Reject display-name targeting. | Medium: labels `A3` ≠ id `a_*`. | AI-5 |
| Project revision | | | ● | `schemaVersion: 5` + `updatedAt` only. Dirty = history stack lengths. | Do not misuse `updatedAt`. | Add `projectRevision` incremented in `withHistory` (ADR-001). | High: stale Apply without it. | AI-6 |
| Named commands | ● | | | `EditorCommand` + `applyCommand` (`src/app/commands.ts`). Comment reserves a future AI path. | This **is** the command abstraction. Do not invent a Command Bus. | Wrap remaining direct `apply*` (gain via `applyUpdateClip`, track volume) as commands if AI must call them. | Medium: incomplete command coverage. | AI-6/7 |
| Undo | ● | | | Snapshot stack `HistoryStack.past` via `structuredClone`. `applyUndo` → `undo`. | Reuse snapshots. AI commit = one `withHistory`. | None for single commands. | Low. | — |
| Redo | ● | | | `HistoryStack.future`. Cleared on new `pushHistory`. | Reuse. | None. | Low. | — |
| Compound / semantic transaction | | ● | | Ad hoc: `applyCut`, multi-clip enable, stem import, drag commit, volume-write commit each push **one** snapshot. No `applyCommandBatch`. | Pattern exists; no API. | Smallest layer: run N mutations on one `Project`, one `withHistory`. | High for multi-tool Apply without it. | AI-6/9 |
| Preview ≠ commit | | ● | | Drag-base overlay (`dragBaseRef`), `previewMoveVolumeAutomationPoint`, volume-write gesture. Mute/scene/fader commit immediately. | Adopt drag-base + cloned session (ADR-002). | Transaction object holding draft `Project` without assigning `session.project`. | High if preview writes canonical state. | AI-6/7 |
| Event bus / subscribe | | | ● | React `setSession` + prop drill. No EventEmitter/Context. | Do not poll playhead. | Optional in-process listener wrapping `setSession` for context cache. **Must not** network on playhead. | High if playhead triggers provider calls. | AI-4 |
| Panel / layout infrastructure | ● | | | Fixed flex layout + collapse + splitters + overlays. No docking framework. Layout keys `resonance-studio-v5-5*`. | Attach Director as Inspector section or overlay (recon §7). | AI-1 UI only. Do not add a dock manager. | Medium: “dockable” spec vs fold/overlay reality. | AI-1 |
| Settings | | ● | | Implicit: layout localStorage + fields on `Project` (snap, loop, zoom). No Settings panel. | New AI prefs key, separate from Project. | Settings → AI subtree later. | Low for AI-1 placeholders. | AI-2 |
| Secure secrets | | | ● | No keychain. Tauri fs+dialog only. | SecretStore port (ADR-004). | OS credential plugin + capability. | Critical if keys hit JSON/logs. | AI-2 |
| Audio analysis | ● | | | `analysisAudioClipAt`, `AudioFeatures`, `createFeatureExtractor` / offline FFT, `applyVisResponse`. Session-cached, not persisted. | Read-only tool wraps existing extractors. | Summary DTO without raw PCM/spectrum by default. | Medium: live AnalyserNode is non-deterministic; export/offline is. | AI-5 |
| Automation read/write | ● | | | Track-owned `VolumeAutomation` `{enabled, points[{timeMs,value}]}`. `automationValueAt` deterministic. No lane id. | `automation.read` → `volumeAutomationOf` + filter by time. Write later via existing point APIs. | Map spec `automationLaneId` → `trackId` + volume kind. | Medium: only VOLUME exists. | AI-5/10 |
| Render / export jobs | | ● | | Ephemeral `ExportJob.id = createId("job")`. Dialog FSM in `exportDialog` React state. IN/OUT range, not selection. | `jobFromProject` as read-only plan. | Job registry + `render.preview` grant. **Do not modify AFE/ENC.** | High if AI blocks encode loop. | AI-13 |
| Context snapshots | | | ● | No `ContextSnapshot` runtime. Data exists on `Session`. | Build from `Project` + `selectionOf` + playhead. | Context engine + privacy class. | Medium: over-sharing media. | AI-4 |
| MCP / tool server | | | ● | No MCP. In-process `applyCommand` only. | Function table first (ADR-005). | Schemas already drafted under `contracts/`. | High if a second mutation engine appears. | AI-5 |
| Provider abstraction | | | ● | No providers, no chat, no SDKs. Contracts only: `AIProvider`. | Keep vendor code out of `src/core`. | AI-2 chat; AI-3 local. | High vendor lock-in if skipped. | AI-2 |
| Audit log | | | ● | `Session.status` / `error` strings only. | New append-only log, redact secrets. | AI-6. | Medium: claim vs action confusion. | AI-6 |
| Permissions / grants | | | ● | Human UI is unrestricted (ordinary editor). | Grants are AI-only. | Policy table + evaluation order. | High if Agent mode ships without it. | AI-6 |
| Human approval | | ● | | Human is the only mutator today. Export/new/open confirm where dirty. | Extend confirm pattern to AI Apply. | Transaction card + policy AUTO/CONFIRM/DENY. | — | AI-6/7 |
| Playhead isolation | ● | | | RAF + `advancePlayhead`; no fetch/invoke per tick. | Preserve. Cache only. | Guard tests: context subscribe ≠ network. | Critical if broken. | AI-4 |
| Conversation store | | | ● | None. | LAW-10: Resonance-owned, not provider-owned. | AI-1 local mock; persist later beside Project. | Low for AI-1. | AI-1 |
| Director UI | | | ● | No AI panel. | Inspector/overlay attach. | AI-1 shell, feature-gated. | Layout regression. | AI-1 |

## Mismatches vs architecture spec v0.2 (preserve V5.6)

| Spec assumption | V5.6 fact | Decision |
| --- | --- | --- |
| “Existing Resonance Command Bus” | `EditorCommand` + `applyCommand` + session `apply*` | Reuse; do not add a bus object |
| `projectRevision` | Does not exist | ADR-001; add later |
| Event bus `selection.changed` | React state only | ADR-003; wrap later |
| Dockable panels | Flex + collapse + one VIS portal | Attach without a dock framework |
| Time in seconds | Canonical **milliseconds** | Convert at tool boundary |
| Generic automation lanes | Volume-only, no lane id | `trackId` + volume points |
| VIS is a track | `isTrackId("VIS")` is false | Separate vis event ids |
| Export job persistence | Ephemeral dialog job | Do not persist into Project |
| Mixer edits undoable | Mute/solo/volume/pan/master **not** in history | Preserve; do not silently wrap for AI without a dedicated slice |
| Implementation baseline V5.5 | This repo is **V5.6.0** | v0.3 spec uses V5.6 |
