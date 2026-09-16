# STRESS-04 — MP4 mux large-sample argument overflow

Base: STRESS-03 tip `04fc687` (PR **#21**, draft). Do **not** merge PR #19 / #20 / #21 / this branch.

## Verdict: **C — EXCESSIVE SPREAD / ARGUMENT COUNT**

Human-proven on build `04fc687` (branch stress-03). Long 1920×1080@30 export reached mux with:

| Field | Value |
| --- | --- |
| exportFrame | 41889 |
| videoReq / videoDec / videoEnc | 21195 / 21195 / 21195 |
| afeFrames | 21195 |
| visFrames | 18818 |
| blackFrames | 1876 |
| stage | mux |

Then:

```
RangeError: Maximum call stack size exceeded
  at box → fullBox → videoTrak → buildMoov → muxAvcToMp4 → exportWithWebCodecs
```

Not recursion. Not AFE. Not encoder backpressure. Not STRESS-01. Not STRESS-03.

STRESS-02 candidates **C2 (STSZ)** is the first application frame (`box` ← `fullBox` ← `videoTrak`). C1 (video mdat concat), C3/C4 (audio payload / audio STSZ), C5 (STSS), and C6 (unpacked STTS) are the same shape and are removed in this pass.

## Offending spread sites (pre-fix `src/core/exporter/mp4.ts`)

| Site | Shape | Why it blows at ~21 195 samples |
| --- | --- | --- |
| **STSZ (human stack)** | `fullBox("stsz", 0, 0, u32(0), u32(N), ...samples.map(s => u32(s.data.length)))` | N `u32` arrays become rest args → `fullBox` → `box` → `concat`. Human crash. |
| Video mdat | `concat(...opts.samples.map(s => s.data))` | N sample buffers as `concat` arguments. |
| Audio mdat | `concat(...audio.samples.map(s => s.data))` | AAC packet count (often > video N). |
| Audio STSZ | same `fullBox("stsz", …, ...sizes)` | Same N as audio packets. |
| STSS | `fullBox("stss", 0, 0, u32(K), ...keyIndexes.map(u32))` | K can equal N if every sample is a key. |
| STTS | `fullBox("stts", 0, 0, ...parts)` | Packed at constant fps (safe); **unpacked** if deltas vary (2N+1 args). |
| `box` / `fullBox` / `concat` | variadic `...payloads` / `...parts` | Any large list that reached these wrappers became an argument list. |

## What changed

No stack-limit raise. No duration/fps/sample cap. No export split. No AFE / ENC-01 / STRESS-01 / STRESS-03 change. STRESS-02 dump capture stays.

| Helper | Behavior |
| --- | --- |
| `concatParts(parts)` | Iterative length + one allocation + iterative copy. Never spread. |
| `boxParts` / `fullBoxParts` | Array-in, not rest-args-in. Small fixed-arity `box` / `fullBox` remain. |
| `stszBoxFromSamples` | One `Uint8Array` / `DataView`: `sample_size=0`, `entry_count`, N×`sample_size`. |
| `stssBox` | One payload: `entry_count` + N×`sample_number`. |
| `packedStts` | Same run-length packing; one payload instead of `fullBox(...parts)`. |
| `concatSamplePayloads` | Iterative length + one allocation + iterative copy of sample bytes. |

ISO-BMFF layout is unchanged: `ftyp` + `moov` + `mdat`, one chunk per track, same brands, same stsc/stco/tkhd/mdhd/mvhd fields. Golden small muxes are **byte-identical** to `04fc687`.

## Allocation / memory

| | |
| --- | --- |
| Human N | 21 195 encoded video samples (~23 min @ 30 fps) |
| Synthetic | 25 000 / 50 000 video; 60 000 audio |
| STSZ temp | one buffer `8 + 4N` bytes (no N×`u32` arrays) |
| Sample payload | one contiguous copy into `mdat` payload, then `concatParts([ftyp, moov, mdat])` copies the finished boxes once into the file |
| Peak duplicate payload copies | **2** (mdat payload + final file). Linear, not quadratic. |
| Estimated file | `ftyp + moov + 8 + Σ sample bytes`. Moov grows ~4N (stsz) + ~4K (stss) + packed or 8E (stts). |

Do not treat this as HUMAN-PROVEN. MODE B operator EXE is still required.

## Untouched

- STRESS-02 original-stack capture / dialog dump / diagnostic sourcemaps
- STRESS-01 avcC `bitstream_restriction`
- STRESS-03 stage trail + first-PTS clamp
- ENC-01 AVC capability
- AFE scheduling / watermarks / timeouts / reset / recreate
- No Mediabunny, no fragmented MP4, no codec change

## Tests

`tests/export/stress-04-mp4-mux-arg-overflow.test.ts`

- A: small video-only and video+audio mux **byte-identical** to pre-fix goldens
- B: 25 000 video samples — no `RangeError`; ftyp/moov/mdat/trak/stsz/stco/stss/duration
- C: 50 000 video samples including all-key STSS
- D: 60 000 audio samples
- E: unique-delta STTS (25 000 unpacked entries); sizes / keys / chunk offsets / mdat order
- F: static audit — no sample-count-dependent `...array` remains in `mp4.ts`

Existing exporter / ENC / AFE / STRESS-01 / STRESS-02 / STRESS-03 suites are not rewritten.

## Operator card — MODE B (coordinator builds the EXE)

You do **not** need a new timeline. Repeat the **same ~23 min 1920×1080@30** project that failed on `04fc687` at mux (`exportFrame 41889`, `videoReq/Dec/Enc 21195`).

1. Build MODE B from **this branch SHA** (coordinator: `npm run tauri:exe` or `BUILD_AND_RUN_V5.5.cmd`). Diagnostic maps (`tauri:exe:diag`) are optional — the overflow fix does not need them.
2. Confirm chip **5.5.0**, Frame Engine **AILEXSI**.
3. Same project / same IN–OUT / 1920×1080 / 30 fps.
4. Export to the end.
5. Required for pass:
   - `videoReq == videoDec == videoEnc`
   - stage reaches mux and **completes** (no `RangeError`)
   - Export dialog **Fertig**
   - MP4 plays (duration ≈ project range; picture present)
6. If it still fails, scroll the failed-status (STRESS-02 dump still present) and copy `error.name` / `error.message` / `error.stack` / `stage` / counters.

**EXE path / build SHA:** left for the coordinator. This agent does not build the Windows EXE.

**Do not merge** until MODE B confirms Fertig + playable MP4. Do not promote STRESS-02 diagnostic PR #20 as production merely because this fix used its stack.
