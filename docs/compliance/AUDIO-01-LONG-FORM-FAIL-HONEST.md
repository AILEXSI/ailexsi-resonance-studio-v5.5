# AUDIO-01 — Long-form audio export must not silently disappear

Base: STRESS-04 tip `942edd3` (branch `cursor/stress-04-mp4-mux-arg-overflow-11b1`). Do **not** merge PR #19 / #20 / #21 / #22 or this branch.

## Human-proven video context

STRESS-04 tip EXE: 1920×1080 @30 ~29 min, VIDEO+VIS+AUDIO timeline, Export **Fertig**. Mux call-stack overflow fixed. Output MP4 has **no audible audio** (reproduced more than once). VIDEO / AFE / VIS / large-sample mux = PASS. **Long-form audio export = FAIL.**

## Verdict: **A — duration-unsafe success timeout**

Proven by production code on the STRESS-04 tip (not a hypothesis after the audit):

```ts
mixed = await withTimeout(mixJobAudio(job, …), 12000, null);
encoded = await withTimeout(encodeAac(mixed, …), 12000, null);
// null → audioTrack undefined → audioKind = "none" → success: true
```

`withTimeout` **resolves the fallback** (`null`) at 12s. The exporter then continues as **video-only success**. Mix and AAC encode both scale with duration. A ~29 min OfflineAudioContext + AAC encode cannot finish in 12s wall clock, so audio is discarded and Fertig still reports success.

| Class | Meaning | AUDIO-01 |
| --- | --- | --- |
| **A** | Duration-unsafe fixed timeout treated as success | **PROVEN root cause** of silent missing audio |
| B | OfflineAudioContext API limit | Not required to explain the 12s drop. 29 min @ 44.1 kHz stereo is a legal context size. |
| C | Raw PCM memory | 29 min ≈ **585 MiB** mix buffer (see below). May contribute under low RAM; not the silent-success path. |
| D | AAC `encodeQueueSize` unbounded | **Contributing risk** for 29 min (~75k frames). Hardened with high-water wait. Not the Fertig-without-audio mechanism. |
| E | Missing AudioSpecificConfig description | Would have returned `null` then video-only success. Now a **LOUD FAIL**. Not proven on the human MP4. |
| F | Mux omission / missing `soun` trak | STRESS-04 mux is PASS. Silent `audioKind = "none"` after a missing trak is removed. |
| G | Other | No AFE / ENC-01 / VIS / WebM / Mediabunny involvement. |

**Exact proven root cause:** `withTimeout(…, 12000, null)` around `mixJobAudio` / `encodeAac` maps slow long-form audio to `null`, and the exporter treats that as a valid video-only `success: true`.

## OfflineAudioContext memory (44.1 kHz stereo Float32)

| Duration | Frames | Bytes | MiB |
| --- | --- | --- | --- |
| 29 min | 76 734 000 | 613 872 000 | **585.4** |
| 60 min | 158 760 000 | 1 270 080 000 | **1211.3** |
| 120 min | 317 520 000 | 2 540 160 000 | **2422.6** |

Plus decoded source buffers. AUDIO-01 does **not** stream the mix. If timeout + backpressure + fail-honest is enough for the ~29 min human project, keep this ticket narrow.

## What changed

| Item | Behavior |
| --- | --- |
| Stages | Exact AUDIO-01 names on the export fail/report path (not console-only). |
| `expectsAudio(job)` | Deterministic. Reuses `audioClipsForMix` + baked mute/solo/volume/master/gain + automation silence + `hasAudio === false` + skipMix/mates. Video-only / muted → false → video-only MP4 valid. True → success **must** contain AAC. A produced mix buffer is also required to encode (do not drop discovered audio). |
| Timeouts | Duration-scaling mix/encode **no longer** use a 12s success fallback. Probe is a capability check (no success-null). Cancellation is `AbortSignal`. |
| Fail-honest | Mix fail / AAC fail / missing description / empty samples / mux omission / missing MP4 `soun` trak → `FAIL:` + AUDIO-01 dump. |
| AAC backpressure | `encodeQueueSize` high-water **8**, wait on `dequeue` (same spirit as video). |
| Mux | STRESS-04 iterative tables unchanged. Missing trak is a loud fail, not `audioKind = "none"`. |

## Untouched

AFE scheduling; STRESS-01; STRESS-03; STRESS-04 mux helpers/semantics (no new spread); ENC-01; H.264 selection; VideoDecoder; VIS render; WebM fallback (still none); Mediabunny (still absent). No arbitrary timeout bump. No 2h streaming redesign (AUDIO-02).

## AUDIO-02 (future — do not implement here)

Streamed mix/encode so 60–120 min does not hold ~1.2–2.4 GiB of Float32 PCM plus sources. Needed if MODE B 60/120 OOM or if 29 min is already memory-bound on the operator machine.

## 60 / 120 readiness (architecture only)

| Duration | Classification | Why |
| --- | --- | --- |
| ~29 min | **GREEN** after AUDIO-01 (timeout + backpressure + fail-honest). Human Fertig+audible still required. | 585 MiB mix is plausible on typical Windows. |
| 60 min | **YELLOW** | 1.2 GiB mix + sources. May OOM in WebView2. Same API; no streaming. |
| 120 min | **RED** | 2.4 GiB mix + sources. Do not claim ready. AUDIO-02 streaming. |

## Tests

`tests/export/audio-01-long-form-fail-honest.test.ts` — **17/17**.

- A short audio → AAC trak
- B video-only → none
- C muted/inaudible → `expectsAudio` false
- D mix >12s → audio kept
- E AAC >12s → audio kept
- F mix fail + expectsAudio → LOUD FAIL
- G AAC fail → LOUD FAIL
- H description missing → LOUD FAIL
- I samples empty → LOUD FAIL
- J mux receives audio / `mp4HasAudioTrack`
- K 25k video mux still valid (STRESS-04 contract)
- L 75k AAC samples — no arg overflow
- plus backpressure, no-`withTimeout` audit, fail-dump path, PCM quantification, exact stage names

Gates on this tip: `tsc --noEmit` clean. Focused AUDIO-01 + STRESS-04 + STRESS-03 stage + STRESS-02 + STRESS-01 + AFE-25 + ENC-01 + aac-mux + export **80/80**. Full suite **1264 passed / 6 failed / 1270** (same 2 pre-existing AFE-15 A/N dump-ban; 4 STRESS-03 physical tests need the operator clip, absent in the agent VM). `vite build` OK.

## Operator card — MODE B (coordinator builds the EXE)

Same **~29:11 1080p30 VIDEO+VIS+AUDIO** project as the silent-audio repro.

1. Build MODE B from **this branch SHA** (coordinator: `npm run tauri:exe` or `BUILD_AND_RUN_V5.5.cmd`). This agent does not build the Windows EXE.
2. Chip **5.5.0**, Frame Engine **AILEXSI**.
3. Same project / IN–OUT / 1920×1080 / 30 fps / audio audible on the timeline.
4. Export to the end.
5. Required for pass:
   - Dialog **Fertig** (not a silent video-only success with missing soundtrack)
   - MP4 has **audible AAC** at **start, mid, and end**
   - Picture/audio **A/V sync**
   - `videoReq == videoDec == videoEnc` still holds (STRESS-04 mux stays green)
6. Record `mixElapsedMs`, `aacElapsedMs`, `aacOutputCount`, `mixedBufferLength`, `offlineFrameLength` from the AUDIO-01 report (success `audioReport` or fail dump).
7. If it fails: scroll failed-status, copy `FAIL:` + AUDIO-01 `lastStage` / `stageTrail` / `expectsAudio` / timings. That names the first audio stage that did not complete.

**EXE path / build SHA:** left for the coordinator.

**Do not merge** until MODE B confirms Fertig + audible AAC start/mid/end + A/V sync.
