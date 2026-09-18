# LEXI family — premium VIS library + scene browser

**Status:** **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** as part of V5.6 2026-09-18. Ready to consolidate into main (coordinator merges the V5.6 tip).

**Product goal:** LEXI is a coherent premium visual system inside Resonance Studio V5.6 — a scalable library and a real scene browser — not “one more VIS scene.”

VIS + LEXI library + UI only. ENC / STRESS / AUDIO / AFE / mux / 2h buffer architecture are untouched.

## Purpose

LEXI is the AILEXSI signature visual language: dark cinematic space, gold/amber energy, flowing terrain, restrained bloom, musical response via the shared `applyVisResponse` packet (Preview === Export).

This pass **consolidates every existing LEXI implementation** into one library. Older tips are **not discarded**. Each inventoried variant is a separately selectable scene.

## Five families

| Family | Role | Implemented scenes this pass |
| --- | --- | --- |
| **FLOW** | Living energy landscape / horizon / dunes | All retained LEXI versions (see below) |
| **GEOMETRY** | Structured form (future) | none yet — family is present in the browser |
| **SYNTHWAVE** | Retro-future night drive (future) | none yet |
| **PARTICLE / NEBULA** | Particle / nebula fields (future) | none yet |
| **STAGE** | Performance / title-safe stage (future) | none yet |

Do not manufacture dozens of new scenes to fill empty families. Empty families stay clickable and say so.

## Implemented scenes (retained)

Every distinct stack variant remains selectable. V2 polish (`lexi-v2`) and LEXI Minimal Horizon (`lexi-minimal`) are **not** the same renderer — both are kept.

| Id | Display | Source file | Tip / PR | Family | Preview | Export |
| --- | --- | --- | --- | --- | --- | --- |
| `lexi` | **LEXI** | `src/core/visualz/scenes/lexi.ts` | Flagship FLOW quality pass on PR #31 | FLOW | yes | yes |
| `lexi-ref` | **LEXI Ref-Level** | `src/core/visualz/scenes/lexi-ref.ts` | PR #31 `38df270` exact snapshot | FLOW | yes | yes |
| `lexi-2036` | **LEXI 2036** | `src/core/visualz/scenes/lexi-2036.ts` | PR #30 `9553edf` | FLOW | yes | yes |
| `lexi-v3` | **LEXI V3 Depth** | `src/core/visualz/scenes/lexi-v3.ts` | PR #29 `0d0ee82` | FLOW | yes | yes |
| `lexi-v2` | **LEXI Flow V2** | `src/core/visualz/scenes/lexi-v2.ts` | PR #28 `8d46dbf` original polish flagship | FLOW | yes | yes |
| `lexi-minimal` | **LEXI Minimal Horizon** | `src/core/visualz/scenes/lexi-minimal.ts` | Quiet V2 variant (kept since PR #29) | FLOW | yes | yes |
| `lexi-v1` | **LEXI Flow V1** | `src/core/visualz/scenes/lexi-v1.ts` | PR #27 `37dfd7b` | FLOW | yes | yes |

Duplicates: none removed. `lexi-v2` and `lexi-minimal` share the same V2 paint (identical 96×54 fingerprint) but remain two named library entries — original PR #28 flagship id vs the quiet-variant id shipped since PR #29. When in doubt both stay selectable.

## Registry model

One authoritative catalog: `src/core/visualz/scene-catalog.ts`.

Each entry: `id`, `displayName`, `shortName`, `suite` (`LEXI` \| `CLASSIC`), `family`, `description`, `renderer`. `defaultParams` live on the Scene object (`getRegisteredScene(id).defaultParams`).

- `VISUALIZER_SCENE_IDS` is derived from the catalog.
- Inspector native `<select>` is generated from the catalog (a11y), not a second hardcoded list.
- Hierarchical browser (Inspector + VIS lane) reads the same catalog.
- Hooks reserved for later: `thumbnail`, `favorite`, `search`. Not implemented now.

Non-LEXI scenes stay available under **ALL** and **CLASSIC** (families CORE / FIELD / FORM).

## Selector navigation

1. **Primary:** click the VIS lane header (gold **VIS** + current short name such as Wave / LEXI). This opens a fixed overall **VIS styles** panel — not hover-only, not clipped inside the lane, not Inspector-only.
2. Drag the **VIS styles** title bar to move the panel. Position is clamped to the viewport and remembered for the session.
3. When the arranger is short or the panel would clip the bottom, it opens **further up** (toward preview).
4. Categories: **ALL** / **LEXI** / **CLASSIC** (click, not hover-only).
5. **LEXI** exposes the five families. Click a family.
6. Click a scene name — it applies through the same rematerialize path as cycle; the header short name and renderer update immediately. Mute **M** does not open the menu.
7. **Secondary:** Inspector hierarchical browser + native `<select>` stay available when VIS is selected.

Cycling the old next-scene button remains as a fallback (`Next in cycle` in the lane overlay; tests without the setter still cycle).

## Audio / parity

Unchanged shared VIS analysis (`applyVisResponse`). Bass → terrain lift/pressure; kick/onset → local pulse; mid → form; treble → shimmer; RMS → intensity/atmosphere. Mute / low volume stay quiet. Preview === Export.

## HUMAN acceptance (operator)

**HUMAN-PROVEN** 2026-09-18 with V5.6 (operator accepted the stacked workspace / VIS / header surface). See `docs/V5.6-RELEASE.md`.

UI: open selector → LEXI → all five families → pick scenes directly. No forced cycling.

Visual: each LEXI scene renders in Preview; short export; immediate deterministic scene change.

Flagship FLOW (`lexi`): accepted as the V5.6 library flagship (depth / atmosphere / layered terrain / controlled glow / musical response). Intermediate V1–V3 / 2036 / ref-level remain selectable FLOW entries.

## Coordinator EXE

Consolidate the V5.6 tip (`cursor/ui-responsive-track-headers-6a5d` / PR **#34**) into `main`. Coordinator builds `AILEXSI Resonance Studio V5.6.exe`. Agent does not merge and does not produce the Windows EXE.

Identity: `productVersion` **5.6.0** · `frameEngine` **AILEXSI** · schema **5**.

HUMAN UX follow-up (kept): VIS styles title bar is freely draggable (pointer capture, viewport clamp, session persist). Short arranger / bottom-clip opens the panel further up. Menu pick uses `applyPickVisualizerScene` (same rematerialize path as cycle) so LEXI applies without Next in cycle. Mute **M** excluded. Inspector secondary.

Automated gates this pass: LEXI family 8 + browser 3 + vis-lane-browser 5 + vis-browser-layout 3 + vis-scene-lexi 15 + visualizer 30 + vis-cues 5 + lane-chrome 7; inspector / timeline / visualizer **314/314**. `tsc --noEmit` clean. ENC / AAC / STRESS / AFE not re-run (untouched).
