# AI-0 Reconnaissance Report — Resonance Studio V5.6

**Status:** Architecture freeze. Docs + type-only contracts. No providers, MCP server, Director UI, or media-engine changes.  
**Baseline SHA:** `35b6503cfced27e9a5908a97154dca6693fdc424`  
**Product:** 5.6.0 · schema 5 · PRE-AI · not V6  
**Principle:** Own the Core. AI proposes. Resonance validates. Human approves. Resonance executes.  
**Method:** FACT → EVIDENCE → CONTRACT → GAP → DECISION

Companion files:

- `AI_0_V5.6_BASELINE_FREEZE.md`
- `AI_DIRECTOR_V5.6_GAP_MATRIX.md`
- `SECRET_STORAGE_CONTRACT_v0.1.md`
- `adr/ADR-001` … `ADR-005`
- `RESONANCE_AI_DIRECTOR_MCP_ARCHITECTURE_v0.3.md`
- `contracts/` (TypeScript schemas)

---

## 1. Version freeze

See `AI_0_V5.6_BASELINE_FREEZE.md`. Working tree was clean at `35b6503` before these docs. Tag `v5.6.0` is not in this checkout; product metadata and `docs/V5.6-RELEASE.md` still declare V5.6 HUMAN-PROVEN.

`tsconfig.json` `include` gained `docs/ai-director/contracts` so `tsc --noEmit` typechecks schemas. No runtime entry, no `src/` behavior change.

---

## 2. Canonical project state

### FACT — owner

**Runtime owner:** `Session` in `src/app/session.ts`, held by `App` via `useState<Session>` (`src/app/App.tsx` `App`).

**Canonical document:** `Session.project: Project` (`src/core/models.ts` `Project`).

There is no Redux, no Zustand, no event-sourced store.

### Created / mutated / serialized / restored

| Step | Symbol | File | Behavior |
| --- | --- | --- | --- |
| Create | `createEmptyProject` | `src/core/project.ts` | `id: createId("proj")`, default V1/V2/A1/A2, `schemaVersion: 5` |
| Session wrap | `createSession` | `src/app/session.ts` | Empty project + `createHistory()` + IDB blob store |
| Mutate (named) | `applyCommand` → `apply*` | `src/app/commands.ts`, `session.ts` | Returns new `Session` (immutable update) |
| Mutate (core) | `moveClip`, `splitAtPlayhead`, … | `src/core/timeline.ts` | Returns `{ project, error? }` |
| History | `withHistory` → `pushHistory` | `session.ts`, `timeline.ts` | Snapshots **pre-mutation** `Project` via `structuredClone` |
| Serialize | `serializeProject` / `projectJson` | `project.ts` / `session.ts` | Strips `objectUrl`; marks assets `missing: true`; keeps `sourcePath` |
| Deserialize | `deserializeProject` / `openSerialized` | `project.ts` / `session.ts` | Requires `schemaVersion === 5`; resets history |
| Hydrate media | `hydrateProject` / `hydrateSession` | `persistence.ts` / `session.ts` | Restores blobs from IDB; session-only `objectUrl` |
| Disk (Tauri) | `last-project.json` + user path | `last-project.ts`, `lib.rs` | Path memory, not the document itself |
| Dirty | `isProjectDirty` | `session.ts` | History length vs `savedPastLength` / `savedFutureLength` |

### Revision counter

**None.** Closest concepts: `schemaVersion: 5` (format) and `updatedAt` (ISO clock). See ADR-001.

### Entity map

| Object | Owner | Persist? | Notes |
| --- | --- | --- | --- |
| Project | `Session.project` | Yes (JSON) | `id` `proj_*` |
| Tracks | `Project.tracks` | Yes | V1/V2 stable literals; A1/A2 legacy; new audio `a_*` |
| Clips | `Project.clips` | Yes | `clip_*` |
| Automation | `Track.volumeAutomation` | Yes | No point id; identity = `trackId` + `timeMs` |
| VIS scene | `Project.visualizer.sceneId` | Yes | Catalog string, not a TrackId |
| VIS events | `visualizer.events[]` | Yes | `ve_*` |
| VIS cues | `visualizer.cues[]` | Yes | **No id** (`startMs` + `sceneId`) |
| Markers | `Project.markers` | Yes | `mk_*` |
| Transitions | `Project.transitions` | Yes | `tr_*` |
| Groups | `Project.groups` | Yes | `g_*`; collapse UI-only in localStorage |
| Render/export job | `jobFromProject` + `exportDialog` | **No** | Fresh `job_*` per run |
| Selection | `Session.selectedClipIds` etc. | **No** | View state |
| Playhead | `Project.playheadMs` | **Yes** (unusual vs typical DAW “view”) | Also IN/OUT, loop, snap, zoom, scroll |
| Write-arm / gesture | `Session.volumeWriteArmedIds` / `volumeWriteGesture` | **No** | Chrome only |
| Clipboard | `Session.clipboard` | **No** | |

---

## 3. Stable-ID table

Prefix generator: `createId(prefix)` in `src/core/ids.ts` (`crypto.randomUUID` or time+rand).

| OBJECT | CURRENT ID TYPE | PERSISTENT? | STABLE ACROSS SAVE/LOAD? | AI-SAFE? | GAP? |
| --- | --- | --- | --- | --- | --- |
| Project | `proj_${uuid}` `Project.id` | Yes | Yes (required by deserialize) | Yes | — |
| Video track | literal `"V1"` / `"V2"` | Yes | Yes | Yes | Fixed two picture lanes |
| Audio track (legacy) | `"A1"` / `"A2"` | Yes | Yes | Yes | Do not confuse with label `A3` |
| Audio track (new) | `a_${uuid}` `createAudioTrack` | Yes | Yes | Yes | Label `A3+` is **not** the id |
| Clip | `clip_${uuid}` | Yes | Yes | Yes | Primary AI target |
| Media asset | `asset_${uuid}` + durable `blobId` | Yes | Yes (`blobId` never a `blob:` URL) | Yes | `objectUrl` is session-only — not an id |
| Link pair | `link_${uuid}` `Clip.linkId` | Yes | Yes | Yes | Locking one side does not lock mate |
| Marker | `mk_${uuid}` | Yes | Yes (missing id regenerated — **unstable if omitted**) | Yes if present | Sanitize may `createId("mk")` on load if id missing |
| Transition | `tr_${uuid}` | Yes | Yes | Yes | — |
| Track group | `g_${uuid}` | Yes | Yes | Yes | Collapse set is UI-only |
| VIS event | `ve_${uuid}` | Yes | Yes, except rematerialize may reuse id when start+scene match | Yes with care | Cue rematerialize (`visualizer.ts`) |
| VIS cue | **no id** | Yes (array) | Identity is `startMs`+`sceneId` | **No** as a tool target | Need event id or add cue ids later |
| VIS scene | catalog string (`VisualizerSceneId`) | Yes | Yes | Yes as scene type, not instance | `SceneParams` not in Project |
| Automation lane | **no id** | Envelope on track | N/A | Use `trackId` + volume | Spec `automationLaneId` does not exist |
| Automation point | **no id** | Yes (time+value) | Time is the key | Use `trackId`+`timeMs` | Moving time changes identity |
| Export job | `job_${uuid}` | No | No | Session-only | Not for AI addressing across runs |
| History entry | none | No | N/A | No | Snapshot, not command id |
| AI transaction / conversation | none | — | — | — | Missing (contracts only) |

**DECISION:** Tools reject display names (`"Vocals"`, `"A3"`). Resolve UI references to the table above **before** provider submit.

---

## 4. Mutation / command architecture

### FACT — what exists

Not a message bus. A **typed command union** plus **session functions**.

```75:77:src/app/commands.ts
 * Named editor commands. UI keys/toolbar and a future AI path share this dispatch.
 * Timeline math stays in core; this is only the session entry.
```

```163:163:src/app/commands.ts
export function applyCommand(session: Session, command: EditorCommand): Session
```

```306:308:src/app/App.tsx
  const runCommand = useCallback((command: EditorCommand) => {
    setSession((s) => applyCommand(s, command));
  }, []);
```

`keys.ts`: “All mutations go through `applyCommand` except playhead seeks (`applyPlayhead`).” Some Inspector/mixer paths still call `apply*` directly (`applyTrackVolume`, `applyUpdateClip`, `applyPickVisualizerScene`).

**DECISION:** This is the existing command abstraction. Do **not** invent a Command Bus.

### Operation map

Format: UI EVENT → HANDLER → COMMAND/MUTATION → STATE OWNER → HISTORY → PERSISTENCE

| Operation | UI event | Handler | Command / function | State owner | Undo? | Persist in JSON? |
| --- | --- | --- | --- | --- | --- | --- |
| Move clip | Drag live / commit; nudge `,` `.` | `onMoveLive` / `onMoveCommit`; `nudgeClip` | Live: `applyCommand({type:"moveClips"})` on empty history; commit: manual `pushHistory`. Keyboard: `applyNudge` → `moveClipsByDelta`. Core: `moveClip` | `Project.clips[].startMs` | Yes (commit / nudge) | Yes |
| Split | S / Transport Split | `applySplit` | `{ type: "split" }` → `splitAtPlayhead` or `splitVisualizerAtPlayhead` | clips or VIS events | Yes | Yes |
| Delete | Delete / Backspace | `applyDelete` | `{ type: "liftDelete" }` → `deleteClips` / VIS / marker / lift range | clips / vis / markers | Yes | Yes |
| Copy/paste | Ctrl+C/V/X | `applyCopy` / `applyPaste` / `applyCut` | copy: session clipboard only; paste/cut: `pasteClips` / `deleteClips` | clipboard ephemeral; clips persist | Paste/cut yes; copy no | Clips yes |
| Clip gain | Inspector | `applyUpdateClip` | **Not** an `EditorCommand` | `Clip.gain` (linear) | Yes (`withHistory`) | Yes |
| Fade | Inspector / handles | `applySetClipFades` | `{ type: "setClipFades" }` → `setClipFades` | `fadeInMs`/`fadeOutMs` | Yes | Yes |
| Mute | Mixer / header M | `applyToggleMute` | `{ type: "toggleMute" }` → `toggleTrackMute` | `Track.muted` | **No** | Yes |
| Solo | Mixer / header S | `applyToggleSolo` | `{ type: "toggleSolo" }` | `Track.solo` | **No** | Yes |
| Track volume | Mixer fader | `applyMixerVolume` / `applyTrackVolume` | Direct session; not `EditorCommand` | `Track.volume` | **No** (unless write-arm commits G) | Yes |
| Automation write | VOL lane / W | point commands / `applyCommitVolumeWrite` | `add/move/deleteVolumeAutomationPoint`; write punch | `Track.volumeAutomation` | Yes on commit | Yes |
| VIS scene | Menu / cycle | `applyPickVisualizerScene` / `applyCycleVisualizerScene` | **Not** history-wrapped | `visualizer.sceneId` / events / cues | **No** | Yes |
| Marker add/rename/delete | M / Inspector | `applyMarker` / `applyRenameMarker` / delete | named commands | `Project.markers` | Add/rename/delete yes | Yes |
| Marker move | Drag | `applyMoveMarker` | Updates project **without** `withHistory` | `Marker.timeMs` | **No** | Yes |
| Transitions | Inspector | `applySetTransition*` | named commands → `upsertTransition` | `Project.transitions` | Yes | Yes |
| Export start | Export dialog Start | `startExport` | `jobFromProject` → `runExportWithDestination` | `exportDialog` React state | N/A | Output file only |

### Command-model verdict

| Pattern | Present? |
| --- | --- |
| Command bus object | No |
| Command objects (`EditorCommand`) | **Yes** |
| Reducer/action model | Session functions return next state (reducer-like, not a store) |
| Direct state mutations | Yes for mixer/transport/view/VIS scene/marker move |
| Transaction-like grouping | Ad hoc single `withHistory` in some apply* |
| Undoable semantic commands | Snapshot undo of whole `Project`, not inverse ops |

---

## 5. Undo / Redo / History

### FACT

```36:74:src/core/timeline.ts
export interface HistoryStack { past: Project[]; future: Project[]; }
export function pushHistory(...) { past: [...history.past, structuredClone(project)], future: [] }
export function undo(...) // pop past → current project; clone current onto future
export function redo(...) // symmetric
```

`withHistory(session, nextProject, status)` pushes **current** `session.project`, then assigns `nextProject`.

Restore = replace entire `Project`. Compound grouping = “don’t call `withHistory` until the batch is done” (see `applyCut`). Mid-edit failure: return original session, no push. Undo during volume-write: `applyAbortVolumeWrite` (gesture discarded). Drag preview never pushed until commit.

### Can an AI transaction become ONE semantic undo step?

**PARTIAL.**

- **YES path:** one `withHistory(session, finalProject, "AI — …")` after applying N core mutations to a working `Project` — same as `applyCut` / stem import / write-volume commit.
- **Missing layer:** `applyCommandBatch` / transaction flag. N sequential `applyCommand` calls → N undo steps.
- **NO** if AI calls `runCommand` in a loop without a batch wrapper.

Tests: `tests/timeline/timeline.test.ts`, `tests/app/commands.test.ts`, `tests/app/project-dirty.test.tsx`, `tests/core/volume-write.test.ts`, plus feature-level undo tests (no `*undo*` filename).

---

## 6. Preview capability

Ranked in ADR-002. Summary:

1. **D overlay / drag-base** — `dragBaseRef` + empty history `applyCommand` (`App.tsx` `onMoveLive` / `onMoveCommit`)
2. **B cloned slice** — `structuredClone`, `previewMoveVolumeAutomationPoint`
3. **E write-gesture overlay** — `volumeWriteGesture`
4. **C simulate `applyCommand` on a cloned Session** — mechanically free, no named API
5. **A shadow engine** — does not exist; do not build

**DECISION:** AI-7 move-clip preview uses (1)+(2). Canonical `session.project` stays at base until Apply.

---

## 7. Project revision / conflict

**Assessment:** no usable `baseRevision` / `currentRevision` today.  
**Proposal:** ADR-001 (`projectRevision` incremented only with history pushes).  
Until then, `TRANSACTION_CONFLICT` cannot be implemented honestly.

---

## 8. UI / panel architecture

### FACT

Monolithic `App.tsx` stage: Preview | Inspector (h-split, collapsible) above Timeline | Mixer (width split, collapsible). Overlays: File drawer, Shortcuts, Export dialog. Floating: VIS scene browser portal (`createPortal` to `document.body`).

**No** docking framework, **no** Tauri child windows (`capabilities` windows: `["main"]`).

Layout persistence: `src/core/layout-prefs.ts` keys `resonance-studio-v5-5-*`. VIS overlay pos: `ailexsi.vis-browser-pos` (namespace mismatch).

### AI Director attach contract (do not build in AI-0)

Minimum disruption:

1. **Preferred:** section inside `#inspector-body` below `Inspector` — reuses collapse + `H_SPLIT_RATIO_KEY`.
2. **Acceptable:** overlay sibling like `ShortcutsOverlay` (`open` boolean, no new splitter).
3. **Avoid:** new width-ratio store; second window; embedding in `Preview.tsx` or export dialog.

Props contract (mirror Inspector):

- read: slices of `session` + layout flags
- write mutations: `runCommand(EditorCommand)` only
- write view/seek: existing `applyPlayhead` / select commands
- `disabled` when feature flag off — project must work with panel closed (MIG-06/07)

---

## 9. Event / observability

### FACT

No pub/sub. `addEventListener` is DOM (keys, pointers, resize, WebCodecs `dequeue`).

| EVENT | SOURCE | PAYLOAD | STABILITY | REUSABLE? |
| --- | --- | --- | --- | --- |
| selection.changed | `Session.selectedClipIds` / tracks / VIS / marker / vol point | ids | view | No subscriber; read `selectionOf` |
| playhead.changed | `Project.playheadMs` via `applyPlayhead` / RAF | ms | persisted field | Local only |
| track.changed | `Project.tracks` | Track | persisted | After apply* |
| clip.changed | `Project.clips` | Clip | persisted | After apply* |
| automation.changed | `Track.volumeAutomation` | envelope | persisted | After point/write commit |
| project.changed | whole `Project` | Project | persisted | Open/new/mutate |
| history.changed | `Session.history` | stacks | memory | undo/redo |
| render job | `exportDialog` | phase/percent/stage | ephemeral | `onProgress` callback only |

**Can AI Context Engine subscribe without polling?** Not today. Needs a wrapper around `setSession` (AI-4).  

**Playhead must never cause network traffic:** current RAF path has no `fetch`/`invoke`. Asset change may `fetch(blob:…)` once for PCM (`Preview.tsx` / `decodeAudio`) — local, not provider. Preserve this invariant (ADR-003).

---

## 10. Playback / audio / render boundaries

```
Main thread (React + WebView2 / Vite :1421)
  App RAF transport          playback.ts advancePlayhead
  Preview HTMLMedia + tap    playback-tap.ts AudioContext
  VIS canvas                 visualizer.ts renderVisualizerScene
  AFE decode + export loop   frame-engine/* + exporter/webcodecs.ts
  OfflineAudioContext AAC    exporter/audio.ts
IndexedDB                    persistence.ts
Tauri Rust                   fs scope + dialog only
Workers                      none
```

**Safe AI home:** `src/ai/*` + Director UI, talking to `applyCommand`.  
**Forbidden:** provider SDK in `core/timeline`, `core/playback`, `core/frame-engine`, `core/exporter`.  
**Do not modify AFE / mux / ENC.**

Least invasive host: in-process gated module (ADR-003). Sidecar later; interfaces must not block it.

---

## 11. Settings + secrets

See `SECRET_STORAGE_CONTRACT_v0.1.md` and ADR-004.  
No Settings panel. No OS secrets. Tauri capabilities are dialog + `$APPDATA` fs.

---

## 12. Automation / mixer / VIS (deterministic interfaces — not exposed)

| Domain | Read | Write | Notes |
| --- | --- | --- | --- |
| Automation | `volumeAutomationOf`, `automationValueAt`, `volumeAutomationIsActive` | `setTrackVolumeAutomation`, point add/move/delete, `setVolumeAutomationEnabled`, `punchVolumeWrite` | Linear gain; audio tracks only |
| Mixer fader | `trackVolumeOf` | `setTrackVolume` / `applyTrackVolume` | Not undoable |
| Mute/solo | `isTrackMuted`, `isTrackSoloed`, `isTrackAudible` | `toggleTrackMute` / `toggleTrackSolo` | Shared preview/export audible rule |
| Pan / master | `trackPanOf`, `masterVolume` | `setTrackPan`, `setMasterVolume` | Not undoable |
| VIS scene | `sceneAt`, `visualizerEventsOf` | `setVisualizerSceneAt`, `updateVisualizerEvent`, `applyPickVisualizerScene` | Scene pick not undoable |
| VIS params | `scene.defaultParams` | none in Project | `SceneParams` not persisted |
| Audio analysis | `analysisAudioClipAt`, `createOfflineFeatureExtractor`, `visFeaturesForPreview` / `Export` | n/a | Offline deterministic; live AnalyserNode not |

---

## 13. MCP read-tool mapping (no server)

| TOOL | CURRENT DATA SOURCE | CURRENT FUNCTION/API | INPUT ID REQUIREMENTS | OUTPUT SHAPE AVAILABLE? | MISSING CONTRACT? | RISK |
| --- | --- | --- | --- | --- | --- | --- |
| `project.describe` | `Session.project` | `projectDurationMs`, `trackIdsOf`, `Project.id/name` | none | Partial — no `revision` | Add `ProjectSummary` (contracts) | Low |
| `timeline.describe` | `Project.tracks/clips` | `orderedTracks`, `clipsOnTrack` | optional range ms | Yes as arrays | Compact DTO | Over-share if unscoped |
| `timeline.get_selection` | `Session` view | `selectionOf`, `selectedVisEventIds`, `selectedMarkerId` | none | Yes | Map to `SelectionContext` | Selection not in JSON |
| `timeline.get_clip` | `Project.clips` | `clipById` | `clipId` (stable) | Yes (`Clip`) | Reject unknown id | Hallucinated id |
| `audio.get_analysis` | Preview/export extractors | `analysisAudioClipAt`, `createOfflineFeatureExtractor`, `AudioFeatures` | `clipId` and/or `timeMs` | Yes, but live vs offline differ | Prefer offline; omit raw `spectrum` / PCM | Non-determinism if live tap used |
| `automation.read` | `Track.volumeAutomation` | `volumeAutomationOf`, filter points | `trackId` (+ optional ms range) | Yes | No `automationLaneId` | Wrong track kind (video) |

---

## 14. Golden task — `timeline.move_clip` (+2.000 s)

Prompt: “Move the selected clip exactly two seconds to the right.”

### Existing path (human, V5.6)

```
selectionOf(session) → clipId
clipById → startMs
desired = startMs + 2000
optional snap: snapTime(..., collectSnapTargets)
applyMove / applyMoveClips / moveClip
  locked? → "Clip is locked"
  missing? → "Clip not found"
  kind mismatch? → "Cannot move clip to a different kind of track"
  linked mate moves by same delta unless skipLink
withHistory → Undo "Moved clip"
serialize includes new startMs
```

Nudge keyboard uses `FRAME_MS` (1000/30), not 2000 ms. AI must pass an explicit delta, not a key repeat.

### Future AI path (not implemented)

```
User prompt
→ ContextSnapshot (selection + revision)          MISSING engine
→ provider                                        MISSING
→ timeline.get_selection                          MISSING tool, data EXISTS
→ clip-123 @ startMs
→ timeline.move_clip { clipId, targetStartSeconds: (startMs+2000)/1000 }
→ schema                                          MISSING
→ permission CONFIRM                              MISSING
→ semantic: clipById, !locked, start>=0           EXISTS (moveClip)
→ draft Project via moveClip on clone             EXISTS mechanically
→ preview overlay (drag-base pattern)             EXISTS for human drag; no AI txn
→ Human Apply
→ revision check                                  MISSING (ADR-001)
→ applyMove / applyCommand moveClips              EXISTS
→ audit                                           MISSING
→ one undo snapshot                               EXISTS if single withHistory
```

Seconds vs ms: spec input is seconds; `moveClip` is ms. Adapter: `targetStartMs = Math.round(targetStartSeconds * 1000)`.

Snap: human move snaps when `Project.snap`. Golden path “exactly +2.000s” must **disable snap** or pass already-absolute time and document snap off. **GAP:** `moveClip` itself does not snap; `applyMove` / drag live do. AI commit should call core `moveClip` with the exact ms to avoid snap drift.

---

## 15. Contracts

Type-only, `docs/ai-director/contracts/`:

- `ContextSnapshot`, `ResonanceToolDefinition`, `AIGrant`, `ToolRiskClass`, `AITransaction`, `NormalizedAIError`, `TimelineReference`, `AIRequest` / `AIResponse` / `AIProvider`
- `AITransaction.commands: EditorCommand[]` — reuses V5.6, does not invent `StudioCommand`

---

## 16–17. Gap matrix + ADRs + spec

See sibling files. ADRs only where inspection forced a choice (revision, preview, host, secrets, MCP transport).

---

## 18. Tests / non-regression

Recorded in the PR after Phase 18 commands. Production `src/**` (except none) and media modules were **not** edited. `tsconfig.json` include-list is the only build-config touch.

---

## 19. Changed files (this phase)

Documentation + contracts + `tsconfig.json` include. Exact list in the PR.

---

## 20. READY for AI-1?

See the closing verdict in the pull request description. The evidence-only answer is computed from this map plus green typecheck/tests/build.
