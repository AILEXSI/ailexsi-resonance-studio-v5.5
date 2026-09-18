# Resonance Studio AI Director + MCP Architecture

**Document:** `RESONANCE_AI_DIRECTOR_MCP_ARCHITECTURE_v0.3.md`  
**Status:** Architecture baseline after AI-0 repository reconnaissance  
**Date:** 2026-09-18  
**Implementation baseline:** Resonance Studio **V5.6.0** @ `35b6503cfced27e9a5908a97154dca6693fdc424`  
**Principle:** **Own the Core. AI proposes. Resonance validates. Human approves. Resonance executes.**

AI-0 reports (evidence, not opinions):

- `docs/ai-director/AI_0_V5.6_BASELINE_FREEZE.md`
- `docs/ai-director/AI_0_RECON_REPORT.md`
- `docs/ai-director/AI_DIRECTOR_V5.6_GAP_MATRIX.md`
- `docs/ai-director/SECRET_STORAGE_CONTRACT_v0.1.md`
- `docs/ai-director/adr/ADR-001-project-revision.md`
- `docs/ai-director/adr/ADR-002-preview-strategy.md`
- `docs/ai-director/adr/ADR-003-ai-host-placement.md`
- `docs/ai-director/adr/ADR-004-secure-credential-storage.md`
- `docs/ai-director/adr/ADR-005-mcp-internal-transport.md`
- `docs/ai-director/contracts/` (TypeScript schemas only)

---

## 0. Executive Summary

This document specifies the architecture required to add a provider-independent AI Director to Resonance Studio without coupling the media engine to any specific AI vendor.

The AI is **not** part of the trusted media engine. It is treated as a probabilistic external planner that may request actions only through typed, permissioned, validated tools.

**AI-0 finding:** V5.6 already has a typed mutation entry, snapshot undo, stable ids, and a human drag preview pattern. It does **not** have a command-bus object, a project revision counter, an event bus, a docking framework, MCP, providers, secrets, or Director UI. Later phases must extend these facts — not invent a parallel studio.

The intended control flow, mapped onto **real V5.6 symbols**:

```text
Human
  ↓
AI Director UI          (MISSING — AI-1; attach Inspector/overlay)
  ↓
Conversation + Context  (MISSING — AI-1/AI-4)
  ↓
AI Orchestrator         (MISSING — AI-2)
  ↓
Provider Adapter        (MISSING — AI-2; never in src/core)
  ↓
AI Model
  ↓ tool request
Resonance tool table    (MISSING — in-process first, ADR-005)
  ↓
Schema / permission / semantic validation
  ↓
AI Transaction Manager  (MISSING — AI-6)
  ↓
applyCommand / session apply* / core timeline   ← EXISTS
  ↓
Deterministic Resonance Core                    ← EXISTS (do not fork)
```

The first implementation must **not** attempt autonomous production, multi-agent orchestration, unrestricted filesystem access, shell execution, or direct project mutation. The first objective is a narrow vertical slice proving that a model can safely understand a selection, request one edit, preview it, obtain approval, commit it, audit it, and undo it.

---

## 0A. V5.6 Baseline Declaration

**Implementation baseline: Resonance Studio V5.6.0** (`ailexsi-resonance-studio-v5.5` repository, product version 5.6.0, JSON `schemaVersion` 5).

AI Director + MCP is a **controlled extension of the proven V5.6 core**, not a V6 rewrite. V5.6 **replaces** the v0.2 wording that named V5.5 as baseline. Media, render, timeline, playback, project-state, command, persistence, and UI behavior at `35b6503` is the compatibility baseline.

If this document and the repository differ, **preserve proven V5.6 behavior** and update the mapping here instead of silently building parallel infrastructure.

**Non-regression rule:** AI Director, provider integration, MCP, context, permissions, transactions, and audit are additive layers. Existing V5.6 functionality must remain operational when AI is disabled, disconnected, unavailable, or completely unconfigured.

**Versioning rule:** Implementing this architecture does not itself make Resonance Studio V6. Product-version promotion is a separate decision after integration and acceptance.

**Identity leftovers (not a downgrade):** npm name `@ailexsi/resonance-studio-v5.5`, Tauri id `com.ailexsi.resonance-studio-v5-5`, storage prefix `resonance-studio-v5-5*` isolate this tree from original V5. Product chip is `V5.6.0`.

## 0B. Specification Changelog

### v0.3

- Implementation baseline corrected to **Resonance Studio V5.6**.
- Recorded AI-0 repository facts: `EditorCommand`/`applyCommand` is the command abstraction; snapshot `HistoryStack`; no `projectRevision`; no event bus; no dock framework; times are milliseconds; automation is track-owned volume only; VIS is not a `TrackId`.
- Preview strategy ranked against existing drag-base / clone / write-gesture code (ADR-002).
- Revision, AI Host, secrets, and MCP transport decided as ADRs (docs only).
- Tool contracts adapted to V5.6 types (`EditorCommand`, `Clip`, `TrackId`, `AudioFeatures`).
- Source-layout suggestion adapted to `src/app` + `src/core` + future `src/ai` (gated).

### v0.2

- Corrected the implementation baseline to Resonance Studio V5.5 (superseded by v0.3 / V5.6).
- Declared AI Director + MCP an additive extension, **not a V6 rewrite**.

### v0.1

- Initial AI Director + provider abstraction + MCP + transaction architecture specification.

## 0C. AI-0 repository mapping (resolved mismatches)

| v0.2 assumption | V5.6 fact | Resolution |
| --- | --- | --- |
| Existing Command Bus | `EditorCommand` + `applyCommand(session, command)` + session `apply*` + core functions | **Reuse.** Do not add a bus object. |
| `projectRevision` | Absent (`schemaVersion` + `updatedAt` + history lengths only) | **Preserve V5.6.** Add revision later (ADR-001). |
| Studio event bus | React `setSession` only | **Preserve.** Optional wrapper in AI-4; playhead must not network. |
| Dockable panels | Flex + collapse + splitters; VIS portal float | Director follows Inspector/overlay (not a new dock). |
| Seconds as canonical time | `*Ms` everywhere | Tool JSON may use seconds; adapters convert to ms. |
| Generic automation lanes | `Track.volumeAutomation` points; no lane id | Tools use `trackId` + time range. |
| VIS as track | `isTrackId("VIS") === false` | VIS events `ve_*`; cues have no id. |
| Export jobs persist | Ephemeral `createId("job")` + dialog FSM | Do not write jobs into `Project`. |
| Mixer edits undoable | Mute/solo/volume/pan/master **not** in `withHistory` | Preserve. Do not silently wrap for AI. |
| Playhead is view-only | `playheadMs` **is** in `Project` JSON | Context may read it; do not treat seek as a mutation grant. |

---

# 1. Architectural Goals

## 1.1 Primary goals

1. Add an AI chat/director panel to Resonance Studio.
2. Make AI providers interchangeable.
3. Support local/offline AI as a first-class option.
4. Give AI structured awareness of the current project, timeline, selection, tracks, clips, automation, audio analysis, and later video/visual state.
5. Expose Resonance capabilities as typed tools through an MCP-compatible boundary.
6. Prevent AI models from directly mutating internal state.
7. Route every mutation through existing deterministic Studio commands (`applyCommand` / documented `apply*`).
8. Require validation and permissions before execution.
9. Make AI edits transactional, previewable, rejectable, auditable, and undoable.
10. Preserve human creative authority.
11. Avoid vendor lock-in.
12. Allow future external MCP clients without creating a second control architecture.

## 1.2 Non-goals for the first release

The first release does **not** include:

- unrestricted autonomous editing
- shell access
- arbitrary filesystem access
- arbitrary network access
- script execution
- plugin installation
- autonomous overwrite/export policies
- multi-agent swarms
- AI-written direct mutations of project JSON/state
- provider-specific logic inside the Resonance Core
- mandatory cloud services
- mandatory OpenAI dependency
- training/fine-tuning infrastructure
- autonomous long-running creative direction without user checkpoints

AI-0 additionally does **not** implement providers, chat, MCP server, mutation tools, Director UI, or API keys.

---

# 2. Core Architectural Laws

These rules are invariants. Implementation convenience is not a valid reason to violate them.

## LAW-01 — Own the Core

The Resonance Core remains provider-independent and deterministic.

## LAW-02 — AI is untrusted

No model, including a local model, crosses the trust boundary merely because it runs on the user's machine.

## LAW-03 — No direct mutation

AI code must never directly alter:

- timeline state
- clip state
- track state
- automation state
- mixer state
- project serialization
- media files

Mutations must use existing or explicitly added Studio Commands (`EditorCommand` / session `apply*` that already wrap core).

## LAW-04 — MCP/tools are adapters, not a second engine

Tool handlers translate validated tool requests into Resonance commands. They must not duplicate editor business logic. They must not reimplement `moveClip`, mix rules, or AFE.

## LAW-05 — Stable IDs define identity

AI actions address `projectId`, `trackId`, `clipId`, `effectId` (when one exists), automation via `trackId`+time (no lane id today), `markerId`, later `transactionId` / `conversationId`. Display names are not identifiers. Track label `A3` is not `a_*`.

## LAW-06 — Fail closed

Ambiguity, stale state, invalid schemas, missing permissions, unsupported operations, or unresolved targets result in rejection rather than guessing.

## LAW-07 — Mutation is transactional

A multi-command AI edit either commits coherently or leaves the project unchanged.

**AI-0:** V5.6 can do this for a **single** `withHistory` snapshot. Sequential `applyCommand` calls are **not** atomic. Compound API is PARTIAL (gap matrix).

## LAW-08 — Preview is not commit

A preview must not silently mutate canonical project state.

**AI-0:** Human clip-drag already separates live overlay vs history commit (`dragBaseRef`). AI must follow that pattern, not mute/scene-pick (immediate write).

## LAW-09 — Human approval is policy-controlled

The user controls which actions are automatic, confirmation-required, or denied.

## LAW-10 — Conversation belongs to Resonance

Provider APIs receive request context. They do not own the canonical conversation history.

## LAW-11 — Secrets never enter project data

API keys/tokens must never be stored in project files, normal logs, prompts, exported diagnostics, or Git. See `SECRET_STORAGE_CONTRACT_v0.1.md`.

## LAW-12 — Provider failure must not endanger media state

A crashed, disconnected, rate-limited, or hallucinating model cannot corrupt the project.

---

# 3. High-Level System Architecture (V5.6-mapped)

```text
┌──────────────────────────────────────────────────────────────────┐
│ RESONANCE STUDIO V5.6                                             │
│ Timeline | Mixer | Preview | Inspector | VIS | [AI Director]     │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                     App.tsx useState<Session>
                               │
             ┌─────────────────┴─────────────────┐
             │                                   │
             ▼                                   ▼
     Existing Studio UI                    AI Director UI (AI-1)
             │                                   │
             │                          Conversation Manager
             │                                   │
             │                             Context Engine
             │                                   │
             │                            AI Orchestrator
             │                                   │
             │                            Provider Registry
             │                                   │
             │                             Tool Requests
             │                                   │
             │                    In-process tool table (AI-5)
             │                    later: MCP transport (AI-14)
             │                                   │
             │                            Schema Validator
             │                                   │
             │                           Permission Service
             │                                   │
             │                           Semantic Validator
             │                                   │
             │                         AI Transaction Manager
             │                                   │
             └───────────────────────────┬───────┘
                                         ▼
                          applyCommand / documented apply*
                                         │
                                         ▼
                    core/timeline + project + visualizer + volume-*
                                         │
                    playback / AFE / exporter   (AI must not enter)
```

Canonical state: `Session.project: Project`.  
Named commands: `src/app/commands.ts`.  
History: `HistoryStack` full-project snapshots.  
Export/AFE: off-limits except read-only `jobFromProject` planning much later.

---

# 4. Trust Boundary

```text
UNTRUSTED / PROBABILISTIC

AI Provider / Model
        │
AI Orchestrator
        │
Tool Request
        │
══════════════════════════════════════
            TRUST BOUNDARY
══════════════════════════════════════
        │
Schema Validation
        │
Permission Check
        │
Semantic Validation
        │
Revision / Conflict Check   (missing until AI-6 / ADR-001)
        │
Transaction Manager
        │
applyCommand / core
        │
Deterministic Resonance Core
```

No provider can bypass this boundary.

---

# 5. AI Director UI

## 5.1 Purpose

The AI Director is the human-facing control surface for AI interaction. It is not a provider-specific chat widget.

**V5.6 attach (AI-0 contract, not built):** implement as a standard Resonance **panel section** using existing layout behavior:

- Inspector collapse (`INSPECTOR_COLLAPSED_KEY`)
- Preview↔Inspector h-split (`H_SPLIT_RATIO_KEY`)
- or a `ShortcutsOverlay`-style modal (`open` flag)

There is no generic dock/undock/float manager. Do not add one for AI-1. The VIS browser portal is a special-case overlay, not a panel system to extend.

## 5.2–5.4

Unchanged in intent from v0.2: ASK / DRAFT / AGENT modes; required widgets listed in v0.2 §5.3 remain the AI-1/AI-2 shell target. **Do not implement in AI-0.**

---

# 6–11. Conversation, providers, local AI, credentials, context, privacy

Intent unchanged from v0.2. Concrete V5.6 bindings:

- Conversation types stay Resonance-owned (LAW-10). Persist **beside** `Project` (MIG-09), never inside `schemaVersion` 5 documents until a versioned additive field is accepted.
- Provider interface: `docs/ai-director/contracts/provider.ts` (`AIProvider`, `AIRequest`, `AIResponse`). No adapters in AI-0.
- Secrets: `SECRET_STORAGE_CONTRACT_v0.1.md` / ADR-004. No Settings tree exists yet.
- Context snapshot: `docs/ai-director/contracts/context.ts`. Times in **ms**. `projectRevision` is proposed, not on `Project`.
- Context cache events (`selection.changed`, `playhead.changed`, …) **do not exist** as a bus. AI-4 may wrap `setSession`. **Playhead must never automatically cause network traffic.**
- Raw audio/video never inserted casually. Prefer `AudioFeatures` summaries (`rms`, `bass`, `mid`, `treble`, `onset`, `beatPulse`) from offline extractors — not live `AnalyserNode`.

---

# 12. MCP / Resonance Tool Surface

## 12.1 Role

The tool layer is the official AI-addressable interface. In V5.6 it starts as an **in-process function table** (ADR-005), not a listening MCP server.

Handlers translate typed requests into `applyCommand`, session `apply*`, or read-only core getters.

## 12.2 Naming

`namespace.action` — unchanged (`project.describe`, `timeline.move_clip`, …).

## 12.3 Tool metadata

`ResonanceToolDefinition` lives in `docs/ai-director/contracts/tools.ts`.

## 12.4 Initial read tools — V5.6 sources

| Tool | Grant | V5.6 source |
| --- | --- | --- |
| `project.describe` | READ | `Project` + `projectDurationMs` |
| `timeline.describe` | READ | `orderedTracks` / `clips` |
| `timeline.get_selection` | READ | `selectionOf(session)` + VIS/marker selection |
| `timeline.get_clip` | READ | `clipById` |
| `audio.get_analysis` | READ | `analysisAudioClipAt` + offline `AudioFeatures` |
| `automation.read` | READ | `volumeAutomationOf` / points |

## 12.5 Initial mutation tools

`timeline.move_clip` remains the **only** first mutation (AI-7). Input may use `targetStartSeconds`; adapter converts to `startMs` and calls `moveClip` / `applyMove` **without snap** for the golden +2.000 s path.

Other mutations (`split`, `set_gain`, `set_fade`, `automation.write`, `render.preview`, `history.undo`) stay phased as in v0.2. Clip gain today is `applyUpdateClip` (not an `EditorCommand`); extract a command **before** exposing `audio.set_gain` (MIG-03).

---

# 13. Stable Object Identity

See recon stable-ID table. Required categories vs V5.6:

| Spec id | V5.6 |
| --- | --- |
| projectId | `proj_*` |
| trackId | `V1`/`V2`/`A1`/`A2`/`a_*` |
| clipId | `clip_*` |
| effectId | **none** |
| automationLaneId | **none** — use `trackId` |
| markerId | `mk_*` |
| renderJobId | ephemeral `job_*` |
| transactionId / conversationId | **none yet** |

A tool must reject ambiguous display-name targeting.

---

# 14–15. Permissions and semantic validation

Intent unchanged. Evaluation order unchanged. Semantic checks **must reuse** core errors (`"Clip not found"`, `"Clip is locked"`, …) rather than a second validator that can drift.

Add V5.6-specific rejects: locked clip, track kind mismatch, video track has no volume automation, missing `clipId`, negative time.

---

# 16. AI Transaction System

Data model: `docs/ai-director/contracts/transaction.ts`.

**`commands` is `EditorCommand[]`**, not an invented `StudioCommand[]`.

Lifecycle unchanged from v0.2 (proposal → draft → validate → preview → apply → revision check → commit → audit → undo).

Atomicity: if more than one command, implement a single `withHistory` wrapper **before** enabling compound AI edits (AI-9). Do not ship multi-command Apply on N history entries and call it a transaction.

---

# 17. Preview Architecture

Preview is a core requirement. Canonical project unchanged until commit.

**Chosen strategy (ADR-002):** temporary overlay + cloned `Project`, matching `dragBaseRef` / `onMoveLive` / `onMoveCommit` and `previewMoveVolumeAutomationPoint`.

Rejected as first implementation: a second media engine / shadow graph.

A/B (AI-11) can later pass an alternate `project` prop into existing `Preview.tsx`.

---

# 18. A/B Comparison

Requirements unchanged: A = canonical, B = preview transaction; no hidden commit; reject retains A.

---

# 19. Undo / Redo Integration

An AI transaction is a semantic undo unit.

V5.6 restore is **full Project snapshot**, not inverse commands. That already restores exact pre-transaction state if Apply used one `withHistory`. Redo reproduces that snapshot if the user has not pushed a newer edit (future stack cleared on new push — existing semantics; do not change).

---

# 20. Project Revision and Conflict Detection

v0.2 API (`projectRevision`, `baseRevision`, `TRANSACTION_CONFLICT`) is **accepted as the future contract**.

**AI-0:** the field does not exist. Do not fake it with `updatedAt` or `schemaVersion`. Implementation plan: ADR-001.

---

# 21–25. Audit, tool activity, timeline references, jobs, usage

Intent unchanged. Audit must distinguish AI statement / proposal / tool request / deterministic result / user approval / committed change. Redact secrets.

`TimelineReference` uses **ms** in contracts; UI formats via `formatTimecode`.

Export is already a cancellable dialog job (`ExportDialogPhase`, `AbortSignal`). `render.preview` (AI-13) must not block chat and must not call into AFE internals.

---

# 26. Process Isolation

**AI-0 decision (ADR-003):** logical isolation in `src/ai/*` + Director UI. Same JS process as V5.6.

```text
Resonance Desktop (WebView2 / Vite)
├── Studio Core (session, timeline, playback, AFE, export)
└── AI Host Layer (gated; no AFE/export imports)
```

Future physical isolation (sidecar / Worker) is allowed but not required for AI-1–AI-7. Interfaces must not prevent it.

Tauri Rust remains FS/dialog only unless a later secret plugin is added (ADR-004).

---

# 27. External MCP Clients

Unchanged: same schemas, ids, permissions, transactions, revision, audit. Deferred to AI-14. Internal table first (ADR-005).

---

# 28. Suggested Source Layout (adapted to V5.6)

Do not force a parallel tree over `src/app` / `src/core`.

```text
src/
├── app/            Session, commands, App.tsx, keys   ← existing, keep
├── core/           Project, timeline, playback, AFE   ← existing, keep
├── ui/             panels                             ← existing, keep
└── ai/             NEW, feature-gated, empty until AI-1+
    ├── director/
    ├── orchestrator/
    ├── context/
    ├── providers/          ← adapters only; no core imports of SDKs
    ├── permissions/
    ├── transactions/
    └── tools/              ← handlers → applyCommand
docs/ai-director/
├── contracts/              ← AI-0 schemas (this freeze)
└── adr/
```

v0.2’s `src/mcp/server.ts` is **not** created in early phases.

---

# 29. Migration Rules for Existing Resonance V5.6

MIG-01 … MIG-10 from v0.2 remain in force with “V5.6” substituted for “V5.5”:

- Existing playback, timeline, renderer, import, editing, automation, and project behavior remain the baseline.
- Before adding an AI mutation tool, identify the existing command path.
- If no clean command exists, extract it and test **before** exposing it to AI (`audio.set_gain` is this case).
- Do not modify renderer internals to accommodate chat.
- Do not mix provider SDK code into timeline/audio/render modules.
- Preserve the non-AI workflow. Feature-gate AI. Old projects open with AI off. AI metadata separate/versioned. No migration may require cloud connectivity.

---

# 30. Implementation Phases

Phase list **unchanged** in order and intent.

**AI-0 (this document set) — complete when:** reconnaissance, contracts, ADRs, gap matrix, v0.3 spec, and non-regression gates are done. No provider integration before review.

**AI-1** — Director shell only. Attach per §5.1. Mock conversation. No model.

**AI-2+** — as v0.2 (provider chat, local provider, context, read tools, transactions, `timeline.move_clip` golden path, …).

Golden path, 12 consecutive runs, and “no second mutation before move-clip gate” remain binding.

---

# 31–36. Tests, observability, performance, local packaging, benchmark, definition of done

Unchanged in intent. Add: existing V5.6 tests (`tests/app/commands.test.ts`, timeline/history, volume-write, project-dirty, layout) stay mandatory. Playhead RAF must not grow network calls. Context generation must not scan entire media on every message.

Definition of Done checklist from v0.2 §36 remains the foundation bar — **none** of those boxes are checked at AI-0 except “stable IDs exist in the core” and “non-AI workflows remain functional.”

---

# 37. Architecture Decision Checklist — AI-0 answers

1. **Canonical owner:** `Session.project` (`session.ts`), React-owned in `App`.
2. **Command abstraction:** `EditorCommand` + `applyCommand` + `apply*`.
3. **Undoable operations:** those that call `withHistory` / drag-commit / volume-write commit. Not mute/solo/static fader/pan/master/IN-OUT/VIS scene/marker-move/playhead.
4. **History:** `HistoryStack` of cloned `Project`s.
5. **Revision:** none. ADR-001.
6. **Panel layouts:** `layout-prefs.ts` + `App.tsx` splitters/collapse.
7. **Audio playback thread:** main JS; HTMLMediaElement + shared `AudioContext` tap.
8. **Render thread:** main JS WebCodecs + AFE. No worker.
9. **Event bus:** none.
10. **Settings:** layout localStorage + project fields. No Settings UI.
11. **Secure credentials:** none. ADR-004.
12. **IDs:** `createId`; table in recon report.
13. **Simulate commands:** yes — `applyCommand` is a pure function; drag-live already does this.
14. **Preview strategy:** drag-base overlay + clone (ADR-002).
15. **Compound atomicity:** one `withHistory` after batched core mutations (PARTIAL API).
16. **Protective tests:** `tests/app/commands.test.ts`, `timeline.test.ts`, `project-dirty.test.tsx`, volume-write/automation, layout/inspector tests.
17. **AI Host:** `src/ai/*` in-process, gated (ADR-003).
18. **Child/sidecar:** Tauri has no sidecar today; do not require one for AI-1–7.

---

# 38–40. Implementation order, golden path, failure semantics

Sequence from v0.2 §38 stands. Golden path §39 stands, with units:

```text
Selected clip startMs: 30000
timeline.move_clip targetStartSeconds: 32.000
adapter → moveClip(..., 32000)
```

Revision 100/101 is illustrative until `projectRevision` exists.

Failure catalogue unchanged (hallucinated tool, invalid id, ambiguous name, stale preview, provider crash). Add V5.6 codes used by `moveClip`: locked, kind mismatch.

---

# 41–42. Future expansion and final statement

Unchanged: intelligence/provider/model/tool catalogue can change. The deterministic Resonance Core remains the stable center.

**Own the Core.**

---

# Appendix A — Initial Tool Catalogue

Unchanged table from v0.2. First mutation remains `timeline.move_clip` in AI-7.

# Appendix B — Normalized Error Catalogue

Unchanged, plus `CLIP_LOCKED`, `TRACK_KIND_MISMATCH` (`docs/ai-director/contracts/errors.ts`).

# Appendix C — ADRs written in AI-0

Only genuine inspection choices:

- ADR-001 project revision
- ADR-002 preview strategy
- ADR-003 AI Host placement
- ADR-004 credential storage
- ADR-005 MCP internal transport

Ceremonial ADRs (provider abstraction, conversation persistence, local runtime, external MCP auth, raw-media policy) are **deferred** until those phases start.

# Appendix D — Release Principle

Unchanged: a fluent model sentence is not done. The chain intent → context → tool → validation → permission → transaction → preview → approval → command → commit → audit → undo must be explicit.
