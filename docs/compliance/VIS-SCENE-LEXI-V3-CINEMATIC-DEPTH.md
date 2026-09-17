# VIS-SCENE-LEXI V3 — Cinematic Depth & Impact

**Status:** **IMPLEMENTED / AUTOMATED-TESTED** · **DRAFT** (not HUMAN-PROVEN). Do not merge until MODE B acceptance. Do not mark HUMAN-PROVEN from tests or agent screenshots.

Base tip: LEXI Polish V2 `8d46dbfbd9397b9184180d11f32d83e17b1e3ac6` on `cursor/vis-scene-lexi-polish-v2-f909` (PR #28), already on LEXI V1 + HUMAN-PROVEN main `59f6c18`. VIS-only. ENC / STRESS / AUDIO / VIS-SYNC / VIS-RESPONSE analysers and Lattice/Wave geometry are untouched.

Implementation SHA: `fa90d65b32a5c2abacb0279c9c3a748f1fa21384`. Coordinator MODE-B EXE from the branch tip of `cursor/vis-scene-lexi-v3-cinematic-depth-9f48` (draft PR **#29**).

## Product decision

V2 is technically good and aesthetically usable — **not flagship**. It is kept, not thrown away.

| Scene | Id | Display | Role |
| --- | --- | --- | --- |
| Flagship LEXI V3 | `lexi` | **LEXI** | Cinematic depth & impact — new image language |
| Quiet variant (V2) | `lexi-minimal` | **LEXI Minimal Horizon** | Calm parallel-horizon look |

Cycle: Crystal → **LEXI** → **LEXI Min** → Bars.

## Why flagship ≠ Minimal

Minimal (V2) is a **parallel-horizon sea**: layered 2D ribbons, receding contours that stay mostly horizontal, volumetric haze slabs, radial bloom across the mid band. Calm, premium, screensaver-adjacent. Beats thicken glow more than they change space.

Flagship V3 is a **perspective terrain** with a visible vanishing point, three depth planes, an off-center hero peak, and musical events that move form:

```
black space
↓ deep gold terrain plane
↓ several flowing light bands
↓ vanishing point / horizon
↓ Kick = pressure wave
   Bass = terrain lift / push-apart
   Mid = large form shift
   High = fine shimmer / particles only
↓ Bloom only on highlights (VP + peak crest)
```

“More glow” was the wrong V2 fix (gold soup). V3 keeps negative space dark so gold can actually shine.

## Visual language (V3)

| Trait | How |
| --- | --- |
| Vanishing point | Longitudinal meridians converge toward a far projected point — not almost-only horizontal lines |
| 3 depth planes | FG / MG / BG drawn separately (thicker / brighter near, thin / faint far) |
| Deep gold plane | Filled terrain polygon, dark near → black at horizon |
| Hero peak | Asymmetric (`lexiPeakBias`), mid-driven; secondary opposite peak so it is not a screensaver |
| Light bands | 4 flowing 3D ribbons at staggered depths |
| Camera | Very slow drift / parallax (yaw, x, z) |
| Quiet | Dark field, thin meridians, almost no bloom / particles / rings |
| Peak | Lifted FG, visible peak, pressure rings, localized highlight bloom |

## Audio → form (Preview === Export)

Same `applyVisResponse` packet as every other scene. No export-only driver.

| Input | Flagship V3 | Minimal (V2, unchanged) |
| --- | --- | --- |
| `bass` | Lift + push-apart of the near surface (`lexiHorizonLift`, `lexiHorizonBody`, spread on world X) | Vertical energy + band thickness |
| `rms` | Overall presence (not a wash) | Glow / amplitude |
| `mid` | Large form / hero peak (`lexiFormShift`) | Terrain wavelength / lateral spread |
| `onset` / `beatPulse` | Expanding pressure rings on the plane (`lexiPressureWave`) — no strobe / white flash | Soft line breathe / body |
| `treble` / spectrum | Fine particles + sheen only | Sheen + shimmer |

V3 helpers are **additive** in `scene-impact.ts`. Lattice / Wave / V2 Minimal coefficients are unchanged.

Scene-local smoothing lerps rms/bass/mid/treble/beatPulse; time jumps snap so seek / first export frame is not leftover preview state.

## Parameters

Same high-value knobs as V2 (no option spam). V3 defaults are slightly darker / more depth-forward (`backgroundLevel` 0.08, `glowStrength` 0.62, `depthStrength` 0.82). Inspector still exposes scene pick only.

Center-safe title band: `LEXI_TITLE_SAFE` (particles skip it). No on-screen text/logo. No title system.

## How to select

1. Arrange → click the **VIS** lane so the inspector shows **VIS scene**.
2. Dropdown: **LEXI** (flagship) or **LEXI Min** (Minimal Horizon).
3. Or cycle: Crystal → LEXI → LEXI Min → Bars.

## Files

- `src/core/visualz/scenes/lexi.ts` — flagship V3 render
- `src/core/visualz/scenes/lexi-minimal.ts` — V2 quiet variant
- `src/core/visualz/scenes/lexi-theme.ts` — shared palettes / title-safe
- `src/core/visualz/scenes/index.ts` — registry (18)
- `src/core/models.ts` — `VISUALIZER_SCENE_IDS`
- `src/core/visualizer.ts` — short names `LEXI` / `LEXI Min`
- `src/core/visualz/scene-impact.ts` — V3 helpers additive
- `tests/visualizer/vis-scene-lexi.test.ts` + registry 18

## Gates

`tsc --noEmit` clean. Focused VIS + visualizer + vis-events/cues/edit + VIS-RESPONSE + VIS-SYNC + vis-lane-seek **103/103**.

## HUMAN checklist (1–2 min)

Draft until an operator MODE B EXE says so.

1. **Depth readable at a glance** — vanishing point + FG / MG / BG, not a flat gold stripe.
2. **Kick pressure wave** — short expanding ring on the terrain; not a white strobe.
3. **Bass lift** — near surface rises or spreads; the picture changes, not just brighter.
4. **Quiet darker / calmer** — black space, thin gold, no soup.
5. **Lower volume → lower VIS** — no AGC.
6. **Not gold soup** — bloom only on highlights (VP / peak).
7. **Export similar to Preview** — same presented packet.
8. **Minimal still there** — LEXI Minimal Horizon still the calm V2 look.
9. **No regression** — Lattice, Wave, ENC-01, AUDIO, STRESS mux, VIS-SYNC/RESPONSE still behave.

Do not mark HUMAN-PROVEN from tests, agent screenshots, or Chrome-only runs.
