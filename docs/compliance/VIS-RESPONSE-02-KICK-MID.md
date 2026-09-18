# VIS-RESPONSE-02 — more felt kick / mid (same architecture)

Base: VIS-RESPONSE-01 tip `1d49531` on `cursor/vis-response-01-impact-layer-e2d7` (PR **#25**). **HUMAN-PROVEN** 2026-09-17. Ready to consolidate into main (coordinator merges).

## Human evidence (01 soft-PASS)

User (M.G.M.): *besser vis und rest funktioniert kannst alles anpassen.*

Clip: ~357.8 s 1920×1080@30 H.264+AAC, lattice-style scene (central orb + horizontal resonance waves). Audio present (RMS roughly −41…−9 dB, median ~−18 dB). Pipeline still works. Full permission to retune **presentation** only.

Protected: VIS-SYNC / long-form VIDEO+VIS+AAC stack includes documented **~34:18**, **~64 min**, and HUMAN **~90 min (01:30:30)** (`Msster_Resonance.v190.mp4`). Analyser / mux / encoder unchanged.

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

| PCM | 01 rms | 02 rms | 01 bass | 02 bass | 01 mid | 02 mid | 01 energy | 02 energy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| silence | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| quiet 220 Hz amp 0.06 | 0.180 | **0.217** | 0.180 | 0.217 | 0 | 0 | 0.180 | 0.217 |
| pad 220 Hz amp 0.35 | 0.676 | **0.721** | 0.676 | 0.721 | 0 | 0 | 0.676 | 0.721 |
| kick 70 Hz | 0.570 | **0.617** | 0.534 | 0.582 | 0.010 | **0.051** | 0.545 | 0.599 |
| snare | 0.346 | **0.393** | 0.412 | 0.460 | 0.393 | **0.441** | 0.379 | 0.427 |
| bass 55 Hz amp 0.55 | 0.943 | 0.974 | 0.943 | 0.974 | 0 | 0 | 0.943 | 0.974 |

Onset adds **0.38** to energy (was 0.24). Pad 0.35 stays at **0.721**, not 1. Quiet remains ~30% of pad. 0.25 < 0.50 < 1.00 amp. Mute → 0.

`tsc --noEmit` clean. Focused VIS-RESPONSE + VIS-SYNC-01 + visualizer + vis-events/cues/edit + AUDIO-01 + export + aac-mux + ENC-01 **134/134**.

## Untouched

VIS-SYNC-01 analyser (fft 2048, Blackman, dB `[-100,-30]`, smoothing 0.75). AUDIO-01 mix/mux. AFE / ENC-01 / STRESS. Volume / automation semantics. Other scenes except Resonance Wave + Void Lattice multipliers.

## HUMAN-PROVEN — 2026-09-17 (M.G.M.)

| | |
| --- | --- |
| Result | **PASSED** — operator: *perfect lassen wir erst mal so mergen doku* |
| Feature tip | `cc3cd08` (`cc3cd086831099c0dad6aace5c81e4d0e967a03a`) |
| EXE SHA256 | `4A080D0F1369091F6F96E7A0BB7F9E6DFF74DC2923EBF6EF75FF658EC142CEFB` |
| Evidence | Short Impact check on MODE B EXE of tip `cc3cd08`. Prior **soft-PASS** of VIS-RESPONSE-01 (~6 min Lattice 1080p30+AAC). |
| Locked defaults | `gain` 1.25 · `gamma` 0.68 · `spectrumSpreadBins` 18 · `transientBoost` 0.38 |
| Shared | `src/core/visualz/scene-impact.ts` (Resonance Wave + Void Lattice). No AGC. Preview = Export. |

### Stack this rests on (already proven earlier — no invented timings)

This presentation layer sits on the long-form VIDEO+VIS+AAC chain already accepted before 02:

- **ENC-01** — 1920×1080 H.264 @ 24/25/30 (EXE tip `0ec7758`)
- **STRESS-01..04** — clip-start PTS, call-stack dump, pre-request source, mux arg overflow
- **AUDIO-01 / AUDIO-01b** — long-form AAC present and audible
- **VIS-SYNC-01** — Preview/Export real-FFT parity; long-form VIDEO+VIS+AAC stack includes documented **~34:18**, **~64 min**, and HUMAN **~90 min (01:30:30)** (`Msster_Resonance.v190.mp4`)

Additional HUMAN long-form evidence (omitted from earlier GitHub cites that stopped at ~64 min): operator M.G.M. file `Msster_Resonance.v190.mp4`, Windows Media Player duration **01:30:30**, Explorer modified **2026-09-17 02:24**, ~**1.76 GB**. Screenshot: `docs/longform-90min-acceptance-2026-09-17.png`. This is media-baseline evidence, not a new V5.6 feature stamp. EXE SHA for that export is unknown — do not invent. Not AUDIO-02 / 2 h streaming.

Do not start AUDIO-02. Coordinator consolidates this stack to main.
