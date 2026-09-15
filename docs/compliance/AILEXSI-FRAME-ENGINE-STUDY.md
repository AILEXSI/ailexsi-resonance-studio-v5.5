# AILEXSI Frame Engine — architecture (V5.5) + historical AFE-01/02/03 study

**V5.5 production:** AILEXSI Frame Engine is the only export frame source. Mediabunny is removed. Preview HTMLVideo is unchanged. AFE-03 optimizations (streaming sequential path, ready queue, precomputed plan, prefetch 4) are kept. **AFE-04** adds B-frame / varying CTTS support (PTS-keyed match, decode order unchanged).

Architecture (current):

```
MP4 → AILEXSI ISO-BMFF READER → VIDEO TRACK → SAMPLE TABLE → KEYFRAME INDEX
  → PTS/DTS MAP → ENCODED H.264 SAMPLE ACCESS → WEBCODECS VideoDecoder
  → VideoFrame → CANVAS / existing exporter
```

Files: `src/core/frame-engine/*`, `src/core/exporter/frame-source.ts`, `src/core/exporter/webcodecs.ts`.

AFE-03 official summary: `docs/compliance/afe-03-evidence-summary.json` (classification `AFE-EQUAL` vs then-current Mediabunny — **historical comparison**, labelled). Obsolete AFE-01/AFE-02 raw JSON was removed in V5.5.

The AFE-01 / AFE-02 / AFE-03 narrative below is **HISTORICAL V5**. Production default rows that say Mediabunny are not V5.5.

# AILEXSI Frame Engine Study (AFE-01) — HISTORICAL

First-party **input** frame source for Resonance export. Method: FACT → EVIDENCE → MEASUREMENT → RESULT. First-party is not a reason to call it better.

| Item | Value |
| --- | --- |
| Initial `main` SHA | `a922c6eb77cb68494fbde9bd222a16b46ad00b32` (verified `git rev-parse HEAD` before branch) |
| Branch | `cursor/ailexsi-frame-engine-0260` |
| Mediabunny version | **1.55.3** (unchanged; production default) |
| Production default after this pass | Mediabunny (`getFrameSourceBackend()` === `"mediabunny"`) |
| Mediabunny removed | **NO** |
| package-lock removal | **NO** |
| SBOM regenerated | **NO** |
| Product license changed | **NO** |
| schemaVersion / app version | **5** / **5.0.0** (untouched) |
| AUTO line | Untouched (`src/core/transition.ts` `resolvePictureSource` fallback) |

## Scope

AFE is specialized **only** for Resonance export:

`SOURCE MEDIA → video track → exact source-frame timestamps → keyframe/sample indexing → decode requested frame → drawable VideoFrame → Canvas`

Primary: **MP4 / H.264 AVC**. Not implemented: MKV, WebM, HLS, MP3, editing, encoding, AAC, output muxing, image processing, UI, timeline, audio mixing.

## Architecture

```
MP4 → AILEXSI ISO-BMFF READER → VIDEO TRACK → SAMPLE TABLE → KEYFRAME INDEX
  → PTS/DTS MAP → ENCODED H.264 SAMPLE ACCESS → WEBCODECS VideoDecoder
  → VideoFrame → CANVAS / existing exporter
```

Files:

| File | Role |
| --- | --- |
| `src/core/frame-engine/types.ts` | Backend + movie types |
| `src/core/frame-engine/errors.ts` | Typed `AfeError` codes |
| `src/core/frame-engine/mp4-reader.ts` | Minimal ISO-BMFF parse + PTS lookup |
| `src/core/frame-engine/sample-table.ts` | stts/ctts/stsc/stsz/stco/stss expand |
| `src/core/frame-engine/avc-config.ts` | avcC → `VideoDecoderConfig` |
| `src/core/frame-engine/decoder.ts` | WebCodecs `VideoDecoder` session |
| `src/core/frame-engine/scheduler.ts` | Sequential vs random decode |
| `src/core/frame-engine/cache.ts` | Bounded decoded-frame LRU |
| `src/core/frame-engine/backend.ts` | Three identities |
| `src/core/frame-engine/index.ts` | Public exports |
| `src/core/exporter/frame-source.ts` | Switch + `sourceTimeSec` (unchanged math) |

## Minimal ISO-BMFF

Parsed only when required for a single primary AVC track with a normal sample table:

`ftyp`, `moov`, `trak`, `mdia`, `minf`, `stbl`, `stsd`/`avc1`/`avcC`, `stts`, optional `ctts` (absent / v0 unsigned / v1 signed, constant or varying), `stsc`, `stsz`, `stco`/`co64`, `stss`, `mdhd`, `hdlr`, single-entry `elst` with `media_rate = 1` and no start-delay empty edit.

Unsupported (fail cleanly, never guess a frame): fragmented `moof`/`mvex`, missing video, non-AVC, `stz2`, unknown `ctts` version, broken table counts, multi-edit lists, empty-edit start delay. Varying CTTS / B-frames are **supported** (AFE-04).

## Output encoding

**Not touched.** `VideoEncoder` profile, bitrate, AAC, muxer, 720p/1080p presets stay in `webcodecs.ts` / `mp4.ts` / `audio.ts`. AFE is input-only.

## Backend abstraction

```
FrameSourceBackend { open }
OpenedFrameSource { getFrameAt, getFramesAt, close }
```

Identities: `ailexsi` | `mediabunny` | `htmlvideo`. Production default **mediabunny**. No user-facing UI switch.

## Optimize for Resonance

Sequential `0,1,2,3…`: keep decoder warm, decode forward, `getFramesAt` does not reset per frame, LRU cache of decoded `VideoFrame`s.

Random `10s / 2s / 25s / 5s / 18s / 1s`: nearest prior keyframe, reset, decode forward only as needed, intermediates evicted.

## Batch API

`getFramesAt([t0,t1,…])` is the export path (`samplesAtTimestamps`). Single `getFrameAt` is not the only API.

## Exactness

Mediabunny contract (1.55.3): last sample in presentation order with start timestamp **≤** request; null if before the first sample.

CFR identity scoring: `expectedFrame = floor(requestedSec * fps)`. AFE must equal Mediabunny. 0 ±1, 0 keyframe snap, 0 silent substitution.

## Test data

Generated by `node scripts/generate-afe-media.mjs` (ffmpeg 6.1.1 libx264). Not internet media. Not `user-video.mp4`.

| File | fps | duration | GOP | frames |
| --- | --- | --- | --- | --- |
| `afe-cfr-30-g1-2s` | 30 | 2s | 1 | 60 |
| `afe-cfr-30-g24-2s` | 30 | 2s | 24 | 60 |
| `afe-cfr-30-g25-2s` | 30 | 2s | 25 | 60 |
| `afe-cfr-30-g30-2s` | 30 | 2s | 30 | 60 |
| `afe-cfr-30-g50-3s` | 30 | 3s | 50 | 90 |
| `afe-cfr-30-g60-8s` | 30 | 8s | 60 | 240 |
| `afe-cfr-30-g250-28s` | 30 | 28s | 250 | 840 |
| `afe-cfr-24-g24-2s` | 24 | 2s | 24 | 48 |
| `afe-cfr-25-g25-2s` | 25 | 2s | 25 | 50 |
| `afe-cfr-50-g50-2s` | 50 | 2s | 50 | 100 |
| `afe-cfr-60-g60-2s` | 60 | 2s | 60 | 120 |
| `afe-cfr-30-g30-720p-2s` | 30 | 2s | 30 | 60 @ 1280×720 |

## Expand benchmark

`tests/export/afe-plan.ts` builds ≥10,000 deterministic requests: sequential, sequential-repeat, random, Source In/Out, clip rate, repeated segments, keyframe boundaries, mid-GOP, near-end, mixed fps. Every mismatch records file, requested time, Mediabunny frame/PTS, AFE frame/PTS, DTS, nearest keyframe, delta.

## Performance

Correctness first. Targets (not claims):

- A: AFE avg ≤ Mediabunny
- B: sequential batch throughput > Mediabunny
- C: worst ≤ Mediabunny where practical
- D: no unbounded memory on long sequential

No caching of expected barcode indices.

## Memory

`DecodedFrameCache`: max decoded-frame count (default 12), approx RGBA bytes, explicit `VideoFrame.close()`. Simulated 2s / 28s / 7min / 30min-tail in the Chrome harness.

## Cancellation

`AbortSignal` on `open` / `getFrameAt` / `getFramesAt`. Abort → `AFE_ABORTED`, decoder/frames closed, waiters rejected. Not fallback-safe.

## Error containment

| Code | Meaning |
| --- | --- |
| `AFE_UNSUPPORTED_CONTAINER` | Not ISO-BMFF / missing ftyp or moov |
| `AFE_UNSUPPORTED_CODEC` | No H.264 video track |
| `AFE_UNSUPPORTED_SAMPLE_TABLE` | Fragmented, broken tables, unknown CTTS version |
| `AFE_DECODE_CONFIG_FAILED` | `VideoDecoder` missing or config rejected |
| `AFE_DECODE_FAILED` | Decode error |
| `AFE_ABORTED` | Caller cancelled |

Unsupported → caller may open Mediabunny. Production `getDecoder("ailexsi")` does that fallback. Never a guessed frame.

## Mediabunny as oracle

Vitest: `EncodedPacketSink.getPacket` vs AFE `sampleIndexAtTime` on the full plan.

Chrome: pixel barcode vs Mediabunny `getFrameAt` / `getFramesAt`.

## Do not remove Mediabunny

`package.json` still `"mediabunny": "^1.55.3"`. Lock not rewritten to drop it. SBOM / LICENSE-INVENTORY untouched. HTMLVideo fallback remains. AFE is not the production default.

## Resonance semantics

`sourceTimeSec`, `videoClipAt`, fades, crossfades, V1/V2, VIS, IN/OUT are compositor/planner. Backend identity does not change them. Covered by `tests/export/afe-semantics.test.ts`.

## Real export

Chrome harness: 720p30 source → AFE or Mediabunny → existing canvas → existing `VideoEncoder` → existing `muxAvcToMp4`. 1080p is not an AFE gate.

## Windows

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES**

### HUMAN verification procedure (Windows EXE / WebView2)

1. Check out this branch on the owner Windows machine. `npm ci`. Do not change the production default.
2. Run `npm run web:dev` **and** `npx tauri dev` (or Root-Exe). Record WebView2 / Edge version.
3. Open `http://127.0.0.1:1421/scripts/afe-frame-harness.html` (Vite; file is **not** in `public/` / `dist`).
4. Wait for `AFE_DONE`. Save `window.__AFE_RESULT` (or run `npm run afe:chrome` if Chrome is available).
5. Compare to this study:
   - Any AFE **>1 FRAME ERROR** or mismatch vs Mediabunny → **AFE-FAIL**. Keep Mediabunny default.
   - AFE EXACT on the plan, but slower → **AFE-CORRECT** or **AFE-COMPETITIVE**, not superior.
   - Sequential batch and worst latency must be measured on WebView2, not inferred from Linux Chrome.
6. Optional: export a 720p30 timeline twice (`setFrameSourceBackend("mediabunny")` vs `"ailexsi"` locally). Compare files. Do **not** land AFE as default.
7. Evidence required for HUMAN-PROVEN: Task Manager + in-app Export Fertig + harness totals from **this** Windows host.

## Decision gates

| Class | Rule |
| --- | --- |
| **AFE-FAIL** | Any mismatch vs Mediabunny, or decode/export failure on supported fixtures |
| **AFE-CORRECT** | Exact vs Mediabunny; not faster / not clearly bounded-better |
| **AFE-COMPETITIVE** | Exact; some metrics win, others do not |
| **AFE-SUPERIOR** | Exact + sequential batch win + practical worst + bounded memory + Windows evidence |

Only **AFE-SUPERIOR** is eligible for a later production-default **trial**. Even then Mediabunny stays the fallback next phase.

## Measurements

Inspected on this branch after `npx tsc --noEmit`, targeted vitest, full suite, `npm run build`, and `node scripts/afe-run-chrome.mjs`.

Environment: **AGENT/BROWSER VERIFIED** — HeadlessChrome/148.0.0.0, Linux x86_64, `VideoDecoder` + `VideoEncoder` present. Not Windows WebView2.

### Packet oracle (jsdom / Mediabunny demux)

`EncodedPacketSink.getPacket` vs AFE `sampleIndexAtTime` on the full plan (`tests/export/afe-oracle.test.ts`).

| | |
| --- | --- |
| TOTAL FRAME REQUESTS | **10228** |
| MEDIABUNNY EXACT (packet PTS) | **10228** |
| AFE EXACT | **10228** |
| AFE MISMATCHES | **0** |

Plan mix: sequential 1728, sequential-repeat 1776, random 3700, long-GOP mix 1831, clip-rate 660, keyframe-boundary 228, mixed-fps 110, source-in-out 99, repeated-segment 88, 720p sample 8.

### Pixel oracle (Chrome 148)

Same identity barcodes. Sequential used `getFramesAt`; random used reused `getFrameAt`.

| Backend | EXACT | WITHIN 1 | >1 | FAILED | UNKNOWN |
| --- | --- | --- | --- | --- | --- |
| Mediabunny | **2960** | 0 | 0 | 0 | 0 |
| AILEXSI | **2960** | 0 | 0 | 0 | 0 |

Compared 2960 painted timestamps. A/B same presented index: 2960/2960.

Required random 10s / 2s / 25s / 5s / 18s / 1s on GOP-250 28s: **6/6 EXACT on both** (frames 300, 60, 750, 150, 540, 30).

### Performance (Chrome 148, real parse+decode)

| | Mediabunny | AILEXSI | Winner |
| --- | --- | --- | --- |
| Sequential batch (n=1728) avg | **0.262 ms** | 0.300 ms | **MEDIABUNNY** |
| Sequential batch total | 452 ms | 518 ms | MEDIABUNNY |
| Random (n=1232) avg | **1.598 ms** | 1.639 ms | **MEDIABUNNY** |
| Worst random | 25.5 ms | **23.4 ms** | AILEXSI (small) |
| All pixel retrievals avg | **0.818 ms** | 0.857 ms | MEDIABUNNY |
| 720p30 export wall | **283 ms** | 650 ms | MEDIABUNNY |

Study Mediabunny baseline on PR #22 (840 timestamps, different harness): avg ≈ 3.59 ms, total ≈ 3.02 s, worst ≈ 33.1 ms. This pass is a different request mix and reuses an opened source, so averages are not directly comparable to that 3.59 ms figure. Relative A vs AFE on **this** harness is the measurement that matters.

### Memory

AFE cache max = 12 decoded frames. 28s GOP-250 pass peaked at **12 frames / 752640 bytes** (~0.72 MiB RGBA estimate) and did not grow past the cap. 7min-sim (210 loops of the 2s all-intra file) and 30min-tail (50 more loops) ended at 0 cached frames (ownership transferred and `close()`d each yield) with `stabilized: true`. No unbounded growth observed. Mediabunny’s internal decoder cache was not instrumented the same way.

### Abort / fallback

| Test | Result |
| --- | --- |
| AbortSignal mid-`getFramesAt` | **AFE_ABORTED**, 0 late frames |
| Non-MP4 (`README.md`) | **AFE_UNSUPPORTED_CONTAINER** (fallback-safe) |

### Resonance semantics

Planner/compositor tests (`afe-semantics.test.ts`) unchanged across `mediabunny` / `ailexsi` / `htmlvideo`. Chrome recorded `sourceTimeSec` rate-2 + Source In 2000 at timeline 250 ms = **2.5166… s** (same formula as production).

### 720p30 export

SOURCE → backend → existing canvas → existing `VideoEncoder` `avc1.42001f` → existing `muxAvcToMp4`.

| | success | bytes | wall |
| --- | --- | --- | --- |
| Mediabunny | yes | 20106 | 283 ms |
| AILEXSI | yes | 20141 | 650 ms |

Both OK. Downstream encode/mux not changed. 1080p not used.

## Decision

**AFE-COMPETITIVE.**

Not AFE-FAIL: 0 packet mismatches, 0 pixel mismatches, 0 ±1, 0 GOP snap, abort and unsupported-container behave.

Not AFE-SUPERIOR: sequential batch and random averages and 720p export wall time belong to **Mediabunny** on Chrome 148 Linux. Windows WebView2 is unverified.

AFE-COMPETITIVE because AFE is exact against the oracle, memory is capped, worst random was slightly lower here, and throughput is in the same band (about 15% slower sequential, about 3% slower random) — some metrics win, the ones that matter for beating Mediabunny do not.

**Production default stays Mediabunny.** AFE is a review-only challenger. Do not crown a winner. Do not merge as a default change.

```
INITIAL MAIN SHA: a922c6eb77cb68494fbde9bd222a16b46ad00b32
AFE IMPLEMENTED: YES
MEDIABUNNY BASELINE: 1.55.3; PR #22 study 840/840 EXACT, avg ≈ 3.59 ms (different mix)
CORRECTNESS TESTS: packet 10228/10228; pixels 2960/2960
TOTAL FRAME REQUESTS: 10228 (oracle) + 2960 (Chrome pixels)
MEDIABUNNY EXACT: 10228 packet / 2960 pixel
AFE EXACT: 10228 packet / 2960 pixel
AFE MISMATCHES: 0
SEQUENTIAL: MEDIABUNNY 0.262 ms / AFE 0.300 ms / WINNER MEDIABUNNY
RANDOM: MEDIABUNNY 1.598 ms / AFE 1.639 ms / WINNER MEDIABUNNY
WORST LATENCY: MEDIABUNNY 25.5 ms / AFE 23.4 ms
MEMORY: AFE cap 12 frames / 0.72 MiB peak on 28s; Mediabunny not equivalently metered
ABORT TEST: PASS (AFE_ABORTED, late=0)
FALLBACK TEST: PASS (AFE_UNSUPPORTED_CONTAINER)
FULL 720P30 EXPORT: both success
TYPECHECK: npx tsc --noEmit exit 0
TARGETED TESTS: 63 tests passed in 8 files
FULL SUITE: 932 tests passed in 107 files
BUILD: vite 7.3.6, 206 modules, version 5.0.0
WINDOWS WEBVIEW2 VERIFIED: NO
WINDOWS HUMAN TEST REQUIRED: YES
CLASSIFICATION: AFE-COMPETITIVE
PRODUCTION DEFAULT CHANGED: NO
MEDIABUNNY REMOVED: NO
PACKAGE LOCK REMOVAL: NO
LICENSE CHANGED: NO
```

# AFE-02 Performance Pass

Child of AFE-01 (PR #23 / `cursor/ailexsi-frame-engine-0260` @ `0d366163e9ce6a15ae6ec053f45c6185b113cbbb`). This pass **measured first**, then changed one bottleneck at a time. Production default remains Mediabunny. Output codec / mux / AAC / `avc1.42001f` untouched. schemaVersion **5** / app **5.0.0** / AUTO `resolvePictureSource` untouched.

| Item | Value |
| --- | --- |
| Starting ref | `0d366163e9ce6a15ae6ec053f45c6185b113cbbb` (PR #23 tip) |
| AFE-02 branch | `cursor/ailexsi-frame-engine-afe-02-3e21` |
| Mediabunny | **1.55.3** (unchanged) |
| Production default | Mediabunny |
| Evidence | `docs/compliance/afe-02-evidence-summary.json`, `docs/compliance/afe-02-baseline-preopt.json` |

## Instrumentation

Local-only `AfePerfStats` (`src/core/frame-engine/perf.ts`). Disabled unless `beginAfePerf()`. Not user telemetry.

Phases (exclusive where possible): SOURCE OPEN, CONTAINER PARSE, SAMPLE TABLE BUILD, KEYFRAME LOOKUP, DECODER CREATE, DECODER CONFIGURE, ENCODED SAMPLE READ, VIDEO DECODE, DECODE QUEUE WAIT, FRAME CACHE LOOKUP, VIDEOFRAME HANDOFF, FRAME COPY/CLONE, CANVAS DRAW, FRAME CLOSE, SCHEDULER OVERHEAD, EXPORT LOOP OVERHEAD, VIDEOENCODER WAIT, MUX, CLEANUP.

Shared `VideoDecoder` probe so Mediabunny and AFE report the same create / configure / reset / flush / decode counts.

## Phase timings (720p30 full export, Chrome 148)

**AFE-01 unexplained gap:** raw sequential only ~15% slower, full export ~2× slower. Measured AFE-01-equivalent baseline on this harness (pre-opt, same jobs):

| Count | Mediabunny | AFE baseline |
| --- | --- | --- |
| decoderCreates | 1 | 1 |
| decoderConfigures | 1 | **3** |
| decoderResets | 0 | **2** |
| decoderFlushes | 2 | **3** |
| encodedChunksSubmitted | 60 | **102** |
| framesDecoded | 60 | **102** |
| duplicateDecodes | 0 | **42** |
| framesYielded | 60 | 60 |

Cause (not a guess): `decodeRange` flushed after one microtask (`needsKeyframe = true`). `BATCH_SPAN = 24` on GOP-30 then reset to keyframe 0 and re-decoded the prefix. 24+48+30 = 102. Export also waited for each 24-frame span before the encoder ran.

Post-opt instrumented export (same probe):

| Count | Mediabunny | AFE |
| --- | --- | --- |
| decoderCreates | 1 | 1 |
| decoderConfigures | 1 | 1 |
| decoderResets | 0 | 0 |
| decoderFlushes | 2 | 1 |
| encodedChunksSubmitted | 60 | 60 |
| framesDecoded | 60 | 60 |
| duplicateDecodes | 0 | 0 |

AFE phases (wall 217 ms this run): canvasDraw 180, videoEncoderWait 1.9, sourceOpen 1.8, exportLoop 1.7, decodeQueueWait 0.8. Parse / sample-table / keyframe lookup / clones are noise.

Mediabunny phases (wall 228 ms): decodeQueueWait 232 (public sink await; overlaps probe flush), canvasDraw 181. Same draw/encode/mux path.

## 720p30 repeated (10 warmup + 30 measured, COLD each — exporter clears sources)

| | Mediabunny | AILEXSI |
| --- | --- | --- |
| warmup median | 250.3 ms (AFE-02 final run uses latest 10+30) | — |
| **measured mean** | **254.0 ms** | **264.8 ms** |
| **measured median** | **253.9 ms** | **264.4 ms** |
| p95 | 263.6 ms | 276.1 ms |
| worst | 264.4 ms | 283.1 ms |
| min | 246.2 ms | 251.7 ms |

AFE median is **~4% slower**, not ≤ Mediabunny. Preferred ≥10% faster: **not met**.

AFE-01 single-shot wall was 650 vs 283. AFE-02 measured median is 264 vs 254.

## Fairness

Same 720p30 fixture, timestamps, project, canvas, compositor, `VideoEncoder` `avc1.42001f`, muxer, no audio, 1280×720, 30 fps. AFE does not skip Mediabunny work. COLD = new open per export (production `clearFrameSources`). WARM raw = reuse opened source.

## Decoder lifecycle

Sequential export after opts: **OPEN ONCE, PARSE ONCE, CONFIGURE ONCE, DECODE FORWARD, CLOSE ONCE**. Resets 0, extra configures 0. One flush at end of run if the last frame is held. Random `getFrameAt` still flushes immediately after the queue drains (measured 40 ms no-flush stall had regressed random).

## Frame handoff / copy

Path is Decoder → `VideoFrame` → `drawImage` / `drawWithFit` → `close()`. No `VideoFrame.clone` on the export path (`videoFrameClones: 0`). Dropped `Uint8Array.slice()` of mapped sample bytes — `EncodedVideoChunk` copies on construct. No ImageBitmap / RGBA / Canvas intermediate. No unsafe lifetime reuse.

## Cache (cap 12)

Sequential export: hit 0 / miss 0 / evictions 0 — frames are yielded, not cached. Random still uses LRU. Policy unchanged. Duplicate decode 0 after the flush fix (was 42 from GOP restart leftovers dumped into the LRU).

## Scheduler

Binary search (`sampleIndexAtTime`, `keyframeAtOrBefore`) is microseconds. Per-frame Promise churn remains (one waiter per submitted sample). Not the export gap after the flush/batch fix. `PREFETCH = 8` (16 measured worse).

## Batch decode

Monotonic `getFramesAt`: submit up to 8 samples ahead, yield each requested frame as it arrives, no per-timestamp seek. Grouped clips still open the source once via `getDecoder`. Source In/Out unchanged (`sourceTimeSec`).

## Source reuse

`getDecoder` still keys `${backend}:${src}`. Same file in multiple clips reuses the opened parse / sample table / avcC / decoder. Mapped bytes live on `AfeMovie.bytes`. Decoded-frame cache stays capped at 12.

## Memory vs speed

| Sim | peak cached | stabilized |
| --- | --- | --- |
| 2s | 0 (yield+close) | n/a (1 loop) |
| 28s GOP-250 | 0 | n/a (1 loop) |
| 7 min (210× 2s) | 0 | **true** |
| 30 min tail (50×) | 0 | **true** |

In-flight decoded frames ≤ prefetch 8 + one yielded. Cache cap still 12. No unbounded growth. Explicit `VideoFrame.close()` on yield. PREFETCH=16 kept more live frames and **slowed** export — reverted.

## Correctness hard gate

Packet oracle unchanged: **10228 / 10228 EXACT, 0 mismatches** (`tests/export/afe-oracle.test.ts`).

Chrome pixels: **2960 / 2960 EXACT** both backends, 0 ±1, 0 GOP snap, 0 substitution.

## Benchmarks A–J

Raw decode separate from full export. A–I export n=3 after 2 warmup (except C random = raw only). 720p unless noted.

| | Raw MB | Raw AFE | Export median MB | Export median AFE |
| --- | --- | --- | --- | --- |
| A sequential 720p30 | 245 | 250 | 257.9 | 265.7 |
| B repeated segments | 135 | **124** | 148.2 | **144.5** |
| C random 720p | **300** | 365 | — | — |
| D hard cuts | 133 | **127** | 273.1 | **272.1** |
| E crossfade | 126 | 127 | 225.8 | **220.7** |
| F Source In | **131** | 134 | **144.8** | 149.1 |
| G clip rate 2 | **132** | 151 | **155.2** | 163.6 |
| H long GOP 250 (160p) | 13.5 | **10.3** | 14.3 | **13.7** |
| I all-intra (160p) | 24.3 | **11.0** | 25.6 | **11.5** |
| J 24/25/50/60 raw | MB 7.6/8.9/13.9/17.4 | AFE **6.6/7.1/11.7/14.5** | — | — |

## Full export target

AFE measured median **264.4 ms** vs Mediabunny **253.9 ms**. Target “AFE median ≤ MB median” **missed by ~4%**. Sequential raw now wins. Microbenchmarks are not used to claim superiority.

## Output codec

Not touched. `webcodecs.ts` still `avc1.42001f`, 3 Mbps, AAC probe, `muxAvcToMp4`. Only optional `AfePerfStats` timing around wait/mux.

## Fallback

Fragmented / non-MP4 / unsupported codec / ctts / decoder fail still throw typed `AfeError` with `fallbackSafe`. Production `getDecoder("ailexsi")` still opens Mediabunny. Harness: `README.md` → `AFE_UNSUPPORTED_CONTAINER`.

## Abort

Retested after opts:

| Path | Result |
| --- | --- |
| open | `AFE_ABORTED` |
| getFramesAt batch | `AFE_ABORTED`, late=0 |
| getFrameAt random | `AFE_ABORTED` |
| full export | `aborted: true` |

Resources closed; no post-abort mutation observed.

## Windows

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES**  
Max class without that evidence: not AFE-SUPERIOR. This pass is not a superior-candidate (export median still Mediabunny).

### Windows human benchmark procedure (AFE-02)

Same project and fixtures as Linux. Do not change the production default.

1. Check out `cursor/ailexsi-frame-engine-afe-02-3e21`. `npm ci`.
2. Record WebView2 / Edge version. Run `npx tauri dev` (or Root-Exe) **and** `npm run web:dev`.
3. Open `http://127.0.0.1:1421/scripts/afe-frame-harness.html` (Vite; not in `public/` / `dist`).
4. Wait for `AFE_DONE`. Save `window.__AFE_RESULT` (or `npm run afe:chrome` if Chrome exists).
5. Compare to this section:
   - Any AFE pixel/packet mismatch → **AFE-FAIL**. Keep Mediabunny default.
   - Exact, but 720p30 **measured median** (10 warmup + 30 measured) slower than Mediabunny → **AFE-CORRECT** or **AFE-COMPETITIVE**.
   - Exact and AFE median full-export ≤ Mediabunny on **this** WebView2 host → may raise to **AFE-SUPERIOR** only with that human evidence.
6. Required numbers from this Windows host: `exportRepeats.mediabunny.measured` vs `exportRepeats.afe.measured` (mean/median/p95/worst), `phaseExport` counts, abort/fallback, Task Manager + in-app Export Fertig.

## Keep / revert log

| Change | Evidence | Keep? |
| --- | --- | --- |
| Instrument only | phases + counts | keep |
| Settle outputs without flush on sequential | 102→60 chunks, 2→0 resets | **keep** |
| Flush immediately on random `getFrameAt` | random 2.13→1.52 ms after stall regression | **keep** |
| Prefetch 8 + yield-as-ready | export median 371→279 ms | **keep** |
| Drop `sampleBytes().slice()` | small; clones 0 | **keep** |
| PREFETCH 16 | median 277→281 ms | **revert** |
| `optimizeForLatency: false` | median 277→264 ms; pixels exact | **keep** |

## Classification

**AFE-COMPETITIVE.**

Not AFE-FAIL: 0 packet / 0 pixel mismatches, abort + fallback pass, memory bounded.

Not AFE-SUPERIOR / not AFE-SUPERIOR-CANDIDATE: full-export **median** still belongs to Mediabunny (~4%). Windows unverified.

AFE-COMPETITIVE because sequential batch now wins, worst random wins, several A–J export medians win, the 2× export mystery is closed and repaired, and the remaining full-export gap is small and measured — not a hidden extra decode.

**Production default stays Mediabunny.** Review-only. Do not merge as a default change.

```
BASE BRANCH: cursor/ailexsi-frame-engine-0260
BASE SHA: 0d366163e9ce6a15ae6ec053f45c6185b113cbbb
AFE-02 BRANCH: cursor/ailexsi-frame-engine-afe-02-3e21
AFE IMPLEMENTED: YES (AFE-01 + AFE-02 opts)
MEDIABUNNY BASELINE: 1.55.3
CORRECTNESS TESTS: packet 10228/10228; pixels 2960/2960
TOTAL FRAME REQUESTS: 10228 (oracle) + 2960 (Chrome pixels)
MEDIABUNNY EXACT: 10228 packet / 2960 pixel
AFE EXACT: 10228 packet / 2960 pixel
AFE MISMATCHES: 0
SEQUENTIAL: MEDIABUNNY 0.244 ms / AFE 0.171 ms / WINNER AILEXSI
RANDOM: MEDIABUNNY 1.553 ms / AFE 1.643 ms / WINNER MEDIABUNNY
WORST LATENCY: MEDIABUNNY 22.5 ms / AFE 10.4 ms
MEMORY: cache cap 12; sequential peak cached 0; in-flight ≤ 8; 7min/30min sim stabilized
ABORT TEST: PASS (open / batch / random / export)
FALLBACK TEST: PASS (AFE_UNSUPPORTED_CONTAINER)
FULL 720P30 EXPORT: both success; measured n=30 median MB 253.9 / AFE 264.4
TYPECHECK: npx tsc --noEmit exit 0
TARGETED TESTS: 29 tests passed in 7 files
FULL SUITE: 935 tests passed in 108 files
BUILD: vite 7.3.6, 207 modules, version 5.0.0
WINDOWS WEBVIEW2 VERIFIED: NO
WINDOWS HUMAN TEST REQUIRED: YES
CLASSIFICATION: AFE-COMPETITIVE
PRODUCTION DEFAULT CHANGED: NO
MEDIABUNNY REMOVED: NO
PACKAGE LOCK REMOVAL: NO
LICENSE CHANGED: NO
```

# AFE-03 Equal-or-better pass

Child of AFE-02 (PR #24 / `cursor/ailexsi-frame-engine-afe-02-3e21` @ `e19b47b713f9a278023fab1bb2531114ccc47b3a`). Performance-gap closure only. Production default remains Mediabunny. Output codec / mux / AAC / `avc1.42001f` untouched. schemaVersion **5** / app **5.0.0** / AUTO `resolvePictureSource` untouched.

| Item | Value |
| --- | --- |
| Starting ref | `e19b47b713f9a278023fab1bb2531114ccc47b3a` (PR #24 tip) |
| AFE-03 branch | `cursor/ailexsi-frame-engine-afe-03-9b96` |
| Mediabunny | **1.55.3** (unchanged) |
| Production default | Mediabunny |
| Evidence | `docs/compliance/afe-03-evidence-summary.json`, `afe-03-export-50.json`, `afe-03-long30.json`, `afe-03-pixels-checkpoint.json`, `afe-03-aj.json` |

AFE-02 left AFE-COMPETITIVE: full-export median MB 253.9 / AFE 264.4 (~4% / ~10.5 ms). This pass closed that gate.

## What changed (input path only)

| Change | Why | Keep? |
| --- | --- | --- |
| Precomputed sequential plan (`plan.ts`) | One sample-index + bounded GOP membership pass | **keep** |
| Monotonic `streamFramesAt` + ready queue | Decoder output → ordered ready map; consumer pulls next; yield as soon as requested frame is ready | **keep** |
| Sequential `submitEncoded` (no per-frame Promise until wait) | Cuts lookup/resolver Map churn on the export path | **keep** |
| PREFETCH 4 (was 8) | After stream path, 2/4/6/8 sweep: 4 beat 8 on 720p30 full export; 6 noisier | **keep** |
| FIFO submit-order output assign | Timestamp nearest-match could close a mid-GOP needed frame | **keep** |
| Extra sample when first needed is last submitted | WebCodecs holds last `decode()`; hard-cut / Source In stalled `waitReady` | **keep** |
| Random still flushes immediately | AFE-02 winner for random | **keep** |
| `optimizeForLatency: false` | AFE-02 keep | **keep** |

Not undone: no export-path frame cache, no `VideoFrame.clone` on yield, no `sampleBytes.slice()`, one create/configure, zero sequential resets, 60 chunks / 60 frames.

## Instrumentation (AFE-03 counters)

`readyImmediate`, `framePromiseWaits`, `streamPathFrames`, `randomPathFrames`, `inFlightPeak`, `prefetchWindow`. Sequential 720p30 export: streamPathFrames 60, framePromiseWaits 60, readyImmediate 0, inFlightPeak 4, prefetchWindow 4, sampleIndexLookups 60 (was 120), resets 0, duplicateDecodes 0, clones 0.

Canvas draw still dominates wall (~87% of AFE exclusive phases). Remaining decode-queue wait ~19 ms vs Mediabunny’s public-sink await (overlaps draw).

## Hard gate — 720p30 full export (10 warmup + 50 measured, alternated)

Same source, timestamps, compositor, canvas, `VideoEncoder` `avc1.42001f`, muxer, no audio, 1280×720, 30 fps, COLD open per trial (`clearFrameSources`). Chrome 148 Linux headless / SwiftShader. Isolated profile.

**Official isolated run (after FIFO + mid-GOP extra-sample):**

| | Mediabunny | AILEXSI |
| --- | --- | --- |
| **measured mean** | **263.812 ms** | **263.018 ms** |
| **measured median / p50** | **262.900 ms** | **261.200 ms** |
| p95 | 273.900 ms | 275.700 ms |
| worst | 303.300 ms | 293.900 ms |
| min | 250.800 ms | 255.200 ms |
| stddev | 7.837 ms | 6.896 ms |

AFE median **≤** Mediabunny median. AFE mean **≤** Mediabunny mean. Gap ~1.7 ms median / ~0.8 ms mean vs ~7 ms stddev → **within noise**. Not a superior-candidate claim.

First 10+50 (stream + prefetch 4, before mid-GOP extra-sample; sequential 0-start path unchanged): MB 256.55 / AFE **255.70** (mean 257.23 / **256.27**, stddev 6.21 / 7.28). Same gate.

A contended rerun on a hot host (stddev ~40 ms) was MB 272.35 / AFE 272.50 — indistinguishable; not used to claim a miss.

## Longer export — 30s 720p30 (4 warmup + 8 measured)

Repeated 2s source clips. Post-fix:

| | Mediabunny | AILEXSI |
| --- | --- | --- |
| mean | 3775.9 ms | **3726.7 ms** |
| median | 3784.4 ms | **3713.3 ms** |
| stddev | 37.7 ms | 53.4 ms |

AFE median **≤** MB. First 30s run (pre extra-sample): MB 3665.6 / AFE **3636.0**.

## Production-like (A–J, still 720p30)

A–I export n=3 after 2 warmup (C random = raw only). Hard cuts, crossfade, Source In, rate 2, repeated source, long GOP.

| | Raw MB | Raw AFE | Export median MB | Export median AFE |
| --- | --- | --- | --- | --- |
| A sequential 720p30 | 255.3 | **248.1** | 265.6 | **264.9** |
| B repeated segments | 236.0 | **229.5** | **144.3** | 146.9 |
| C random 720p | 420.2 | **339.5** | — | — |
| D hard cuts | 230.3 | **222.0** | 304.2 | **294.1** |
| E crossfade | 127.8 | 127.8 | 243.9 | **232.3** |
| F Source In | 137.0 | **127.6** | 160.4 | **156.3** |
| G clip rate 2 | **139.6** | 140.5 | 168.5 | **166.6** |
| H long GOP 250 (160p) | 15.6 | **14.4** | 15.1 | **15.0** |
| I all-intra (160p) | 32.5 | **12.9** | 30.0 | **13.6** |
| J 24/25/50/60 raw | MB 11.5/11.7/18.4/35.7 | AFE **9.7/9.7/15.9/20.6** | — | — |

D/E/F/G (the required multi-clip set) are AFE median **≤** MB. B’s 2.6 ms export miss is inside n=3 noise.

Mid-GOP start used to stall AFE export (WebCodecs held the last submitted sample). Extra-sample fix unblocked D/F; do not flush the sequential GOP to get that frame.

## Sequential / random / worst (pixel-file batch)

| | Mediabunny | AILEXSI | Winner |
| --- | --- | --- | --- |
| Sequential avg (n=1728) | 0.264 ms | **0.198 ms** | AILEXSI |
| Random avg (n=1232) | **3.164 ms** | 3.255 ms | Mediabunny |
| Worst random | **40.3 ms** | 47.7 ms | Mediabunny |

AFE-02 on a quieter host: seq 0.244 / 0.171, random 1.553 / 1.643, worst 22.5 / **10.4**. This host inflated **both** backends ~2× on random; the AFE−MB average gap is still ~0.09 ms/frame. Not a material AFE-only random regression. Immediate flush on `getFrameAt` retained.

## Correctness

Packet oracle: **10228 / 10228 EXACT, 0 mismatches**.

Chrome pixels: **2960 / 2960 EXACT** both backends, 0 ±1, 0 GOP snap, 0 substitution.

No timestamp semantics change. Fallback codes unchanged.

## Memory

Cache cap 12. Sequential export peak cached **0**. In-flight ≤ prefetch 4 + one extra + one yielded. 7 min sim (210× 2s) **stabilized**. 30 min tail (50×) **stabilized**. Explicit `VideoFrame.close()` on yield. No half-movie cache.

## Abort / fallback

| Path | Result |
| --- | --- |
| open | `AFE_ABORTED` |
| getFramesAt batch | `AFE_ABORTED`, late=0 |
| getFrameAt random | `AFE_ABORTED` |
| full export | `aborted: true` |
| README.md | `AFE_UNSUPPORTED_CONTAINER` |

No post-abort mutation. Production `getDecoder("ailexsi")` still opens Mediabunny on fallback-safe errors.

## Output codec / Mediabunny

Untouched. Mediabunny **stays**. package.json / lock / SBOM / license inventory unchanged.

## Windows

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — Linux automated gate is **AFE-EQUAL**, so Windows/WebView2 human testing is now allowed. Do not change the production default until that human pass.

### Windows human benchmark procedure (AFE-03)

Same project and fixtures as Linux.

1. Check out `cursor/ailexsi-frame-engine-afe-03-9b96`. `npm ci`.
2. Record WebView2 / Edge version. Run `npx tauri dev` **and** `npm run web:dev`.
3. Open `http://127.0.0.1:1421/scripts/afe-frame-harness.html?warmup=10&measured=50`.
4. Wait for `AFE_DONE`. Save `window.__AFE_RESULT`.
5. Require: 0 packet/pixel mismatches; 720p30 measured **median** AFE ≤ Mediabunny (10+50, same host); no abort/fallback/memory fail.
6. If Windows median misses, keep Mediabunny default. Linux EQUAL does not override a Windows miss.

## Classification

**AFE-EQUAL.**

Not AFE-FAIL: 0 packet / 0 pixel mismatches, abort + fallback pass, memory bounded.

Not AFE-COMPETITIVE: full-export **median** is no longer Mediabunny’s (AFE ≤ MB on the official 10+50 and on 30s).

Not AFE-SUPERIOR-CANDIDATE: the 2s median/mean gaps are inside run-to-run noise (~7 ms stddev). Do not call 1–2 ms superior.

**Production default stays Mediabunny.** Review-only. Do not merge as a default change. Do not merge #23, #24, or this PR automatically.

```
BASE HEAD: e19b47b713f9a278023fab1bb2531114ccc47b3a
BASE BRANCH: cursor/ailexsi-frame-engine-afe-02-3e21
AFE-03 BRANCH: cursor/ailexsi-frame-engine-afe-03-9b96
AFE IMPLEMENTED: YES (AFE-01 + AFE-02 + AFE-03 opts)
MEDIABUNNY BASELINE: 1.55.3
CORRECTNESS TESTS: packet 10228/10228; pixels 2960/2960
TOTAL FRAME REQUESTS: 10228 (oracle) + 2960 (Chrome pixels)
MEDIABUNNY EXACT: 10228 packet / 2960 pixel
AFE EXACT: 10228 packet / 2960 pixel
AFE MISMATCHES: 0
SEQUENTIAL: MEDIABUNNY 0.264 ms / AFE 0.198 ms / WINNER AILEXSI
RANDOM: MEDIABUNNY 3.164 ms / AFE 3.255 ms / WINNER MEDIABUNNY
WORST LATENCY: MEDIABUNNY 40.3 ms / AFE 47.7 ms
MEMORY: cache cap 12; sequential peak cached 0; in-flight ≤ 4+1; 7min/30min sim stabilized
ABORT TEST: PASS (open / batch / random / export)
FALLBACK TEST: PASS (AFE_UNSUPPORTED_CONTAINER)
FULL 720P30 EXPORT: both success; measured n=50 median MB 262.900 / AFE 261.200; mean MB 263.812 / AFE 263.018
LONG 30S 720P30: measured n=8 median MB 3784.4 / AFE 3713.3
TYPECHECK: npx tsc --noEmit exit 0
TARGETED TESTS: 27 tests passed in 7 files
FULL SUITE: 939 tests passed in 109 files
BUILD: vite 7.3.6, 208 modules, version 5.0.0
WINDOWS WEBVIEW2 VERIFIED: NO
WINDOWS HUMAN TEST REQUIRED: YES
CLASSIFICATION: AFE-EQUAL
PRODUCTION DEFAULT CHANGED: NO
MEDIABUNNY REMOVED: NO
PACKAGE LOCK REMOVAL: NO
LICENSE CHANGED: NO
```

# AFE-04 — B-frame / varying CTTS (V5.5)

Human-proven failure on Windows V5.5 EXE: `AFE_UNSUPPORTED_SAMPLE_TABLE: varying ctts (B-frames) unsupported` with Frame Engine AILEXSI, 1280×720/30, no Mediabunny.

## Timing path

- CTTS absent = offset 0. v0 = unsigned. v1 = signed. Counts must expand to `stsz`/`stts` length. `PTS = DTS + offset` with safe integer arithmetic. Negative PTS is legal.
- Sample model: `index, offset, size, DTS, PTS, duration, keyframe`. Encoded H.264 is submitted in **decode / DTS order**. Presentation selection is **last PTS ≤ request**.
- WebCodecs mapping (chosen): `EncodedVideoChunk.timestamp := sample PTS (µs)`. `VideoFrame.timestamp` copies that integer. DTS is never the chunk timestamp. Match is exact PTS via `PtsIndexMap` (stable queue on duplicate timestamps). No FIFO identity. No nearest / ±1 / snap.
- Dual path (both AILEXSI): constant/absent CTTS keeps AFE-03 monotonic stream grouping; variable CTTS uses a presentation run that allows in-GOP decode-index wobble. Prefetch 4, ready queue, no per-frame flush, bounded reorder (`AFE_MAX_REORDER_READY` 64), `AbortSignal`, `VideoFrame.close`, random flush unchanged.

## Fixtures

Generated by `node scripts/generate-afe-media.mjs` (ffmpeg fixture-only). Identity barcode = presentation index.

| File | Notes |
| --- | --- |
| `afe-cfr-*` | no-B control (`-bf 0`, baseline) |
| `afe-bframe-30-g30-2s` | 30fps, GOP 30, `bf=2`, CTTS v0 varying |
| `afe-bframe-30-g30-2s-ctts-v1` | same bitstream, ctts version byte 1 |
| `afe-bframe-30-g60-4s` | longer GOP |
| `afe-bframe-30-g15-2s` | `bf=3` (multiple B between refs) |
| `afe-bframe-30-g30-720p-2s` | 1280×720 / 30 B-frames |

## Pixel gate

`npm run afe:bframe` → `docs/compliance/afe-04-evidence-summary.json`. AFE-04 Linux Chrome was **620/620 EXACT**. AFE-05 Chrome (harder B-GOP + mid-GOP Source In + 720p): **1188/1188 EXACT** (0 wrong / ±1 / snap / substitution). jsdom cannot decode; Chrome / WebView2 can.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner retests the original production media. Do not mark HUMAN-PROVEN from this pass.  
**HUMAN-PROVEN: NO**

# AFE-05 — B-frame export stall (V5.5)

Human-proven Windows V5.5 EXE hang after AFE-04: same production project, export starts, ~35%, `Encoding H.264`, no error, no progress.

## Cause

`streamFramesAt` waited for presentation sample N after submitting only `prefetch` (4) / +1 future decode-order samples. `pendingOutputCount >= prefetch` could stop the pump before the B-frame reorder window was filled. WebCodecs (WebView2 hardware especially) can hold frame N until N+k arrives. That is a deadlock, not a CTTS parse failure.

## Fix

- Lookahead = `streamLookaheadSamples(maxReorderSamples, prefetch)` (more than +1; capped at 16).
- Pump submits through `requested + lookahead` even past the last *requested* decode index. Extra outputs are `DISCARDED_NOT_NEEDED`.
- `pendingOutputCount` cannot block the required lookahead window.
- Flush only when input is exhausted or the last requested decode index is reached. No per-frame flush.
- Fail-closed `AFE_DECODE_STALL` (3s decoder / 5s export) dumps requested sample/PTS, pending PTS, ready indexes, decode queue, last decoded timestamp, GOP start. Timeout is not the fix.
- Every submitted sample is `RESOLVED | DISCARDED_NOT_NEEDED | ERROR | ABORTED`.
- Abort during B-wait rejects waiters, closes frames, resets the decoder.
- Open GOP: `decodeOrigin` walks back to the previous keyframe when B-frames after an I present before that I. Flush is fail-closed (`AFE_DECODE_STALL`) so WebCodecs cannot hang silently.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner rebuilds EXE and retests the same project past 35% / 100% / MP4.  
**HUMAN-PROVEN: NO**

# AFE-07 — real video input recovery / exact-frame delivery (V5.5)

Windows V1/V2 video input still failed with `AFE_DECODE_STALL` after AFE-06. VIS-only multi-scene export is HUMAN-PROVEN (do not re-investigate compositor / H.264 / muxer first). Defect is isolated to V1/V2 → AFE → VideoDecoder → exact frame delivery.

## Windows shapes

- Earlier A/B plus latest AFE-06: requested sample/PTS null, waiter null, `streamPts/Ready` 0, **`decodeQueue` 4, `flushes` 1**.
- Mid-run `releaseHeld()` / flush cleared tracking while WebView2 still held frames. Lookahead 6 did not solve this. Do not treat it as insufficient lookahead.

## Recovery (production VIDEO)

1. **STEP A** — normal stream (CTTS, exact PTS, B-frames, open-GOP, prefetch, maxReorder, bounded ready, Abort, `VideoFrame.close`). Wait briefly for the exact PTS.
2. **STEP B** — pump more decode-order samples, structure-bounded (`N + maxReorder + prefetch + next ref/GOP`). **No flush.**
3. **STEP C** — one controlled GOP recovery: snapshot origin identity, recreate decoder (new `transactionId`; stale outputs closed/ignored), open-GOP `decodeOrigin`, resubmit enough, wait exact PTS.
4. **STEP D** — `FINAL_FLUSH` only at true transaction/source tail, with watchdog. Else `AFE_DECODE_STALL`.

`picture.kind === "video"` → exact frame or typed failure. Never null / nearest / neighbor / VIS / BLACK / `paintFallback`. `allowSkip=false`. Null-yield only if upstream already selected VIS or BLACK. VIS/BLACK never wait on AFE. AUTO line untouched.

Origin identity (`originRequestedSample/Pts`, `originExportFrame`, `originTimelineMs`, `originClipId/Label`, `originSourceName`, `originPictureKind`) is preserved across PUMP / GOP_RECOVERY / FINAL_FLUSH / RESET. Stall dump includes `stallPhase` + transaction id.

Requested VIDEO fate cannot be `DISCARDED_NOT_NEEDED`.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner G1–G6 on the production project.  
**HUMAN-PROVEN: NO**

# AFE-08 — transaction end must not drain unneeded speculative decode (V5.5)

Windows VIDEO after AFE-07 decoded and encoded every requested frame, then failed at `TRANSACTION_END`. VIS-only multi-scene export stayed Fertig / playable (do not re-investigate compositor / H.264 / muxer / encoder).

## Windows shapes (owner screenshots)

- VIDEO #1: `videoReq/Dec/Enc` 37/37/37, `stallPhase TRANSACTION_END`, sample/PTS null, `streamPts/Ready` 0, `decodeQueue` 124, `submitted` 140, `flushes` 1, `resets` 1, `recreates` 1.
- VIDEO #2: 39/39/39, same shape, `decodeQueue` 110, `submitted` 140.
- VIS-only PASS, playable MP4.

Cause: requested VIDEO was already terminal. Pump/STEP B treated a missing next keyframe as EOF and submitted the rest of the file. `TRANSACTION_END` then waited on leftover WebCodecs work (`decodeQueue` 110–124) → flush → watchdog → `AFE_DECODE_STALL`. That leftover work is speculative, not a decode failure.

## Fix

1. Transaction COMPLETE when all requested VIDEO frames are terminal, decoded, handed to the encoder; no waiter. `videoReq==Dec==Enc` and no waiter → nothing left to flush. Do not wait `decodeQueueSize>0` speculative work.
2. Cancel speculative work at end: invalidate generation, clear tracking, reset/recreate decoder, ignore stale callbacks, finish SUCCESS. No `AFE_DECODE_STALL` for an abandoned speculative queue.
3. `FINAL_FLUSH` only if `unresolvedRequestedVideoFrames>0` AND no further useful input. All RESOLVED/ENCODED → flush forbidden.
4. Bound submit to last requested + B-reorder + refs. Measure `lastRequestedSample`, `lastRequiredDecodeSample`, `lastSubmittedSample`, `speculativeSamplesSubmitted`.
5. Classify samples `REQUESTED` / `REFERENCE_REQUIRED` / `SPECULATIVE`. Speculative is cancellable at end.
6. `TRANSACTION_END` + null request + Req==Enc → TRANSACTION COMPLETE, not stall. May log `cancelledSpeculativeSamples`, `decodeQueueBeforeCancel`, `decoderResetForTransactionEnd`.
7. AFE-07 preserved: no `allowSkip` / null VIDEO / `paintFallback` / nearest / ±1 / neighbor / VIS / BLACK. Exact PTS.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner G1–G4 on the production project.  
**HUMAN-PROVEN: NO**

# AFE-09 — unresolved vs encoded counter contradiction at TRANSACTION_END (V5.5)

Windows AFE-08 EXE: `videoReq/Dec/Enc` 46/46/46, `unresolvedRequested` 10, `decoderResetForTransactionEnd` false, `transactionComplete` false, origin sample 38 PTS 1625000, `lastDecodedTs` 458333, `decodeQueue` 29, `speculativeSubmitted` 0, `lastRequested` 81. AFE-08 COMPLETE (Req==Enc, no waiter) did not fire.

## Cause

Two ledgers. Exporter `videoReq/Dec/Enc` counted completed presentation yields (increment after `iter.next()`). Decoder `unresolvedRequested` counted every planned `requestedIndexes` still PENDING/READY — including lookahead-submitted future samples and GOP-resubmitted already-resolved samples. `lastRequested` is a sample **index** (span.decodeEnd); `videoReq` is a frame **count**. Sample 38 could stay open while Enc already equalled the completed-yield count.

## Fix

One source of truth: opened VIDEO presentation samples (export actually asked). `unresolvedRequested` = opened and not resolved. Increment `videoReq` when the export opens a request, not after yield. GOP resubmit keeps resolved. Enc==Req with leftover `decodeQueue` → COMPLETE + cancel, `decoderResetForTransactionEnd` true, no stall. Open unmatched exact PTS → `unresolved>0` AND Enc < Req; recover or typed stall with origin. `unresolved>0` with Enc==Req is impossible (invariant fails closed). Dump labels `videoReq` as frame-count and `lastRequestedSample` as sample-index.

AFE-07/08 preserved: exact PTS, no null VIDEO yield, no mid-run flush as first recovery, `FINAL_FLUSH` only for unresolved requested at true tail.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner retest same project (sample 38 / ~70s V1 pocket).  
**HUMAN-PROVEN: NO**

# AFE-10 — open VIDEO request keeps decode ownership until exact PTS (V5.5)

Windows AFE-09: honest missing exact VIDEO frame — `videoReq/Dec/Enc` 47/46/46, opened sample 38 PTS 1625000, `unresolved` 1, `WAIT_EXACT_PTS`, `transactionComplete` false, recovery 1/1/1, submitted 44, `decodeQueue` 29, `lastRequested/Required` 140, `pending []` `ready []` `streamPts 0` `waiter null`, `flushes` 0.

## Cause

Open request was ledger-only. `recreate()` / `reset()` / `beginStream()` cleared `PtsIndexMap` and `streamWaiter` while `openedRequested` still listed sample 38. Pump after recovery stopped at lookahead (~44), never sliced toward `lastRequired` 140. Waiter timeout then left `unresolved=1` with no PTS tracking and no waiter — a 3s mystery `AFE_DECODE_STALL` instead of an immediate ownership error.

## Fix

1. TRACE ownership: `OPEN_REQUEST` → `PTS_REGISTERED` → `WAIT_INSTALLED` → (`RECOVERY_START` → `RECOVERY_REBUILDING` → `WAIT_REINSTALLED`) → `RESOLVED` → `ENCODED`.
2. After recreate/reset: restore opened identity, exact sample/PTS, protected `REQUESTED` role, `PtsIndexMap` on resubmit, active exact-frame wait.
3. Progressive pump: bounded lookahead-sized slices toward `lastRequiredDecodeSample`. Brief exact-PTS wait between slices. Stop when exact PTS resolves. No global PREFETCH bump. No `FINAL_FLUSH` until useful input is exhausted.
4. `FINAL_FLUSH` only if `unresolved>0` AND `lastSubmitted>=lastRequired` AND no further useful input. `flushes==0` at submitted 44 / required 140 is correct.
5. No VIDEO fallback (`paintFallback` / last-good / nearest / dup / VIS / BLACK / null). Exact `RESOLVED` or typed `AFE_DECODE_STALL`.
6. Invariant: opened unresolved VIDEO >0 ⇒ active exact waiter OR PTS pending OR recovery rebuilding. Else immediate `AFE_REQUEST_OWNERSHIP_LOST` with full dump.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner retest sample 38 PTS 1625000 → Req==Dec==Enc, unresolved 0, exact frame, export past VIDEO→VIS.  
**HUMAN-PROVEN: NO**

# AFE-11 — FINAL_FLUSH when useful input is exhausted for an open request (V5.5)

Windows AFE-10: ownership rebuilt, pump reached `lastRequired=96`, sample 38 PTS 1625000 still missing. `videoReq/Dec/Enc` 47/46/46, `unresolved` 1, `WAIT_EXACT_PTS`, `submitted` 96, `lastRequested` 90, `decodeQueue` 81, `flushes` 0, `FINAL_FLUSH` no, `ptsRegistered` no, `waiterActive` no, `recoveryRebuilding` no, `ownershipState WAIT_REINSTALLED`.

## Cause

`FINAL_FLUSH` was gated on `atTail(currentRequestedSample)` (sample 38 === lastRequested 90). Useful input was already exhausted (`lastSubmitted>=lastRequired`). Hardware still held `decodeQueue` 81. The engine sat in `WAIT_EXACT_PTS` with no waiter and no flush — a 3s mystery stall instead of one tail flush.

## Fix

1. `FINAL_FLUSH` allowed when ALL: `unresolvedRequested>0`, `lastSubmitted>=lastRequiredDecodeSample`, no further useful input, waiter not active, pending PTS empty, not `recoveryRebuilding`, transaction not complete. Do **not** require `atTail(currentRequestedSample)`.
2. Ownership: `unresolved>0` ⇒ `waiterActive` OR `ptsRegistered`/pending OR `recoveryRebuilding` OR `FINAL_FLUSH` armed/in progress. Else immediate `AFE_REQUEST_OWNERSHIP_LOST`.
3. `WAIT_EXACT_PTS` → arm `FINAL_FLUSH` once → brief wait → exact PTS or typed `AFE_DECODE_STALL` with honest dump (`usefulInputExhausted`, `finalFlushArmed`, submitted/required, PTS, waiter, rebuilt).
4. No fake success: `unresolved>0` ⇒ not `transactionComplete`. Exact PTS or typed stall only. No nearest / snap / dup / last-good / VIS / BLACK / null.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner retest sample 38 PTS 1625000 → Req==Dec==Enc, unresolved 0, exact frame, export past VIDEO→VIS.  
**HUMAN-PROVEN: NO**

# AFE-12 — WebCodecs decodeQueue backpressure / queue progress (V5.5)

Windows AFE-11: after recreate, AFE submitted through lastRequired while the decoder produced only to ~458333. CASE A 30fps: sample 38 PTS 1625000, Req47 Dec/Enc46, unresolved1, submitted140 lastRequired140, decodeQueue125, lastDecodedTs458333, pending includes 1625000, streamPts131 streamReady10 reorderCap10, FINAL_FLUSH yes. CASE B 25fps: sample140 PTS5875000, Req145 Dec/Enc144, submitted140 decodeQueue125, lastDecodedTs458333, pending[] streamPts0 cancelledSpeculative130. 30fps streamReady==reorderCap; 25fps streamReady==0 — not retained VideoFrames alone.

## Cause

`pumpThrough` called `VideoDecoder.decode()` in a tight loop with no `decodeQueueSize` gate. Progressive slices waited only for exact PTS (120ms), not decoder capacity. Unbounded `submitEncoded` reaches submitted140 / queue>=125 / lastDecoded stuck with `backpressureWaits` 0. FINAL_FLUSH then hung on a 125-deep hardware queue.

## Fix

1. TRACE (stall dump only): per-submit-phase `submitPhases` + aggregate `decodeQueueHighWater`, `decodeQueuePeak`, `submitsWithoutOutputProgress`, `backpressureWaits`, `backpressureBlocked`, `noMoreSubmission`, `lastOutputProgressTs`.
2. `waitForDecodeCapacity` — HIGH_WATER pause on `decodeQueueSize`. Resume on dequeue / output / exact resolve. No busy loop, no arbitrary sleep, no mid-run flush.
3. HIGH_WATER = min(CAP 48, max(RECOVERY_FILL 40, maxReorder + lookahead + bFrameNeed)) where bFrameNeed = lookahead + prefetch. Never near 125. No global PREFETCH bump.
4. INVARIANT: no output progress + queue>=HIGH_WATER ⇒ NO_MORE_SUBMISSION until progress or typed stall. Before first recreate, HIGH_WATER stop hands off to STEP C GOP recover. After recreate, still-stuck HIGH_WATER is typed `AFE_DECODE_STALL`.
5. After recreate: origin/keyframe, exact request, PTS ownership, decode-order pump, respect backpressure, stop on exact PTS. FINAL_FLUSH only per AFE-11 (unlikely to begin with queue~125).
6. CANCEL: AFE-08 rules; backpressure does not reset an unresolved exact request. No VIDEO fallback.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner retest sample 38 PTS 1625000 / CASE A 30fps and CASE B 25fps → Req==Dec==Enc, unresolved 0, decodeQueue never ~125, exact frame, export past VIDEO→VIS.  
**HUMAN-PROVEN: NO**

# AFE-13 — backpressure deadlock after recreate (no output progress) (V5.5)

Windows AFE-12: backpressure holds (`decodeQueuePeak` 40, not 125). New stall on `… - Kopie.mp4` (`sourceInMs` ~1529 / `sourceOutMs` 6042 / fps 30 / `maxReorderSamples` 10): requested sample 68 PTS 2875000, `videoReq` 39 Dec/Enc 38 unresolved 1, submitted 92 lastRequired 144, `lastDecodedTs` 2000000 stuck, decodeQueue 40 HIGH_WATER, `backpressureBlocked` / `noMoreSubmission`, `stallPhase PUMP_LOOKAHEAD`, `ownershipState RECOVERY_REBUILDING`, waiter null, `ptsRegistered` no, `FINAL_FLUSH` no, `usefulInputExhausted` no, recovery 1/1/1, `gopStart` null.

## Cause

Producer paused at HIGH_WATER waiting for output that never comes. `FINAL_FLUSH` blocked because `submitted < lastRequired`. Cannot pump, cannot flush. `waitForDecodeCapacity` after recreate sat the 3s export budget then dumped without a stored open-GOP decode origin (`gopStart` null). `RECOVERY_REBUILDING` cleared PTS/waiter and then sat idle — not an active rebuild step.

## Fix

1. Persist open-GOP `decodeOrigin` as `gopKeyframeStart` on the decoder. Stall dumps after recreate include it. Open GOP still walks back one I-frame for leading B-refs.
2. After recreate: HIGH_WATER + no output progress + unresolved exact request → do **not** sit 3s. Short output-progress budget (`AFE_POST_RECREATE_OUTPUT_BUDGET_MS`). Escape: **ONE** additional controlled GOP recover from an **earlier** keyframe (walk back) with ownership rebuild (PTS + waiter). No earlier I-frame → typed `AFE_DECODE_STALL`.
3. Prefer earlier-keyframe recreate before any flush. `usefulProgressImpossible` (`noMoreSubmission` + lastDecoded unchanged + `lastSubmitted < lastRequired`) is **not** a FINAL_FLUSH trigger (AFE-06 mid-run flush ban). FINAL_FLUSH remains AFE-11 (`lastSubmitted>=lastRequired`).
4. `maxReorderSamples=10`: HIGH_WATER = min(48, max(40, 10+lookahead+bFrameNeed)) still admits B-frame deps. Queue never ~125.
5. During `RECOVERY_REBUILDING`: re-register PTS immediately. Do not leave waiter null + `ptsRegistered` no without an active rebuild step.
6. AFE-12 backpressure, exact PTS, AFE-04..12 regressions preserved. No nearest / snap / VIS / BLACK / null VIDEO fallback.

**WINDOWS WEBVIEW2 VERIFIED: NO**  
**WINDOWS HUMAN TEST REQUIRED: YES** — owner retest `… - Kopie.mp4` sample 68 PTS 2875000 / sourceInMs ~1529 / sourceOutMs 6042 / fps 30 → Req==Dec==Enc, unresolved 0, `gopStart` set, decodeQueue never ~125, exact frame, export past VIDEO→VIS.  
**HUMAN-PROVEN: NO**

