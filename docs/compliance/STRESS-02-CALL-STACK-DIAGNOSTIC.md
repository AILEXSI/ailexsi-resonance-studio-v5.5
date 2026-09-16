# STRESS-02 — Maximum call stack size exceeded (diagnostic only)

**No production fix in this change set.** Do not classify A–F until a human stack exists.

Base: STRESS-01 tip `fc7ab97` (PR **#19**, draft). STRESS-01 avcC `bitstream_restriction`, AFE-25 `prefer-software`, and ENC-01 AVC encoder selection are **untouched in behavior**.

Human evidence on PR #19 MODE-B EXE (`fc7ab97`):

- previous STRESS-01 failure at timeline 584700 ms / PTS 100000 is no longer reproduced
- 11-minute export **PASS**
- longer ~25-minute stress export **FAILS** with only: `Maximum call stack size exceeded`
- no useful stack was exposed

This pass adds capture only. The original failure must still occur.

## What was added

| Piece | Where | What it does |
| --- | --- | --- |
| Original throw capture | `src/core/exporter/export-fail-dump.ts` | Records `error.name`, `error.message`, **original** `error.stack`. Does not construct a replacement Error for the stack. Non-Error: `typeof` + `String(value)`. |
| Outermost export boundary | `exportTimeline` try/catch; `exportWithWebCodecs` encode + mux catch; App `startExport` catch | Formats the dump into `ExportResult.error` / failed dialog. Stack-overflow `RangeError` is **rethrown unchanged** (not wrapped as `AFE_DECODE_FAILED`). |
| Global handlers | `window.onerror` + `unhandledrejection` in `src/main.tsx` | Reporting only. Chain previous handlers. **Do not swallow** (`preventDefault` / return true). |
| Export context | live snapshot updated during encode/mux | Appended when the error occurs (see field list). |
| Failed-status | existing scrollable `.export-dialog-status` | Dump is the dialog error text (`data-export-fail-dump="1"`). Not console-only. |
| Diagnostic MODE-B maps | `AILEXSI_DIAG_SOURCEMAP=1` | Production minify + source maps + `keepNames`. See build card below. |

## Where the dump appears

On export fail, the Export dialog **failed-status** (mono, `pre-wrap`, `max-height` 50vh, `overflow: auto`) shows:

```
STRESS-02 CALL-STACK DIAGNOSTIC
productVersion 5.5.0
gitSha <short SHA>
frameEngine AILEXSI
branch <branch>
sourcemapDiagnostic yes|no
error.name RangeError
error.message Maximum call stack size exceeded
error.stack
<original stack, verbatim>
--- export context ---
exportFrame …
timelineMs …
…
--- operator ---
Mark FIRST application frame …
Mark FIRST repeated function/frame …
```

`failExportDialog` still prefixes build identity if it is not already in the text.

## Context fields (append if available)

`productVersion`, `gitSha`, `branch`, `exportFrame`, `timelineMs`, `fps`, `resolution`, `clipId`, `clipName`, `sourceId`, `sourceInMs`, `sourceOutMs`, `pictureMode`, `videoReq`, `videoDec`, `videoEnc`, `afeFrames`, `visFrames`, `blackFrames`, `decoderQueue`, `encoderQueue`, `transactionId`, `requestedSample`, `requestedPts`.

Missing values are `n/a`.

## Source-mapped diagnostic MODE-B EXE

Production-equivalent runtime: **minify stays ON**. Maps + `esbuild.keepNames` are the only compile delta.

### Local PowerShell

From the V5.5 repo root, **either**:

```powershell
$env:AILEXSI_DIAG_SOURCEMAP = "1"
npm run tauri:exe
```

**or**

```powershell
npm run tauri:exe:diag
```

(`tauri:exe:diag` sets `AILEXSI_DIAG_SOURCEMAP=1` then runs `npm run tauri:exe`.)

`BUILD_AND_RUN_V5.5.cmd` also works if the env var is already set in that PowerShell/cmd session (`$env:AILEXSI_DIAG_SOURCEMAP="1"` then the cmd).

Do **not** use a no-minify build for this stress — minify changes stack depth and may hide the failure.

### Maps on disk

| Location | Notes |
| --- | --- |
| `dist/assets/*.js.map` | Vite output after `web:build` |
| Bundled inside the Tauri EXE | WebView2 DevTools can resolve if opened |
| Repo-root `stress-02-sourcemaps/` | Copied by `scripts/copy-exe.ps1` when maps exist |

Dump field `sourcemapDiagnostic yes` means this EXE was built with the flag.

### Reading the stack

1. Copy the full failed-status (scroll — do not screenshot-only if the stack is long).
2. **FIRST application frame** = first frame after V8/WebView2 natives whose name/path is app code (`src/core/…`, `exportWithWebCodecs`, `muxAvcToMp4`, `concat`, …). `keepNames` should keep those names even when minified.
3. **FIRST repeated function/frame** = first function that appears in a tight repeating run (recursion or mutual recursion).
4. If names are still minified (`a`, `s`, `n`), resolve that line against `stress-02-sourcemaps/*.js.map`.

## Candidate audit (NOT proven)

Inspected the export path **before** changing encode/mux logic. Each item is **CANDIDATE**, not cause. Nothing below was modified merely because it exists.

| ID | Shape | Location | Why it is a candidate | Proven? |
| --- | --- | --- | --- | --- |
| C1 | `fn(...largeArray)` | `src/core/exporter/mp4.ts` `concat(...opts.samples.map(s => s.data))` | 25 min × 30 fps ≈ 45 000 video samples applied as arguments. 11 min ≈ 19 800. Classic V8 stack overflow via spread. | **CANDIDATE** |
| C2 | `fn(...largeArray)` | `mp4.ts` `fullBox("stsz", …, ...opts.samples.map(s => u32(s.data.length)))` | Same N as C1, one `u32` argument per sample. | **CANDIDATE** |
| C3 | `fn(...largeArray)` | `mp4.ts` `concat(...audio.samples.map(s => s.data))` | AAC ~43 packets/s × 25 min ≈ 64 000 arguments. | **CANDIDATE** |
| C4 | `fn(...largeArray)` | `mp4.ts` audio `stsz` spread of per-sample sizes | Same N as C3. | **CANDIDATE** |
| C5 | `fn(...largeArray)` | `mp4.ts` `fullBox("stss", …, ...keyIndexes.map(u32))` | Keyframe list; smaller than C1/C2 unless very frequent keys. | **CANDIDATE** |
| C6 | `fn(...largeArray)` | `mp4.ts` `packedStts` → `fullBox("stts", …, ...parts)` | Packed when deltas repeat (typical constant fps). Large only if deltas vary per sample. | **CANDIDATE** |
| C7 | `array.push(...largeArray)` | `src/core/frame-engine/frame-match.ts` `pendingIndexes`: `out.push(...q)` | `q` is per-PTS queue (usually 1). Overflow only if one PTS queued a huge list. | **CANDIDATE** |
| C8 | `array.push(...largeArray)` | `src/core/frame-engine/decoder.ts` `rejectWaiters`: `pending.push(...q)` | Waiter queues are small by design (AFE water marks unchanged). | **CANDIDATE** |
| C9 | `String.fromCharCode(...largeArray)` | `src/core/exporter/wav.ts` tag reader | Used for short byte windows, not the ~25 min video mux. | **CANDIDATE** |
| C10 | `Math.max` / `Math.min(...largeArray)` | `src/core/timeline.ts` (edit ops), not the encode loop | Not on the per-frame export hot path. | **CANDIDATE** |
| C11 | Recursive flatten / reduce / tree walk | `avc-sps.ts` `walkSps` | Bounded NAL walk; not timeline-length. | **CANDIDATE** |
| C12 | Recursive timeline traversal | Export uses iterative `groupFrameRuns` / frame loops | No recursive clip-tree walk found on the encode path. | **CANDIDATE** (absence noted) |
| C13 | Mutually recursive state / listener callbacks | Encoder `output` / `error`, decoder `onOutput`, React export progress | Possible if a listener re-enters encode; not shown by current evidence. | **CANDIDATE** |

**Do not treat C1–C13 as the cause.** A human stack + first app frame decides.

## Preserved (do not regress)

- STRESS-01 PTS 100000 avcC `bitstream_restriction` patch
- AFE-25 `prefer-software`
- ENC-01 AVC encoder capability selection
- Exact PTS; no Mediabunny runtime; no WebM fallback
- AFE scheduling, timeouts, queue limits, reset/recreate escapes — **unchanged**
- No `setTimeout` / yield hacks
- No stack-limit increase
- No speculative production fix

## Operator card — human repro

You do **not** need a new timeline. Repeat the **same long ~25 min stress export** that failed on `fc7ab97` with only `Maximum call stack size exceeded`.

1. Build the **diagnostic** EXE (`AILEXSI_DIAG_SOURCEMAP=1` / `npm run tauri:exe:diag`) from this branch SHA.
2. Confirm chip **5.5.0**, Frame Engine **AILEXSI**, `sourcemapDiagnostic yes` will appear in the fail dump.
3. Same project / same ~25 min range / same 1080p fps as the failing run.
4. Export. When it fails, **scroll the failed-status** and copy the full dump (stack + context).
5. Report:
   - `error.name` / `error.message`
   - full `error.stack`
   - **FIRST application frame**
   - **FIRST repeated function/frame** (or “none”)
   - context: `exportFrame`, `timelineMs`, `stage`, clip, `videoReq/Dec/Enc`, queues, `requestedSample` / `requestedPts`
6. Confirm STRESS-01 (PTS 100000) and ENC-01 1080p still behave as on `fc7ab97` if you re-check them.

**Need:** one useful failure report with stack + first app frame.  
**Do not merge. Do not implement the production fix from this pass.**

## Verdict

**Not classified A–F** on this diagnostic pass. Instrumentation + candidate audit only.

**Later:** STRESS-04 (branch off `04fc687`) classified the human stack as **C — EXCESSIVE SPREAD / ARGUMENT COUNT** at `videoTrak` STSZ `fullBox` → `box`. Production mux fix is on that branch. **Keep this dump capture.** Do not merge this diagnostic PR as production merely because the fix used its evidence.
