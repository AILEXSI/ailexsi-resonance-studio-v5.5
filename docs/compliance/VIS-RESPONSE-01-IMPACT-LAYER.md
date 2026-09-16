# VIS-RESPONSE-01 — restore visual impact without breaking parity

Base: VIS-SYNC-01 tip `3b16a09` (branch `cursor/vis-sync-01-preview-export-parity-2f4e`, PR **#24**). Do **not** merge PR #19 / #20 / #21 / #22 / #23 / #24 or this branch.

## Human observation (pre-fix)

After VIS-SYNC-01, Preview and Export share a real FFT. VIS reacts on the right hits, but looks more restrained / weaker impact than the older (false) LPF + `syntheticSpectrum` path.

Not a request to return to fake spectrum. Not a request to normalize every song. Not a request to make low volume look like high volume.

Desired: lower level → lower VIS; higher → stronger; silence → quiet; strong transient → clear impact; quiet passage → calmer; Preview == Export response semantics.

## Phase 1 — measured cause (do not guess)

Deterministic PCM through the **unchanged** VIS-SYNC-01 extractor (`fftSize` 2048, Blackman, dB `[-100, -30]`, smoothing `0.75`, `third = 170`). Scenes consume that packet as-is today (`withEnergyAliases` only).

| PCM | rms | bass | mid | treble | energy | beatPulse | specPeak | specMean | orbBreath `1+bass*0.55` | 48-bar peak |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| silence | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1.000 | 0 |
| quiet 220 Hz amp 0.06 | 0.085 | 0.027 | 0 | 0 | 0.056 | 0 | **0.968** | 0.004 | **1.015** | 0.00 |
| pad 220 Hz amp 0.35 | 0.494 | **0.045** | 0 | 0 | 0.270 | 0 | **1.000** | 0.008 | **1.025** | **0.072** |
| kick 70 Hz | 0.393 | 0.166 | 0.010 | 0 | 0.280 | **0.972** | 0.455 | 0.031 | 1.091 | 0.51 |
| snare | 0.203 | 0.256 | 0.240 | 0.239 | 0.229 | **0.983** | 0.369 | 0.242 | 1.141 | 0.39 |
| bass 55 Hz amp 0.55 | **0.770** | **0.045** | 0 | 0 | 0.408 | 0 | **1.000** | 0.008 | **1.025** | 0.75 |
| 110 Hz amp 0.1 → 1.0 | 0.140 → 1.00 | **0.028 → 0.046** | — | — | 0.084 → 0.523 | — | **1.0 → 1.0** | — | — | — |

### Classification: **F** (B + A + C + E). D is already fine.

| Code | What | Evidence |
| --- | --- | --- |
| **B bands** | FFT-average bass/mid/treble is occupancy, not level | Loud 55 Hz tone: rms **0.770**, bass **0.045** — same bass as a quieter 220 Hz pad. Amp 0.1→1.0 moves bass by **+0.018**. Cause: peak bins saturate in the `[-100, -30]` byte map, then `avg(0..170)` dilutes them. |
| **A spectrum** | Peak saturates early; mean stays empty; 48-bar sampling misses the peak | Pad specPeak **1.0**, specMean **0.008**, `barsPeakPow` **0.072** (sample step ≈ 22 bins, peak at bin 9). |
| **C energy** | `0.5*rms + 0.5*bass` pulled down by B | Kick energy **0.280**; pad **0.270**. |
| **D beatPulse / onset** | Already dramatic on transients | Kick / snare beatPulse **~0.97–1**. Do not permanently inflate every bin to fake this. |
| **E scene curves** | Builtins assume bass ≳ 0.3 for a visible breath | `1 + 0.045*0.55 = 1.025`. Scenes are not individually retuned. |

The analyser is truthful. The presentation range is not useful. **Do not retune FFT / smoothing / dB / band edges to look stronger.**

## Phase 2 — shared VIS response layer

```
REAL AUDIO → shared feature analysis (raw) → applyVisResponse → scene renderer
```

One function for Preview and Export. No export boost. No preview boost.

### Mapping (locked constants)

`shape(x) = clamp01(pow(clamp01(x * gain), gamma))`

| Knob | Value | Why |
| --- | --- | --- |
| `gain` | **1.2** | Mild lift. A 0.35 pad rms (0.494) shapes to ~0.67, not 1. |
| `gamma` | **0.75** | Expands mid-lows; still strictly monotonic. |
| `spectrumSpreadBins` | **12** | Peak-hold radius at 1024 bins so 48-bar sampling sees a narrow FFT peak. Scales with bin count. |
| `transientBoost` | **0.24** | Added to **energy only** on a true onset. rms / bass / mid / treble stay continuous. |

Derived (not extra knobs):

- `presence = shape(rms)` — amplitude carrier (RMS is the truthful level).
- `visBand = max(shape(rawBand), presence * (rawBand / sum))` — restores level for tonal content; keeps broadband snare bands from being diluted by the mix.
- Spectrum bins: `min(shape(smeared), presence)` after a 12-bin peak-hold. dB-sat peaks cannot outrun RMS (quiet sine ≠ full-scale bars; no hard sat cliff).
- `visBeatPulse = onset ? 1 : shape(raw.beatPulse, gain=1, gamma)`
- `energy = 0.5*visRms + 0.5*visBass`; `+ transientBoost` on onset.
- `high = visTreble`.

Mute / silence gate still happens in the analyser. `applyVisResponse(0) = 0`. No AGC. No per-project peak normalize. 0.25 amp < 0.50 < 1.00. Automation and fader still scale the mix PCM, so they still scale VIS.

Raw `AudioFeatures` (and the extractor’s smoothed dB state) are not overwritten. `applyVisResponse` copies spectrum.

## Untouched

VIS-SYNC-01 architecture (shared adapters, sequential export state, no `syntheticSpectrum` while PCM exists). AUDIO-01 mix / mux. AFE / ENC-01 / STRESS-01..04. Scene renderers (no per-scene retune). Track/master volume semantics.

## Tests

`tests/visualizer/vis-response-01-impact-layer.test.ts`

1. Silence → zero
2. 0.25 < 0.50 < 1.00 amplitude
3. Muted → zero
4. Automation reduction lowers response
5. Kick transient stronger than tail / not a maxed pad
6. Sustained pad does not permanently max out
7. Spectrum bounded 0..1
8. Preview and Export same transform
9. VIS-SYNC-01 file still green
10. AUDIO-01 file still green
11. Existing scene / visualizer tests green

Plus Phase 1 evidence, raw-not-mutated, monotonicity sweep 0.0..1.0 step 0.1.

`tsc --noEmit` clean. Focused gate **131/131**. Full suite **1297 passed / 6 failed / 1303** (same 2 AFE-15 A/N dump-ban + 4 STRESS-03 missing operator clip). `vite build` OK.

### Before / after (same PCM, raw extractor vs `applyVisResponse`)

| PCM | raw rms | vis rms | raw bass | vis bass | raw energy | vis energy | orbBreath raw | orbBreath vis |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| silence | 0 | 0 | 0 | 0 | 0 | 0 | 1.000 | 1.000 |
| quiet 220 Hz amp 0.06 | 0.085 | 0.180 | 0.027 | 0.180 | 0.056 | 0.180 | 1.015 | 1.099 |
| pad 220 Hz amp 0.35 | 0.494 | 0.676 | 0.045 | 0.676 | 0.270 | 0.676 | 1.025 | **1.372** |
| kick 70 Hz | 0.393 | 0.570 | 0.166 | 0.534 | 0.280 | 0.552 | 1.091 | **1.294** |
| snare | 0.203 | 0.346 | 0.256 | 0.412 | 0.229 | 0.379 | 1.141 | 1.227 |
| bass 55 Hz amp 0.55 | 0.770 | 0.943 | 0.045 | **0.943** | 0.408 | 0.943 | 1.025 | **1.518** |

Pad 48-bar peak: raw **0.072** → vis **0.717**. Preview rms == Export rms on the pad (0.676). Amp 0.25 < 0.50 < 1.00. Amp 0.6+ clips because `gain*rms` hits 1 (raw RMS already clips at ~0.8). No downward inversion.

## Operator card — MODE B (coordinator builds the EXE)

Compare this branch to VIS-SYNC-01 `3b16a09` on the same ~34:18 production project (1920×1080@30, AILEXSI, VIDEO+VIS+AUDIO, Fertig, playable MP4, audio present, VIS present).

1. Build MODE B from **this branch SHA** (`npm run tauri:exe` / `BUILD_AND_RUN_V5.5.cmd`). This agent does not build the Windows EXE.
2. Chip **5.5.0**, Frame Engine **AILEXSI**.
3. **First:** 30–60 s obvious-beat section. Preview vs export vs memory of `3b16a09`:
   - more impact than `3b16a09` (kicks hit, pads breathe)
   - quiet stays quiet
   - lower fader → visibly lower VIS
   - automation looks natural
   - Preview ≈ Export
4. Longer (~34:18) only after the short pass.
5. Do **not** start AUDIO-02 / 2 h buffer work. Do **not** merge.

**Build SHA:** PR tip of `cursor/vis-response-01-impact-layer-e2d7`. Coordinator builds from the PR HEAD.

**EXE path / EXE SHA256:** left for the coordinator. This agent does not build the Windows EXE.

**HUMAN acceptance pending.**
