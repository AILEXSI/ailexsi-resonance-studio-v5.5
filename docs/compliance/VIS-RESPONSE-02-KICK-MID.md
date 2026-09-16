# VIS-RESPONSE-02 — more felt kick / mid (same architecture)

Base: VIS-RESPONSE-01 tip `1d49531` on `cursor/vis-response-01-impact-layer-e2d7` (PR **#25**). Do **not** merge PR #19–#25.

## Human evidence (01 soft-PASS)

User (M.G.M.): *besser vis und rest funktioniert kannst alles anpassen.*

Clip: ~357.8 s 1920×1080@30 H.264+AAC, lattice-style scene (central orb + horizontal resonance waves). Audio present (RMS roughly −41…−9 dB, median ~−18 dB). Pipeline still works. Full permission to retune **presentation** only.

Protected: ~34:18 and ~64 min VIDEO+VIS+AUDIO stability. Analyser / mux / encoder unchanged.

## What 01 left on the table

`transientBoost` only added to presentation `energy`. Builtin scenes read `AudioFeatures` (rms/bass/mid/treble/spectrum/onset/beatPulse) — **not** `energy`. Resonance Wave ring pulse used `beatPulse * 0.15`; Void Lattice warp was **bass-only**, so a loud pad warped more than a kick.

## 02 defaults vs 01

| Knob | 01 (`1d49531`) | 02 | Why |
| --- | --- | --- | --- |
| `gain` | 1.2 | **1.25** | Modest lift. Pad 0.35 raw rms 0.494 → **0.720** (not 1). |
| `gamma` | 0.75 | **0.68** | More mid-low expansion; monotonic. Snare mid 0.41 → higher. |
| `spectrumSpreadBins` | 12 | **18** | 48-bar / wave sampling catches narrow peaks. |
| `transientBoost` | 0.24 | **0.38** | Onset energy punch only. rms/bands stay continuous. |

Same `shape(x)=clamp01(pow(clamp01(x*gain), gamma))`. No AGC. No per-song normalize. Preview === Export.

## Shared Lattice / Wave drivers

`src/core/visualz/scene-impact.ts` — same functions in Preview and Export:

- Resonance rings: `1 + bass*0.28*int + beatPulse*0.38 + (onset ? 0.10 : 0)` (was `bass*0.25` + `beatPulse*0.15`)
- Wave amp: extra `height * (beatPulse*0.055 + onset*0.02)`
- Wave mid freq: `2 + mid*2.6` (was `*2`)
- Core: `6 + bass*18*int + beatPulse*16 + (onset ? 8 : 0)` (was beatPulse `*10`)
- Lattice warp: `(bass*0.42 + beatPulse*0.34 + onset*0.10)*int` (kick now warps more than a pad)

## Before / after (same Phase 1 PCM, presentation)

| PCM | 01 rms | 02 rms | 01 bass | 02 bass | 01 energy | 02 energy |
| --- | --- | --- | --- | --- | --- | --- |
| silence | 0 | 0 | 0 | 0 | 0 | 0 |
| quiet 220 Hz amp 0.06 | 0.180 | ~0.218 | 0.180 | ~0.218 | 0.180 | ~0.218 |
| pad 220 Hz amp 0.35 | 0.676 | **~0.720** | 0.676 | ~0.720 | 0.676 | ~0.720 |
| kick 70 Hz (no extra onset at sample) | 0.570 | higher | 0.534 | higher | 0.545 | higher |
| kick + onset | +0.24 | **+0.38** | continuous | continuous | punch | punch |

Quiet stays well below pad. 0.25 < 0.50 < 1.00 amp. Mute → 0.

## Untouched

VIS-SYNC-01 analyser (fft 2048, Blackman, dB `[-100,-30]`, smoothing 0.75). AUDIO-01 mix/mux. AFE / ENC-01 / STRESS. Volume / automation semantics. Other scenes except Resonance Wave + Void Lattice multipliers.

## Operator card — MODE B (coordinator builds EXE)

Same ~357.8 s lattice/wave clip (and the ~34:18 baseline after the short pass).

1. Build from **this PR tip**. Chip **5.5.0**, Frame Engine **AILEXSI**.
2. 30–60 s obvious-beat section vs 01 EXE: kicks hit harder, mids clearer, pads still breathe, quiet quiet, fader still lowers VIS, Preview≈Export.
3. Do not start AUDIO-02. Do not merge.

**EXE path / SHA256:** left for the coordinator.

**HUMAN acceptance pending.**
