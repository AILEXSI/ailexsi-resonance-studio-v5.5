# VIS-SCENE-LEXI 2036 — Cinematic Future Energy Space

**Status:** **IMPLEMENTED / AUTOMATED-TESTED** · **DRAFT** (not HUMAN-PROVEN). Do not merge until MODE B acceptance. Do not mark HUMAN-PROVEN from tests or agent screenshots.

Base tip: LEXI V3 `0d0ee827b0d1d9cc199f7e5e0b66ca9c87f25ed8` on `cursor/vis-scene-lexi-v3-cinematic-depth-9f48` (PR **#29**), already on LEXI V2 Minimal Horizon + V3 cinematic depth. VIS-only. ENC / STRESS / AUDIO / VIS-SYNC / VIS-RESPONSE analysers and Lattice/Wave geometry are untouched.

Implementation SHA: stamped on the branch tip of `cursor/vis-scene-lexi-2036-cinematic-ef57` (draft PR **#30**). Coordinator MODE-B EXE from that tip.

## Product decision

V3 has depth and musical form, but still reads as **early-Tron wireframe horizon** — too flat, too empty, too much simple grid. 2036 keeps the horizon / vanishing terrain and replaces the retro mesh with layered energy architecture.

| Scene | Id | Display | Role |
| --- | --- | --- | --- |
| Flagship LEXI 2036 | `lexi` | **LEXI** | Cinematic future energy space |
| Quiet variant (V2) | `lexi-minimal` | **LEXI Minimal Horizon** | Calm parallel-horizon look — unchanged |

Cycle: Crystal → **LEXI** → **LEXI Min** → Bars.

## Before / after — why it reads 2036, not 1982

| 1982 / V3 leftover | 2036 flagship |
| --- | --- |
| Uniform meridian × contour mesh (vanishing-point grid as the picture) | Sparse structural ribs only; most of the field is filled terrain + atmosphere |
| Empty black sky, one VP glow | Volumetric zenith (cool teal), horizon haze, distant signal towers with tip lights |
| Four thin “light bands” that still look like extra grid lines | Mid-ground flowing filaments **plus** a hero luminous stream (ghost / cool / rose / champagne / highlight) |
| Kick = expanding Tron rings on the plane | Kick = local compression burst + traveling energy node on the stream |
| Highs = dust only | High-transient = refined highlight flash on the hero core (no full-frame strobe) |
| Pads = more glow on the same grid | Pads / vocals = ribbon width, ambient expansion, color breath |
| Flat gold language | Gold / amber with controlled champagne core and subtle cyan / magenta reflections |

Keep: horizontal flow, dark field, Preview === Export, no gold soup, no cheap EDM equalizer.

```
black space + cool zenith
↓ distant signal towers (BG haze)
↓ volumetric horizon bloom
↓ MG flowing terrain (filled, not a wire cage)
↓ supporting energy filaments
↓ HERO luminous ribbon / signal stream
↓ kick = local pulse / compression burst
   bass = terrain lift / wave pressure
   snare / high-transient = sharp highlight flash
   pads / vocals (rms / mid) = glow width / ambient expand
↓ FG energy traces
↓ depth falloff (near ground darkens)
```

## Audio → form (Preview === Export)

Same `applyVisResponse` packet as every other scene. No export-only driver.

| Input | Flagship 2036 | Minimal (V2, unchanged) |
| --- | --- | --- |
| `bass` | Terrain lift / wave pressure (`lexiHorizonLift`, `lexiHorizonBody`, spread) | Vertical energy + band thickness |
| `rms` | Presence + ambient expand + ribbon width | Glow / amplitude |
| `mid` | Large form + ambient + ribbon width (`lexiFormShift`, `lexiAmbientExpand`, `lexiRibbonWidth`) | Terrain wavelength / lateral spread |
| `onset` / `beatPulse` | Local compression burst + traveling node (`lexiPressureWave`) — no strobe | Soft line breathe / body |
| `treble` / spectrum | Fine sheen + **transient flash** (`lexiTransientFlash`) — snare reads, dark kick does not white-out | Sheen + shimmer |

2036 helpers (`lexiAmbientExpand`, `lexiTransientFlash`, `lexiRibbonWidth`) are **additive** in `scene-impact.ts`. Lattice / Wave / V2 Minimal / V3 lift-form coefficients are unchanged.

Scene-local smoothing lerps rms/bass/mid/treble/beatPulse; time jumps snap so seek / first export frame is not leftover preview state.

## Parameters

Same high-value knobs. 2036 defaults are slightly more atmospheric / less grid-dense (`glowStrength` 0.58, `depthStrength` 0.86, `backgroundLevel` 0.10, `particleAmount` 0.28, `speed` 0.72). Inspector still exposes scene pick only.

Center-safe title band: `LEXI_TITLE_SAFE` (particles skip it). No on-screen text/logo. No title system.

## How to select

1. Arrange → click the **VIS** lane so the inspector shows **VIS scene**.
2. Dropdown: **LEXI** (flagship 2036) or **LEXI Min** (Minimal Horizon).
3. Or cycle: Crystal → LEXI → LEXI Min → Bars.

## Files

- `src/core/visualz/scenes/lexi.ts` — flagship 2036 render
- `src/core/visualz/scenes/lexi-minimal.ts` — V2 quiet variant (kept)
- `src/core/visualz/scenes/lexi-theme.ts` — shared palettes + `LEXI_REFLECT`
- `src/core/visualz/scene-impact.ts` — 2036 helpers additive
- `tests/visualizer/vis-scene-lexi.test.ts` + registry 18
- `lexi-2036-preview.html` — MODE A side-by-side (flagship vs Minimal; quiet/pad/kick/snare). Not HUMAN-PROVEN.

## Gates

`./node_modules/.bin/tsc --noEmit` clean. Focused VIS + visualizer + vis-events/cues/edit + VIS-RESPONSE + VIS-SYNC + vis-lane-seek **104/104**.

## HUMAN checklist (1–2 min)

Draft until an operator MODE B EXE says so. **PASS only if** the picture is clearly more premium, deeper, more atmospheric, and more futuristic than V3 — while staying calm and musically responsive.

1. **Not 1982** — does **not** read as a glowing wireframe grid / early Tron. Energy architecture + hero stream dominate.
2. **Depth at a glance** — FG traces / MG terrain / BG haze + distant lights. Horizon still there.
3. **Hero stream** — one luminous ribbon is visually important; pads widen / breathe it.
4. **Kick** — local pulse / compression on the near field + stream node; not a white strobe, not a giant ring circus.
5. **Snare / hats** — sharp highlight flash, refined. Dark kick does not do the same flash.
6. **Bass** — terrain lifts / presses; the space changes, not just brighter.
7. **Quiet darker / calmer** — black space, thin gold, no soup. Lower volume → lower VIS. No AGC.
8. **Export similar to Preview** — same presented packet.
9. **Minimal still there** — LEXI Minimal Horizon still the calm V2 look.
10. **No regression** — Lattice, Wave, ENC-01, AUDIO, STRESS mux, VIS-SYNC/RESPONSE still behave.
11. **Long-form** — slow cinematic motion; still hypnotic after minutes.

Do not mark HUMAN-PROVEN from tests, agent screenshots, or Chrome-only runs.
