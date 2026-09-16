# STRESS-01 — clip-start exact PTS 100000

Physical source: `6C16E2CA-CBA2-4C81-8F91-EE5AC732E9F7 - Kopie.mp4`
(agent copy: `uploads/stress-01-6C16E2CA-Kopie_da18.mp4`, 7 868 485 bytes).
Minimized GOP fixture in-repo: `tests/fixtures/afe/stress-01-clip-start-gop.mp4` (first 32 samples, same avcC / CTTS / elst / sample 3).

Human fail: productVersion 5.5.0 / gitSha `0ec7758` / MODE B EXE, requested sample **3** / PTS **100000**, `targetPtsSeen no`, `lastDecodedTs 500000`.

## Verdict: **D** (with a known AVC/WebCodecs rule)

| Class | Result | Evidence |
| --- | --- | --- |
| A | **No** | Sample 3 raw PTS 60 ≥ elst `mediaTime` 40. Presentation index 1. `sourceInMs 0` second output frame selects sample 3. |
| B | **No** | Sample 0 is NAL type 5 IDR, I-slice, `frame_num=0`. `isOpenGopAtKey(0)=false`. `decodeOrigin(3)=0`. Sample 3 is a disposable B (`nal_ref_idc=0`) whose refs are I / reference-B / P **after** origin 0. |
| C | **No** | AILEXSI `onOutput` / Chrome `outputTrace` never received 100000. Neighbor timestamps were recorded. Matcher did not drop a delivered frame. |
| D | **Yes** | Same physical MP4, same GOP origin: Chrome VideoDecoder (prefer-software and no-preference) also omits 100000 while emitting 66667…500000. ffmpeg/libavcodec **does** emit the B at 0.033s. The hole is Chromium WebCodecs + missing VUI `bitstream_restriction`, not an AILEXSI scheduler/queue defect. |

First behavioral divergence vs a decoder that keeps the frame: **PTS 100000**.

## Target trace (sample 3 / PTS 100000)

| Step | Result |
| --- | --- |
| SOURCE_SAMPLE | YES |
| DEMUXED | YES |
| SELECTED_FOR_TIMELINE | YES |
| GOP_ORIGIN_VALIDATED | YES |
| CHUNK_CREATED | YES |
| DECODER_SUBMITTED | YES (`requestedSubmitted yes`, lastSubmitted 29) |
| **DECODER_OUTPUT** | **NO — first NO** |
| PTS_MATCHED | NO |
| STREAM_READY | NO |
| FRAME_TAKEN | NO |
| CANVAS_DRAWN | NO |
| VIDEO_ENCODED | NO |

## STEP 1 — samples 0..15 (AILEXSI parse = physical MP4)

`timescale=600` · `sampleCount=1158` · `track duration=23160` ticks (38.6s) · `stts` all Δ=20 · `ctts` v0 · `maxReorderSamples=2` · codec `avc1.4d001e` (Main / Level 3.0) · 640×356 · first keyframe sample **0** · next keyframe sample **29** · GOP spacing 29.

Video elst: one entry, `segmentDuration=23160` (movie ts 600), **`mediaTime=40`**, `mediaRate=1`.

| index | DTS | PTS | dur | sync | pres | ctts | bytes | PTS µs |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 40 | 20 | **1** | 0 | 40 | 31414 | **66667** |
| 1 | 20 | 120 | 20 | 0 | 4 | 100 | 18522 | 200000 |
| 2 | 40 | 80 | 20 | 0 | 2 | 40 | 10738 | **133333** |
| **3** | **60** | **60** | **20** | **0** | **1** | **0** | **3341** | **100000** |
| 4 | 80 | 100 | 20 | 0 | 3 | 20 | 3066 | 166667 |
| 5 | 100 | 200 | 20 | 0 | 8 | 100 | 27039 | 333333 |
| 6 | 120 | 160 | 20 | 0 | 6 | 40 | 16567 | 266667 |
| 7 | 140 | 140 | 20 | 0 | 5 | 0 | 1952 | 233333 |
| 8 | 160 | 180 | 20 | 0 | 7 | 20 | 1775 | 300000 |
| 9 | 180 | 240 | 20 | 0 | 10 | 60 | 28365 | 400000 |
| 10 | 200 | 220 | 20 | 0 | 9 | 20 | 1375 | 366667 |
| 11 | 220 | 280 | 20 | 0 | 12 | 60 | 14653 | 466667 |
| 12 | 240 | 260 | 20 | 0 | 11 | 20 | 1147 | 433333 |
| 13 | 260 | 320 | 20 | 0 | 14 | 60 | 26460 | 533333 |
| 14 | 280 | 300 | 20 | 0 | 13 | 20 | 1683 | 500000 |
| 15 | 300 | 360 | 20 | 0 | 16 | 60 | 19500 | 600000 |

Sample 3 is the second presentation frame after the IDR (pres index 1). elst maps it to 0.033s on the user timeline (`sourceInMs 0`).

## STEP 2 — NAL / GOP (not stss-only)

| sample | stss sync | NAL | slice | nal_ref_idc | frame_num | poc_lsb | class |
| ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 0 | yes | **5 IDR** | I (2) | 1 | 0 | 0 | closed-GOP IDR |
| 1 | no | 1 non-IDR | P (0) | 1 | 1 | 4 | P |
| 2 | no | 1 non-IDR | B (1) | 1 | 2 | 2 | reference B |
| **3** | no | 1 non-IDR | B (1) | **0** | 3 | 1 | disposable B |
| 4 | no | 1 non-IDR | B (1) | 0 | 3 | 3 | disposable B |
| 5 | no | 1 non-IDR | P (0) | 1 | 3 | 8 | P |

- Sample 0 **is** IDR (not a non-IDR I / not HEVC CRA).
- No leading pictures with PTS < IDR PTS. AILEXSI open-GOP test is false.
- GOP is **closed**. `gopStart=0` is a valid independent decode origin.
- Sample 3 depends on pictures **inside** this GOP (I / bref / P), not on a previous GOP.
- sdtp `is_leading` is 0 (unknown) for 0..15 — not an edit-list leading-picture mark.
- avcC SPS: `vui_parameters_present=1`, **`bitstream_restriction_flag=0`**, `max_num_ref_frames=4`. Inferred DPB/reorder (AILEXSI walk) = 8. `needsPatch=true`.
- Sample 0 has only unregistered user-data SEI + IDR slice (no in-band SPS). Patching avcC is sufficient.

## STEP 3 — raw decoder differential (same physical MP4, GOP origin 0)

Pre-fix Chrome MODE A (`docs/compliance/stress-01-pre-fix-chrome.json`). Human WebView2 column is the operator dump.

| PTS µs | AILEXSI WebView2 (human) | AILEXSI Chrome | Chrome VideoDecoder | Mediabunny diagnostic | Chrome + SPS patch |
| ---: | :---: | :---: | :---: | :---: | :---: |
| 66667 | YES | YES | YES | ERR* | YES |
| **100000** | **NO** | **NO** | **NO** | ERR* | **YES** |
| 133333 | YES | YES | YES | ERR* | YES |
| 166667 | YES | YES | YES | ERR* | YES |
| 200000 | YES | YES | YES | ERR* | YES |
| … 500000 | YES | YES | YES | ERR* | YES |

\* Mediabunny was loaded from esm.sh as a **diagnostic only**. First attempt (`EncodedPacketSink` → VideoDecoder) failed `A key frame is required after configure()` — not used as a product path. ffmpeg/libavcodec emits the 0.033s B-frame on this file.

`prefer-software` vs `no-preference` Chrome columns were identical (both missing 100000). First divergence vs a working decoder is **100000**.

## STEP 4 — edit-list / presentation validity

`sourceInMs 0`, 30 fps, AILEXSI `sourceTimeSec` (half-frame center):

| out frame | timelineMs | mapped ticks (t×600+40) | sample | PTS µs |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | ~50 | 0 | 66667 |
| 1 | 33.333 | ~70 | **3** | **100000** |

PTS 100000 belongs on the user-visible timeline. Selection is right; Chromium output of that sample is wrong until avcC carries `bitstream_restriction`.

## Fix

Wire the already-landed `patchAvcCBitstreamRestriction` into `decoderConfigOf`. No timeout / queue / reset / snap / ENC-01 change. AFE-25 analog already has the flag → patch is a no-op (same `description` reference, `prefer-software` kept).

Open human test: MODE B EXE, same `…Kopie.mp4` clip, `sourceInMs 0`, confirm sample 3 / PTS 100000 is encoded (no stall dump `targetPtsSeen no` at 100000). **Not merged. Not HUMAN-PROVEN from this pass.**
