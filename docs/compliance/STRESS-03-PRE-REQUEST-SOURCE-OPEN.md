# STRESS-03 — pre-request source open stall (diagnostic)

Base: STRESS-02 tip `e2c6659` (PR **#20**, draft). Do **not** merge PR #19 / #20 / this branch.

Physical source: `1000001827 - Kopie.mp4` (agent copy: `uploads/stress-03-1000001827-Kopie_0828.mp4`, 2 140 770 bytes).
ffprobe: 5.208 s, start 0.083333, 24 fps, 464×832, H.264 High / Level 3.1, 125 frames, `has_b_frames=2`.
Human clip window: `sourceInMs 0` / `sourceOutMs 5208`.

## Human failure (diagnostic EXE `e2c6659`)

```
AFE_DECODE_STALL
originTimelineMs 168733.3333333333 / originExportFrame 5062
clip: 1000001827 - Kopie.mp4
sourceInMs 0 / sourceOutMs 5208
requestedSample null, requestedPTS null, lastSubmittedSample null, transactionId 0
decodeQueue 0, lastDecodedTs null, gopStart null
openedRequested 0, unresolvedRequested 0, streamPts 0, streamReady 0
videoReq 5063 / videoDec 5062 / videoEnc 5062
stalledMs 3000
```

This is **not** STRESS-01 exact-PTS 100000. This is **not** a call-stack overflow.
The next VIDEO frame is requested; AFE never reaches sample selection / decoder transaction startup.

## Untouched

- AFE scheduling
- queue watermarks
- 3000 ms stall timeout
- reset / recreate / fallback
- ENC-01 encoder selection
- STRESS-01 avcC `bitstream_restriction`
- STRESS-02 diagnostic capture

## Instrumentation

Required stages (exact names), each with `timelineMs`, `exportFrame`, `clipId`, `clipName`, `sourceId`, `elapsedMs`:

`FRAME_REQUESTED` → `CLIP_SELECTED` → `SOURCE_RESOLVED` → `OPEN_PREFERRED_BEGIN` → `BACKEND_OPEN_BEGIN` → `MP4_READ_BEGIN` → `MP4_READ_DONE` → `TRACK_PARSED` → `DECODER_CREATE` → `DECODER_CONFIGURE` → `SAMPLE_SELECT` → `TRANSACTION_BEGIN` → `FRAME_READY`

`firstBlockedStage` = last entered stage when `FRAME_READY` never arrived.
`nextExpectedStage` = first required stage not yet entered.

Surfaced in:

- `formatStallMessage` (AFE_DECODE_STALL text on the scrollable Export failed-status)
- `formatExportFailDump` under `--- STRESS-03 stage trail ---`

## First blocked stage

**SAMPLE_SELECT** (proven in MODE A on the physical file; human dump is the same shape).

`1000001827 - Kopie.mp4`: timescale 12288, `editListOffset` 0, first sample PTS **1024** (83333µs), CTTS delay, 125 samples, `avc1.64001f` 464×832. Clip-start `sourceTimeSec` at `sourceInMs 0` is **0.01667s** (500/30 ms center). `sampleIndexAtTime` used last-PTS-≤-request and returned **null** because 1024 > 205 ticks. Export then yielded null → `AFE_DECODE_STALL` with `transactionId 0`, `requestedSample` null, `stalledMs 3000` (hardcoded on the null-yield path — not a 3s open hang).

Not an open/parse/configure hang. Not STRESS-01 PTS 100000. Not a call-stack overflow.

## Narrow fix

When the mapped request is **≥ 0** but still before the first composition PTS, select the first presentation sample. Negative times stay null (`sampleIndexAtTime(movie, -0.001)` unchanged). No scheduling / watermark / timeout / reset / ENC-01 / STRESS-01 avcC change.

## Human retest (MODE B, do not merge)

1. Build this branch on Windows: `npm run tauri:exe:diag` or `$env:AILEXSI_DIAG_SOURCEMAP="1"; npm run tauri:exe`.
2. Repeat the long 1080p30 export that stalled on `1000001827 - Kopie.mp4` near timeline 168733 ms / export frame 5062.
3. On `AFE_DECODE_STALL`, scroll the Export failed-status (not console-only).
4. Copy `firstBlockedStage`, `nextExpectedStage`, and the full `stageTrail` (every stage with elapsedMs / timelineMs / exportFrame / clipId / clipName / sourceId).
5. Confirm STRESS-01 (PTS 100000) and ENC-01 1080p are unchanged if you re-check them.
6. Expect SAMPLE_SELECT to complete (first sample 0 / PTS 83333) if the clamp holds. If it still stalls, the new `firstBlockedStage` is the next boundary. Do not merge until MODE B confirms.
