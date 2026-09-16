# VIS-SYNC-01 — Preview / export audio-reactivity parity

Base: AUDIO-01 tip `e2ad592` (branch `cursor/audio-01-long-form-fail-honest-80b1`, PR **#23**). Do **not** merge PR #19 / #20 / #21 / #22 / #23 or this branch.

## Human evidence (pre-fix)

AUDIO-01 long-form export: ~29 min 1920×1080@30 VIDEO+VIS+AAC with **audible** audio in the final MP4.

Visualizer in that MP4 behaves as if little/no musical sync. Studio playback of the **same** project / track / volume reacts correctly.

`AUDIO MIX PASS · AAC PASS · VIS PREVIEW REACTIVITY PASS · VIS EXPORT REACTIVITY FAIL.`

Do **not** blame track volume. Lower volume → lower VIS (intentional). Mute → silence. No synthetic BPM while real audio exists.

## Phase 1 — proven first semantic divergence

Hypothesis confirmed with numbers on a known 2 s segment (quiet / kick @400 ms / snare @720 ms / 220 Hz pad @1000–1500 ms). Preview path = shared analyser core (`fftSize` 2048, Blackman, dB `[-100, -30]`, smoothing `0.75`, `third = floor(1024/6)`). Legacy export = `featuresFromMix` / `mixEnergyAt` + `syntheticSpectrum()` as shipped on `e2ad592`.

| t (ms) | path | rms | bass | mid | treble | energy | spectrum bins |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 80 quiet | preview | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | **1024** |
| 80 quiet | legacy export | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | **64** |
| 420 kick | preview | **0.414** | 0.184 | 0.019 | 0.000 | **0.299** | **1024** |
| 420 kick | legacy export | **0.105** | 0.123 | 0.060 | 0.006 | **0.114** | **64** |
| 736 snare | preview | 0.203 | 0.163 | **0.152** | **0.151** | 0.183 | **1024** |
| 736 snare | legacy export | 0.081 | 0.064 | 0.082 | 0.084 | 0.072 | **64** |
| 1200 pad | preview | 0.494 | **0.046** | 0.000 | 0.000 | 0.270 | **1024** |
| 1200 pad | legacy export | 0.492 | **0.566** | 0.278 | 0.016 | 0.529 | **64** |

Deltas (preview − legacy):

| segment | Δrms | Δbass | Δmid | Δtreble | Δenergy | Δbins |
| --- | --- | --- | --- | --- | --- | --- |
| quiet | 0 | 0 | 0 | 0 | 0 | **+960** |
| kick | **+0.309** | +0.061 | −0.042 | −0.006 | **+0.185** | **+960** |
| snare | +0.122 | +0.099 | +0.069 | +0.067 | +0.110 | **+960** |
| 220 Hz pad | +0.002 | **−0.521** | −0.278 | −0.016 | −0.259 | **+960** |

### FIRST divergence (not a volume bug)

**Export never ran a real FFT when PCM existed.** It used a ~23 ms time-domain window, a 1-pole LPF for “bass”, sample-diff for “treble”, and `syntheticSpectrum()` — 64 bins of 3-band ramp + `sin(timeMs)` wobble. Preview `createFeatureExtractor` uses AnalyserNode `fftSize` 2048 → 1024 bins, band averages, and persistent `prevEnergy` / `lastOnsetTime`.

That is enough to make spectrum-bars / wave / tunnel look unsynced and to under-read kicks (legacy kick RMS 0.105 vs preview 0.414) while a sustained tone inflates LPF bass (0.566 vs FFT-diluted 0.046). Onset history was rebuilt from a 400 ms lookback every frame instead of sequential state.

Secondary (same family): causal 2048-sample window vs centered 23 ms window; raw 10 ms `prevEnergy` vs smoothed persistent state.

## Phase 2 — shared engine

One musical-analysis core. Two adapters.

| | Preview (A) | Export (B) |
| --- | --- | --- |
| Input | AnalyserNode `getByteFrequencyData` / `getByteTimeDomainData` | Mixed `AudioBuffer` PCM (export-range clock) |
| FFT | Browser AnalyserNode | Deterministic radix-2 + Blackman, same dB map |
| Shared | `bandsFromSpectrum`, `rmsFromTimeDomain`, `assembleAudioFeatures` / `stepOnset`, silence gate | same |
| State | `prevEnergy`, `lastOnsetTime` across `sample()` | same + smoothed dB spectrum; frame N+1 advances from N |

`syntheticSpectrum()` remains **only** for the empty-project 120 BPM fallback (`featuresAt`). It is not used when real PCM exists.

### Matched constants

| Knob | Value |
| --- | --- |
| `fftSize` | 2048 |
| `frequencyBinCount` | 1024 |
| Band split | `third = floor(1024/6)` = 170 → bass 0–~3.66 kHz, mid ~3.66–11.0 kHz, treble ~11.0–22.05 kHz (Preview’s bin thirds, not musical octaves) |
| Window | Blackman (Web Audio AnalyserNode) |
| Smoothing | 0.75 per `sample()` in the dB domain; first hop unsmoothed |
| RMS | `min(1, sqrt(mean(s²)) * 2)` |
| Silence gate | `rms < 0.02 && bass < 0.03` → zero bands / onset / beatPulse |
| Onset | `Δenergy > 0.12` and refractory 120 ms |
| `beatPulse` | 1 on onset, linear decay 360 ms |
| Offline window | Causal: last 2048 samples ending at `timeMs` (live analyser = most recent) |
| Volume | Mix level is the signal. Half amplitude → lower RMS / energy. No peak-normalize. |

Export hop = `1000/fps` so 30 fps is deterministic. Same-time re-sample is cached (VIS is painted twice per canvas encode). Long jumps hop-fill; backward seek resets and warms up 500 ms.

### Timeline clock

`jobFromProject` remaps clips, VIS events, and automation to export-local time (`visibleStart - IN`). OfflineAudioContext length is `durationMs`. Frame `timeMs = i/fps*1000`. Feature `sample(timeMs)` reads the mix at that local time. `timelineOriginMs` is **only** for the no-mix 120 BPM fallback. Tested at IN=0 and IN=2500.

## Untouched

Scenes; AUDIO-01 mix / `expectsAudio` / mux validator; track/master volume semantics; AFE / ENC-01 / STRESS-01..04 mux; Mediabunny / WebM. No BPM fallback while PCM exists. Not merged.

## Tests

`tests/visualizer/vis-sync-01-preview-export-parity.test.ts`

1. Impulse/kick — preview-equivalent and offline onset same timestamp
2. 80 Hz sine — bass-dominant, preview ≡ export
3. 12 kHz — treble-dominant
4. Silence — both gated
5. Volume 1.0 vs 0.5 — export response decreases
6. Automation / envelope — features follow mixed level
7. Non-zero export IN — feature / mix / remapped VIS share the export-range clock
8. Sequential 30 fps — onset / beatPulse deterministic
9. AUDIO-01 file green (untouched)
10. Existing VIS scene tests green

Plus Phase 1 numeric table and host routing (live tap wins while playing; gap still quiet).

## Operator card — MODE B (coordinator builds the EXE)

Same project as the AUDIO-01 long-form VIDEO+VIS+AAC pass (audible soundtrack, VIS looked unsynced).

1. Build MODE B from **this branch SHA** (coordinator: `npm run tauri:exe` or `BUILD_AND_RUN_V5.5.cmd`). This agent does not build the Windows EXE.
2. Chip **5.5.0**, Frame Engine **AILEXSI**.
3. Same project / track / volume. Do not raise volume to “fix” VIS.
4. **First:** short **1–2 min** IN–OUT with obvious kicks. Studio preview vs exported MP4:
   - kicks / onsets land on the same hits
   - quiet bars stay quieter
   - lower fader → lower VIS amplitude (not a full-scale fake)
5. **Then** (only if short passes): the ~29 min 1080p30 export. Soundtrack must stay audible (AUDIO-01). VIS must stay musically synced for the whole file.
6. If it fails: say whether short, long, or both; whether audio is still present; whether VIS is late, dead, or only spectrum-wrong.

**Build SHA (this branch tip):** `8d68e06152d68cc38ec4b9888557885d4bc5cb83` (`8d68e06`). Coordinator builds the EXE from this SHA (or the tip after any follow-up commits).

**EXE path / EXE SHA256:** left for the coordinator. This agent does not build the Windows EXE.

**Do not merge** until MODE B confirms preview/export VIS parity on the short clip (and long-form if short passes).
