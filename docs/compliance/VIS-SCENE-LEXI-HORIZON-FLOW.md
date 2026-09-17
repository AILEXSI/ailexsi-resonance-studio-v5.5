# VIS-SCENE-LEXI — cinematic horizon flow (Polish V2)

**Status:** **IMPLEMENTED / AUTOMATED-TESTED** · **DRAFT** (not HUMAN-PROVEN). Do not merge until MODE B acceptance.

Base tip: LEXI V1 `cursor/vis-scene-lexi-horizon-e5c2` @ `37dfd7b` on HUMAN-PROVEN main `59f6c18`. VIS-only polish. ENC / STRESS / AUDIO / VIS-SYNC / VIS-RESPONSE analysers and Lattice/Wave geometry are untouched.

## What it is

AILEXSI signature Visualz scene. Id `lexi`, display **LEXI**. Dark field, warm gold / champagne horizon, layered energy filaments, receding terrain, volumetric haze, sparse dust. Inspired by a minimalist “Flow” horizon language — not a 1:1 of Resonance Wave, Void Lattice, Liquid Gold, or any template.

Feel: Signal + Horizon + Light-flow + quiet energy. For long music videos, spoken-word, ambient, techno, cinematic.

V1 was a readable prototype (mesh + one ribbon). V2 is the same scene with more depth, more intentional layers, and stronger musical readability — still calm, not an EDM carnival.

## What visually changed vs V1

| Layer | V1 | V2 |
| --- | --- | --- |
| Sky | Flat wash | Zenith accent → dark mid → warm ground |
| Depth | One mesh, one haze slab | Parallax haze planes + ground wash + radial bloom |
| Terrain | 10 thin ridges | Complexity-scaled ridges (9–18); bass thickens near body |
| Horizon | One 2D ribbon + faint 3D line | Ghost / mid / core / highlight filaments + 3D crest |
| Sea | 10 thin 3D ridges (often unread at preview) | Height-scaled receding contours + faint far mesh |
| Audio | Lift / glow / accent / sheen | + body (bass/kick thickness) + spread (mids) + shimmer (highs) |
| Motion | Single phase | Phase + slow drift; far ridges lag; camera micro-parallax |
| Palette | Gold colors; other themes unused | `palette` knob (gold default; cyan/red/green/violet data) |

## Audio wiring (Preview === Export)

Same packet every other scene sees after `applyVisResponse` / shared FFT (`presentVisualizerFeatures`). No export-only driver.

| Input | LEXI use |
| --- | --- |
| `bass` | Vertical energy + near-ridge / band thickness (`lexiHorizonLift`, `lexiHorizonBody`) |
| `rms` | Overall intensity, glow, wave amplitude (`lexiGlow`) |
| `mid` | Terrain wavelength / lateral spread (`lexiTerrainSpread`); also feeds glow |
| `onset` / `beatPulse` | Kick: line breathe, bloom, body — **no strobe** (`lexiAccent`) |
| `spectrum` / treble | Fine sheen + shimmer along the filaments (`lexiSheen`) |

Quiet signal stays meditative (thin calm line, low glow, haze still readable). Punchy passages lift and thicken the band, still fluid. Scene-local smoothing (param `smoothing`) lerps rms/bass/mid/treble/beatPulse; time jumps or reverse snaps so seek / first export frame is not leftover preview state.

Shared helpers live in `src/core/visualz/scene-impact.ts` next to Lattice/Wave. Coefficients are LEXI-specific so Wave rings and Lattice warp stay locked. V2 retunes LEXI helpers only (stronger kick/body, mid in glow/spread). Lattice/Wave formulas unchanged.

## Parameters (few high-value knobs)

| Param | Default | Role |
| --- | --- | --- |
| `intensity` | 0.82 | Master scale / impact |
| `glowStrength` | 0.76 | Bloom / volumetric light |
| `depthStrength` | 0.74 | Perspective, far plane, parallax |
| `smoothing` | 0.70 | Follow vs snap |
| `lineThickness` | 0.58 | Horizon core |
| `complexity` | 0.52 | Terrain density (cols/rows) |
| `waveAmplitude` | 0.64 | Terrain deformation |
| `reactivity` | 0.80 | How hard audio moves the picture |
| `particleAmount` | 0.32 | Sparse dust (0 hides) |
| `palette` | `gold` | gold / cyan / red / green / violet |
| `colorPrimary` | `#e8a33a` | Gold line / warm mesh |
| `colorSecondary` | `#07060a` | Dark field |
| `backgroundLevel` | 0.14 | Faint wash; 0 = darker |

`speed` remains on `SceneParams` (flow pace). Inspector still exposes scene pick only — extra knobs are scene defaults / future inspector, not option spam.

Center-safe title band: `LEXI_TITLE_SAFE` (particles skip it). No on-screen text/logo.

## How to select

1. Arrange → click the **VIS** lane (or a VIS event) so the inspector shows **VIS scene**.
2. Dropdown: **LEXI** (value `lexi`).
3. Or cycle the VIS scene button until the lane label reads **LEXI**. Cycle wrap: Crystal → LEXI → Bars.

## Files

- `src/core/visualz/scenes/lexi.ts` — render + theme resolve
- `src/core/visualz/scenes/index.ts` — registry
- `src/core/models.ts` — `VISUALIZER_SCENE_IDS`
- `src/core/visualizer.ts` — short name `LEXI`
- `src/core/visualz/scene-impact.ts` — LEXI drivers (Lattice/Wave untouched)
- `src/ui/inspector/Inspector.tsx` — picker labels use `sceneShortName`
- `tests/visualizer/vis-scene-lexi.test.ts` + registry count 17

## HUMAN acceptance checklist

Draft until an operator MODE B EXE says so. Check:

1. **Short 1–2 min export** — same song, LEXI selected, obvious beats.
2. **Kick / onset** — the horizon band thickens and lifts; not a white strobe.
3. **Quiet calmer** — thin readable line, low glow, haze still there.
4. **Lower volume → lower VIS** — no AGC; quieter mix is quieter picture.
5. **Aesthetic over a few minutes** — still hypnotic; no twitch; gold/champagne on dark.
6. **Export similar to Preview** — same `applyVisResponse` packet (VIS-SYNC/RESPONSE path).
7. **Distinct** — not Lattice, not Wave, not Liquid Gold.
8. **No regression** — other scenes, ENC-01, AUDIO, STRESS mux, VIS-SYNC/RESPONSE still behave.

Do not mark HUMAN-PROVEN from tests, agent screenshots, or Chrome-only runs.
