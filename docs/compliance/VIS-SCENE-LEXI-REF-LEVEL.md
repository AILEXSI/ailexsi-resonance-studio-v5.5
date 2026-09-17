# VIS-SCENE-LEXI — Reference-level cinematic energy space

**Status:** **IMPLEMENTED / AUTOMATED-TESTED** · **DRAFT** (not HUMAN-PROVEN). Do not merge until MODE B acceptance. Do not mark HUMAN-PROVEN from tests or agent screenshots.

Base tip: LEXI 2036 `9553edf355c14198b03e536e26a1fa0d6fd8e47c` on `cursor/vis-scene-lexi-2036-cinematic-ef57` (PR **#30**). VIS-only. ENC / STRESS / AUDIO / VIS-SYNC / VIS-RESPONSE analysers and Lattice/Wave geometry are untouched.

Coordinator MODE-B EXE from the branch tip of `cursor/vis-scene-lexi-ref-level-b8fe` after the stamp commit.

## Product decision

2036 has the right *architecture* (FG / MG / BG, hero stream, kick = local pulse) but still reads as **a thin ribbon on empty brown field** — below the attached CGI niveau (“sowas animiert”). This draft keeps `lexi-minimal` calm and pushes flagship `lexi` toward that language on Canvas 2D.

| Scene | Id | Display | Role |
| --- | --- | --- | --- |
| Flagship LEXI | `lexi` | **LEXI** | Reference-level particle dunes + silk stream |
| Quiet variant (V2) | `lexi-minimal` | **LEXI Minimal Horizon** | Calm parallel-horizon look — unchanged |

Cycle: Crystal → **LEXI** → **LEXI Min** → Bars.

## Honest constraint

The attached refs are offline CGI (millions of particles, real volumetric fog, shallow DOF). Resonance Studio VIS is **Canvas 2D**. A true millions-of-points field would need a WebGL rewrite (deferred). This V1 is the strongest canvas approximation that still long-form-exports: dense dotted meridians, surface scatter, mountain silhouettes, FG bokeh, silk hero — not another thin-ribbon pass.

## Before / after — why it is closer to the refs

| 2036 leftover | Reference-level draft |
| --- | --- |
| 7–16 sparse meridians, almost unread at preview | ~36–56 **particle meridians** (dashed + stamped dots) filling near → VP |
| Empty lower half; picture = one screen ribbon | Dense dune field is the picture; silk sits *on* the dunes |
| Tiny signal-tower dots | Distant **light-mountain silhouettes** + vertical shafts + optional sky arcs |
| ~40 dust motes | Surface scatter (~480) + FG bokeh + sparkle |
| Brown sky wash, gold soup risk | Near-black negative space; bloom on horizon / peaks / hero only |
| Flat 2D ribbon on black | 2.5D perspective dunes + 3D silk filaments (cool / rose / champagne / highlight) |

Keep: horizontal flow, dark field, Preview === Export, no cheap EQ bars, no hard strobe.

```
black space + faint cool zenith
↓ distant mountain silhouettes + gold ridge dust
↓ vertical light shafts / optional arcs
↓ volumetric horizon bloom (localized)
↓ DENSE particle meridians + dune contours + surface scatter
↓ supporting MG filaments
↓ HERO silk stream (width from pads / vocals)
↓ kick = local compression + traveling node
   bass = dune lift / wave pressure
   snare / high-transient = highlight flash + fine sparkle
   pads / vocals (rms / mid) = ribbon width / ambient expand / color breath
↓ FG reflective traces + shallow-DOF bokeh / mist
↓ depth falloff (near ground darkens)
```

## Audio → form (Preview === Export)

Same `applyVisResponse` packet as every other scene. No export-only driver. No new `scene-impact` coefficients.

| Input | Flagship | Minimal (V2, unchanged) |
| --- | --- | --- |
| `bass` | Dune lift / wave pressure | Vertical energy + band thickness |
| `rms` | Presence + ambient expand + ribbon width | Glow / amplitude |
| `mid` | Large form + ambient + ribbon width | Terrain wavelength / lateral spread |
| `onset` / `beatPulse` | Local compression + traveling node — no strobe | Soft line breathe / body |
| `treble` / spectrum | Sheen + sparkle + **transient flash** | Sheen + shimmer |

Scene-local smoothing lerps rms/bass/mid/treble/beatPulse; time jumps snap so seek / first export frame is not leftover preview state.

## Approximated vs deferred

| Intent from refs | Canvas V1 | Deferred (needs WebGL / offline) |
| --- | --- | --- |
| Millions of terrain points | Hundreds–low-thousands of dots + dashed meridians | GPU point sprites / instancing |
| True volumetric fog | Layered haze slabs + FG mist gradient | Raymarched / half-res fog |
| Shallow-DOF bokeh | ~22 radial FG discs | Real CoC / mip blur |
| Silk energy with internal scatter | Multi-filament strokes + highlight core | Ribbon mesh + additive particles |
| Reflective wet floor | FG traces + dark falloff | Screen-space reflection |
| Rainbow EDM bars (ref 3) | **Intentionally not cloned** — accents only | — |

## Parameters

Same high-value knobs. Ref-level defaults are denser / slower / darker (`complexity` 0.64, `particleAmount` 0.55, `speed` 0.62, `glowStrength` 0.52, `backgroundLevel` 0.07). Inspector still exposes scene pick only.

Center-safe title band: `LEXI_TITLE_SAFE` (particles skip it). No on-screen text/logo.

## How to select

1. Arrange → click the **VIS** lane so the inspector shows **VIS scene**.
2. Dropdown: **LEXI** (flagship) or **LEXI Min** (Minimal Horizon).
3. Or cycle: Crystal → LEXI → LEXI Min → Bars.

## Files

- `src/core/visualz/scenes/lexi.ts` — flagship reference-level render
- `src/core/visualz/scenes/lexi-minimal.ts` — V2 quiet variant (kept)
- `src/core/visualz/scenes/lexi-theme.ts` — shared palettes + `LEXI_REFLECT`
- `tests/visualizer/vis-scene-lexi.test.ts` + registry 18
- `lexi-ref-level-preview.html` — MODE A (live + quiet/pad/kick/snare). Not HUMAN-PROVEN.

## Gates

`./node_modules/.bin/tsc --noEmit` clean. Focused VIS + visualizer + vis-events/cues/edit + VIS-RESPONSE + VIS-SYNC + vis-lane-seek.

## HUMAN checklist (1–2 min)

Draft until an operator MODE B EXE says so. **PASS only if** the picture is clearly closer to the attached niveau — denser, deeper, more atmospheric, more premium — while staying calm and musically responsive.

1. **Not a thin ribbon on black** — particle dunes / receding field dominate; hero silk sits in that field.
2. **Depth at a glance** — FG bokeh/traces · MG dunes · BG mountains/shafts/haze.
3. **Hero stream** — one luminous silk is visually important; pads widen / breathe it.
4. **Kick** — local pulse / compression + stream node; not a white strobe.
5. **Snare / hats** — sharp highlight flash + fine sparkle. Dark kick does not do the same flash.
6. **Bass** — dunes lift / press; the space changes, not just brighter.
7. **Quiet darker / calmer** — black space, gold pops, no soup. Lower volume → lower VIS. No AGC.
8. **Export similar to Preview** — same presented packet.
9. **Minimal still there** — LEXI Minimal Horizon still the calm V2 look.
10. **No regression** — Lattice, Wave, ENC-01, AUDIO, STRESS mux, VIS-SYNC/RESPONSE still behave.
11. **Long-form** — slow cinematic motion; still hypnotic after minutes.

Do not mark HUMAN-PROVEN from tests, agent screenshots, or Chrome-only runs.
