# VIS-SCENE-LEXI — cinematic horizon flow

**Status:** **IMPLEMENTED / AUTOMATED-TESTED** · **DRAFT** (not HUMAN-PROVEN). Do not merge until MODE B acceptance.

Base tip: `main` @ `59f6c18` (VIS-RESPONSE-02 + VIS-SYNC-01 HUMAN-PROVEN stack). New scene only. ENC / STRESS / AUDIO / VIS-SYNC / VIS-RESPONSE analysers and Lattice/Wave geometry are untouched.

## What it is

AILEXSI signature Visualz scene. Id `lexi`, display **LEXI**. Dark field, warm gold horizon, receding terrain mesh, tasteful bloom, sparse dust. Inspired by a minimalist “Flow” look — not a 1:1 of Resonance Wave, Void Lattice, or Liquid Gold.

Feel: Signal + Horizon + Light-flow + quiet energy. For long music videos, spoken-word, ambient, techno, cinematic.

## Audio wiring (Preview === Export)

Same packet every other scene sees after `applyVisResponse` / shared FFT (`presentVisualizerFeatures`). No export-only driver.

| Input | LEXI use |
| --- | --- |
| `bass` | Vertical energy / horizon bulge / terrain pressure (`lexiHorizonLift`) |
| `rms` | Overall intensity, glow, wave amplitude (`lexiGlow`) |
| `onset` / `beatPulse` | Short accent: line breathe, soft bloom, pressure — **no strobe** (`lexiAccent`) |
| `spectrum` / mid / treble | Fine surface sheen along the mesh (`lexiSheen`) |

Quiet signal stays meditative (thin calm line, low glow). Punchy passages lift the terrain and brighten the line, still fluid. Scene-local smoothing (param `smoothing`) lerps rms/bass/beatPulse; time jumps or reverse snaps so seek / first export frame is not leftover preview state.

Shared helpers live in `src/core/visualz/scene-impact.ts` next to Lattice/Wave. Coefficients are LEXI-specific so Wave rings and Lattice warp stay locked.

## Parameters (V1)

| Param | Default | Role |
| --- | --- | --- |
| `intensity` | 0.82 | Master scale |
| `glowStrength` | 0.72 | Bloom / light bleed |
| `lineThickness` | 0.55 | Horizon core |
| `waveAmplitude` | 0.62 | Terrain deformation |
| `depthStrength` | 0.70 | Perspective / far plane |
| `reactivity` | 0.78 | How hard audio moves the picture |
| `smoothing` | 0.68 | Follow vs snap |
| `particleAmount` | 0.35 | Sparse dust (0 hides) |
| `colorPrimary` | `#e8a33a` | Gold line / warm mesh |
| `colorSecondary` | `#07060a` | Dark field |
| `backgroundLevel` | 0.12 | Faint wash; 0 = pure dark |

`speed` / `complexity` remain on `SceneParams` (flow pace / reserved). Later palettes (`gold` / `cyan` / `red` / `green` / `violet`) exist as `LEXI_THEMES`; **only gold ships**.

Center-safe title band: `LEXI_TITLE_SAFE` (particles skip it). No on-screen text/logo in V1.

## How to select

1. Arrange → click the **VIS** lane (or a VIS event) so the inspector shows **VIS scene**.
2. Dropdown: **LEXI** (value `lexi`).
3. Or cycle the VIS scene button until the lane label reads **LEXI**. Cycle wrap: Crystal → LEXI → Bars.

## Files

- `src/core/visualz/scenes/lexi.ts` — render
- `src/core/visualz/scenes/index.ts` — registry
- `src/core/models.ts` — `VISUALIZER_SCENE_IDS`
- `src/core/visualizer.ts` — short name `LEXI`
- `src/core/visualz/scene-impact.ts` — `lexiHorizonLift` / `lexiGlow` / `lexiAccent` / `lexiSheen`
- `src/ui/inspector/Inspector.tsx` — picker labels use `sceneShortName`
- `tests/visualizer/vis-scene-lexi.test.ts` + registry count 17

## HUMAN acceptance checklist

Draft until an operator MODE B EXE says so. Check:

1. **Preview is musical** — quiet stays calm; kicks / onsets breathe the line; no random flicker; no cheap EQ bars; no strobe.
2. **Export is similar** — same song, same scene, Preview vs MP4 look like the same driver (VIS-SYNC/RESPONSE path).
3. **Calm / premium** — gold/amber on dark; optional cyan only in depth. Not an EDM carnival.
4. **Long-form not annoying** — 5–10+ min still hypnotic, not twitchy.
5. **Distinct** — not Lattice (node grid fly-through), not Wave (rings + layered 2D waves), not Liquid Gold (wells).
6. **No regression** — other scenes, ENC-01, AUDIO, STRESS mux, VIS-SYNC/RESPONSE still behave.

Do not mark HUMAN-PROVEN from tests, agent screenshots, or Chrome-only runs.
