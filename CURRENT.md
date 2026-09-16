# Aktueller Stand — V5.5

Ein Blick. Kein Wunschzettel.

**V5.5 bootstrap** from V5 AFE-03 `4e80162`. Mediabunny removed. Export = AILEXSI Frame Engine only. **AILEXSI Frame Engine export on Windows WebView2 is HUMAN-PROVEN** (operator EXE, PR **#17** tip `a01576b` merged to main). **AFE-04** B-frame / varying CTTS is in that proven EXE lineage. V5 repo not modified. V5 PR #23/#24/#25 not merged. **ENC-01** 1920×1080 H.264 @ 24/25/30 is **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** on Windows WebView2 MODE B EXE tip `0ec7758` (PR **#18**). AFE remains closed — this stamp is encoder capability only.

Evidence: **IMPLEMENTED** | **AUTOMATED-TESTED** | **HUMAN-PROVEN** | **PLANNED** | **NOT IMPLEMENTED**.
**HUMAN-PROVEN** only from MODE B operator EXE acceptance — not from tests, agent screenshots, or Chrome-only runs.

| Feld | Stand |
| --- | --- |
| Datum | 2026-09-16 |
| Ordner | `C:\\Users\\marti\\ResonanceStudio-V5` |
| Version | **5.5.0** (package `@ailexsi/resonance-studio-v5.5` / tauri `AILEXSI Resonance Studio V5.5` / Cargo `ailexsi-resonance-studio-v5-5` / toolbar chip **`V5.5.0`**). JSON `schemaVersion` **5**. |
| main | This V5.5 repo. Source working tree: V5 `4e80162`. Not a merge of V5 PR #23/#24/#25. |
| Lineage | D/E/save/export EXE: PR **#15** tip `234a7810a569f741ab2c9f4dd680ed21efae8320`. **F HUMAN-PROVEN** in EXE from V5 PR **#17** feature tip `c4391cbf74edefcd5d37ba5e77af05ff91e58c43`. **G HUMAN-PROVEN** in EXE from PR **#18** tip `896b64083f541d013b289de0e1eb98cfe3dcfb06`. **H HUMAN-PROVEN** in local Vite + Root-Exe from PR **#19** tip `24f43377569dae333aa5f7efdfe68a303805d2a8` (merged to main as `0936da7`). Owner confirmed `24f4337`. **V5.5 AILEXSI export HUMAN-PROVEN** on Windows WebView2 at PR **#17** tip `a01576b` (merged to main). **ENC-01 1080p HUMAN-PROVEN** on EXE tip `0ec7758` (PR **#18**): 1920×1080 H.264 @ 24/25/30. |
| Base | `main` after PR **#17** merge (`a3a734c` = merge of `a01576b`). D→H stack unchanged. |
| Live-UI | Chrome chrome still `docs/ui-2026-09-13.png` (Vite `127.0.0.1:1421`, MODE A). **EXE HUMAN-PROVEN** 2026-09-13: `docs/exe-acceptance-2026-09-13.png` (Task Manager + Export Fertig). See `docs/ACCEPTANCE.md`. |
| App icon | 愛 — Tauri icons in `src-tauri/icons/` (PR-#5-Icon-Base). `docs/ailexsi-app-icon.png` is referenced historically and is **not** in this tree. Icons nicht anfassen. |
| Start Dev | MODE A: `npm run web:dev` **oder** `npx tauri dev` auf `127.0.0.1:1421` (`beforeDevCommand` = `web:dev`) |
| Start Standalone | MODE B (Windows): `npm run tauri:exe` / `BUILD_AND_RUN_V5.5.cmd` → `AILEXSI Resonance Studio V5.5.exe`. Linux bootstrap did **not** build the EXE. |
| Top bar | File \| Import \| Export \| [ARRANGE] \| [CUTTER] — **kein** Export WAV, **kein** Help, **kein** Undo/Redo/Split/Snap oben |
| Transport | Play / Pause / Stop / … + **Split** + **Undo** + **Redo** + **Snap** + **Help** |
| Follow playhead | **HUMAN-PROVEN** (earlier Chrome + local exe @ `0df5da1` on main). Follow ON: Nadel pinnt bei ~65% der sichtbaren Lane, danach scrollt **ein** `scrollMs` (Ruler, VIS, V1/V2, audio collection). Seek paget nur, wenn die Nadel den View verlässt. Follow OFF: kein Auto-Scroll, kein Force-Scroll. This EXE pass: existing playback / timeline remained functional. |
| Loop | **HUMAN-PROVEN** (earlier). Loop OFF spielt über OUT weiter (OUT = Marker, kein Stop). Loop ON wrappt OUT→IN. |
| Compact headers | Kurze Lanes (`< 46px`): VIS `VIS [M] [Scene]`, V/A `V1 [M] [S]` in einer Zeile. Default ~52px bleibt gestapelt. |
| File overlay | New / Speichern / Speichern unter / Öffnen / Zuletzt — **kein** Ordner wählen, **kein** Revert, **keine** MEDIA-Durchsuchen-Zeile. Import bleibt der Toolbar-Button. Media-Bin (Suche/Filter/Place) kann im Overlay sitzen, lädt aber keine Dateien. |
| Speichern / Speichern unter | **HUMAN-PROVEN** in EXE. **Speichern:** Tauri schreibt gemerkten `lastPath` ohne Picker; ohne Pfad öffnet den nativen Save-Dialog. **Speichern unter:** immer Picker, `defaultPath` versioniert (`Stem.vN.resonance.json`, nie Windows `(2)`). Panel zeigt Dateiname + Elternordner (oder `Pfad gemerkt`) sobald `lastPath` da ist. Chrome: `showSaveFilePicker` / FSA. Firefox: kein FSA → Download. |
| Project `.vN` | **HUMAN-PROVEN.** Suggested name `Untitled_Resonance.v1.resonance.json` (leer → `.v1`; unversioniert belegt v1 → `.v2`). Shared helpers with Export (`filename-version.ts`). |
| Help overlay | Scrollbares 2-Spalten-Sheet (`?` / Help). `max-height` Viewport (`dvh`/`vh`), sticky Header, innerer Scroll — passt ins maximierte Fenster. |
| S / Split | Nur **aktive/selektierte** Tracks unter VIS / V1 / V2 / audio collection (not A1/A2-only). Multi-Select OK. Linked Mates auf anderen Tracks werden **nicht** mitgeschnitten. |
| VIS S-cut | **HUMAN-PROVEN** (earlier). S teilt VIS-Events / Cues / Window am Playhead, wenn VIS fokussiert ist. V/A clips remain whole. |
| Dynamic audio | **D HUMAN-PROVEN in EXE.** Collection, not A1/A2 architecture. Default project still A1+A2 (`MIN_AUDIO_TRACKS` 2). Capacity **64** (`MAX_AUDIO_TRACKS`). Created as needed. Circular `+`/`−` on the **last** audio header (`−` hidden at floor 2, `+` disabled at 64). Stable ids (`A1`/`A2` legacy; new `a_*`); labels A1, A2, A3…. Legacy A1/A2 JSON loads. Lane template reused. `.timeline-lanes` **vertical** scroll. Mixer channels follow the collection; **horizontal** mixer scroll. Resizable mixer / workspace divider. Track/mixer state stays in sync. |
| Stem import | **E HUMAN-PROVEN in EXE.** Import picker is multi-select (browser + Tauri). Two or more audio files in one action → each file one MediaAsset + one audio track (empty lanes first, then `addAudioTrack`). Clips share one start (playhead if >0 / snap, else 0). Labels from filename (extension stripped). Status reports cap skips (`audio track limit 64`). ZIP of WAVs expands in-memory (store + deflate, no new deps). Single-file Import still appends. Optional `groupId` when filenames share a prefix — F maps that into `Project.groups`. Remaining E refinements: Suno naming normalize, single-vs-multi placement polish — **PLANNED**. |
| Track / chapter groups | **F HUMAN-PROVEN in EXE (V5 SHA).** Collapse UI only (no group bus). Collapse ids in `resonance-studio-v5-5-group-collapsed`. Stem prefix `groupId` maps into `Project.groups`. |
| Volume automation | **G HUMAN-PROVEN in EXE.** VOL-Lane (label **VOL**, not V). Operator: VOL lane works well; Volume Automation accepted. Clip gain ≠ static track fader ≠ automation. Linear points. |
| Write volume | **H HUMAN-PROVEN in EXE.** Compact **W** on audio tracks. Writes into the existing G envelope during playback. Owner: local Vite + Root-Exe `24f4337`. Ruler flex-shrink + VOL header polish included. |
| VIS click-seek | Klick in die VIS-Lane (leer oder Event-Fill) setzt den Playhead — gleicher Snap-Seek wie V1/V2/A-Lane-Body. |
| AUTO | Video zuerst, VIS nur in der Lücke (AUTO-Zeile unangetastet) |
| Export | H.264-MP4. Dialog shows **`Frame Engine: AILEXSI`** from `getFrameSourceBackend()`. No silent HTMLVideo export fallback. Typed `AFE_*` failures. **HUMAN-PROVEN on Windows WebView2** (MODE B EXE from PR **#17** tip `a01576b`, merged): Mediabunny-free AILEXSI Frame Engine, including VIS-mix / multi-clip, AFE-25 `prefer-software` tail, and stall/export-fail dump identity (`productVersion` / `gitSha`). Chrome 90/90/90 and pixel harnesses stay **AUTOMATED-TESTED** only. **AFE-04:** B-frames / varying CTTS parse + PTS-keyed decode match (**IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** on that Windows EXE lineage). **AFE-05:** B-frame export submit-ahead + stall watchdog (`AFE_DECODE_STALL`) — **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. AFE-05 lookahead (6) did **not** clear Windows WebView2. **AFE-06:** mid-run flush nudge did **not** clear Windows (`decodeQueue=4`, `streamPts/Ready=0`, `flushes=1`). **AFE-07:** real video input recovery / exact-frame delivery — STEP A wait exact PTS → STEP B structure-bounded pump-more (no flush) → STEP C one GOP recreate (transaction id, origin identity) → STEP D FINAL_FLUSH only at true tail with watchdog. Production VIDEO: `allowSkip=false`, no silent null-yield / nearest / VIS / BLACK / paintFallback. VIS/BLACK never wait on AFE. Honest `videoFramesRequested/Decoded/Encoded`. **AFE-08:** TRANSACTION_END must not drain unneeded speculative decode. Windows VIDEO after AFE-07: `videoReq/Dec/Enc` 37/37/37 and 39/39/39 then stall at TRANSACTION_END (`sample/PTS` null, `streamPts/Ready` 0, `decodeQueue` 110–124, `submitted` 140, flush→watchdog). VIS-only Fertig OK. Transaction COMPLETE when requested VIDEO is terminal + encoded and there is no waiter — cancel speculative (generation bump, reset/recreate, ignore stale), do **not** flush leftover `decodeQueue`. `FINAL_FLUSH` only if `unresolvedRequestedVideoFrames>0` and no further useful input. Submit bounded to last requested + B-reorder + refs. Samples classified REQUESTED / REFERENCE_REQUIRED / SPECULATIVE. `TRANSACTION_END` + null request + Req==Enc → COMPLETE, not `AFE_DECODE_STALL`. AFE-07 exact-PTS rules preserved. **AFE-09:** unresolved vs encoded counter contradiction. Windows AFE-08 EXE: `videoReq/Dec/Enc` 46/46/46 **and** `unresolvedRequested` 10, `decoderResetForTransactionEnd` false, origin sample 38, `lastRequested` 81 (sample-index) vs `videoReq` 46 (frame-count). Two ledgers: exporter counted completed yields; decoder counted planned `requestedIndexes` still PENDING (lookahead + GOP resubmit). One source of truth: opened presentation samples. Increment `videoReq` when a request opens. Enc==Req + leftover `decodeQueue` → COMPLETE + cancel, `decoderResetForTransactionEnd` true. True missing exact PTS → `unresolved>0` AND Enc < Req; recover or typed stall with origin. `unresolved>0` with Enc==Req is impossible (invariant fails closed). **AFE-10:** open unresolved VIDEO request must keep decode ownership until exact PTS resolves. Windows AFE-09: `videoReq/Dec/Enc` 47/46/46, opened sample 38 PTS 1625000, `unresolved` 1, `WAIT_EXACT_PTS`, recovery 1/1/1, submitted 44 / required 140, `pending []` `waiter null` `streamPts 0` `decodeQueue` 29, `flushes` 0 — honest missing exact frame, not a counter lie. Recreate/reset was clearing `streamPts` + waiter while the ledger stayed open. Restore identity / exact PTS / protected role / PtsIndexMap / exact waiter after recreate. Progressive bounded pump 44→140 with brief exact-PTS waits; no PREFETCH bump; no mid-run `FINAL_FLUSH`. `unresolved>0` without waiter or pending PTS or recovery rebuild → immediate `AFE_REQUEST_OWNERSHIP_LOST` (no 3s mystery timeout). No VIDEO fallback. **AFE-11:** FINAL_FLUSH when useful input is exhausted for an open request — not when the current sample is run-tail. Windows AFE-10: sample 38 PTS 1625000, `WAIT_EXACT_PTS`, `videoReq/Dec/Enc` 47/46/46, `unresolved` 1, `submitted` 96, `lastRequested` 90, `lastRequired` 96, `decodeQueue` 81, `flushes` 0, `FINAL_FLUSH` no, `ptsRegistered` no, `waiterActive` no, `ownershipRebuilt` yes, `recoveryRebuilding` no, `ownershipState WAIT_REINSTALLED`. Pump reached lastRequired; sample 38 never arrived; gate was `atTail(currentRequestedSample)`. Allow one FINAL_FLUSH when `unresolved>0` AND `lastSubmitted>=lastRequired` AND no further useful input AND waiter inactive AND pending empty AND not recoveryRebuilding AND not complete. Ownership: unresolved>0 ⇒ waiter OR ptsRegistered/pending OR recovery OR FINAL_FLUSH armed. Else immediate `AFE_REQUEST_OWNERSHIP_LOST`. Exact PTS or typed `AFE_DECODE_STALL` only. No fake success. **AFE-12:** WebCodecs decodeQueue backpressure after recreate. Windows AFE-11: CASE A 30fps sample 38 PTS 1625000, Req47 Dec/Enc46, unresolved1, submitted140 lastRequired140, decodeQueue125 lastDecodedTs458333, pending includes 1625000, streamPts131 streamReady10 reorderCap10, FINAL_FLUSH yes; CASE B 25fps sample140 PTS5875000, Req145 Dec/Enc144, submitted140 decodeQueue125 lastDecodedTs458333, pending[] streamPts0 cancelledSpeculative130. 30fps streamReady==reorderCap and 25fps streamReady==0 share the flood — not retained VideoFrames alone. Hypothesis proven: unbounded `submitEncoded` reaches submitted140 / queue>=125 / lastDecoded stuck with `backpressureWaits` 0. `waitForDecodeCapacity` pauses at HIGH_WATER (`min(48, max(40, maxReorder+lookahead+bFrameNeed))`, never near 125). Resume on dequeue / output / exact resolve. INVARIANT: no output progress + queue>=HIGH_WATER ⇒ NO_MORE_SUBMISSION until progress or typed stall. Before first recreate, HIGH_WATER stop hands off to STEP C GOP recover (does not 3s-stall). After recreate, still-stuck HIGH_WATER is typed `AFE_DECODE_STALL`. Progressive pump is capacity-aware. FINAL_FLUSH AFE-11 intact; not begun with queue~125. No mid-run flush, no PREFETCH bump, no VIDEO fallback. AFE-08 cancel does not reset an unresolved exact request. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. **AFE-13:** backpressure deadlock after recreate (no output progress). Windows AFE-12: queue bound holds (peak 40). New stall: sample 68 PTS 2875000, Req39 Dec/Enc38 unresolved1, submitted92 lastRequired144, lastDecodedTs 2000000 stuck, decodeQueue 40 HIGH_WATER, `backpressureBlocked` / `noMoreSubmission`, `PUMP_LOOKAHEAD` / `RECOVERY_REBUILDING`, waiter null, `ptsRegistered` no, `FINAL_FLUSH` no, `gopStart` null, clip `… - Kopie.mp4` sourceInMs ~1529 / sourceOutMs 6042 / fps 30 / maxReorder 10. Producer paused at HIGH_WATER waiting for output that never comes; FINAL_FLUSH illegal while submitted < lastRequired. Persist open-GOP `decodeOrigin` as `gopStart`. After recreate: HIGH_WATER + stuck lastDecoded + unresolved → short output budget (not 3s sit) → ONE earlier-keyframe GOP recover with PTS/waiter rebuild, or typed `AFE_DECODE_STALL` if no earlier I-frame. Prefer earlier-keyframe before flush. Do not mid-run flush as pressure release. `usefulProgressImpossible` is not a FINAL_FLUSH trigger. HIGH_WATER for maxReorder=10 still admits B-frame deps. Queue never ~125. Exact PTS. AFE-04..12 preserved. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. **AFE-14:** post-recreate liveness — packet/config parity then bounded decode window. Windows AFE-13 720p30: HIGH_WATER holds (peak 40), `gopStart` 0, no earlier I-frame, decoder still stops after recreate (`lastDecodedTs` 458333 / ~frame 11), sample 34 PTS 1458333, submitted 55, Req/Dec/Enc 42/41/41, unresolved 1, lastRequested 68 lastRequired 92, FINAL_FLUSH no, ownershipRebuilt yes. Instrument first: compact fingerprints (index/PTS/DTS/duration/key/payload/config). PARITY INVARIANT `ColdStartChunk(N)==RecoveryChunk(N)`. First chunk after recreate: gopStart 0, sample 0 keyframe, expected PTS/DTS, else typed failure. Stall dump: `postRecreate*`, `packetParity`, `configParity`, `firstSubmittedAfterRecreate`, `earlierKeyframeAvailable`. Parity holds (same `makeChunk` / `decoderConfigOf`) → STAGE 3: first-fill HIGH keeps RECOVERY_FILL 40 (`min(48, max(40, RAW))`) so AFE-10/11 can reach lastRequired / FINAL_FLUSH; after recreate the 40 floor is gone (`HIGH = min(48, RAW)`, `RAW = maxReorder + L + B`, `L = min(6, streamLookahead)`, `B = prefetch`, `LOW = min(HIGH-1, max(L,B))`). Human post-recreate reorder10 prefetch4 lookahead6 → HIGH 20 < 40, LOW 6. Progressive toward lastRequired before STEP C; AFE-11 FINAL_FLUSH when useful input is exhausted. Resume only at LOW_WATER or exact frame ready — not refill on every dequeue. No-output + queue≥HIGH ⇒ no more `decode()`; bounded typed stall. `gopStart==0` → `earlierKeyframeAvailable=false`; do not re-loop AFE-13 escape. No software decode, no mid-run flush, no PREFETCH bump. FINAL_FLUSH AFE-11 intact. Exact PTS. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. **AFE-15:** exact-PTS tail ownership + FINAL_FLUSH drain. Windows AFE-14 720p30 first-fill (no recreate): sample 134 PTS 5625000, FINAL_FLUSH, pending[] ready[], decodeQueue 2, lastDecodedTs 5583333, gopStart 0, resets/recreates/recoveryAttempts 0, packetParity n/a, submitted 140 lastRequired 140, streamPts 0 streamReady 0, flushes 1, videoReq 40 Dec/Enc 39, unresolved 1, ptsRegistered yes, waiterActive no, ownershipRebuilt yes, ownershipState FINAL_FLUSH_ARMED, usefulInputExhausted yes, HIGH 40 LOW 6 Peak 40, backpressureBlocked no, stalledMs 3000. Not recreate/GOP/backpressure. Proven: `ptsRegistered yes` with `streamPts 0` is stale ever-registered; `FINAL_FLUSH_ARMED` ≠ exact PTS identity. INVARIANT: until RESOLVED/ERROR/ABORT retain identity via PtsIndexMap OR streamReady exact OR exact waiter OR active recovery rebuild. Else immediate `AFE_REQUEST_OWNERSHIP_LOST`. Split `ptsEverRegistered` / `ptsCurrentlyRegistered` (dump `ptsRegistered` is live only). STAGE 1–2 lifecycle + takeExact leave/rebind. STAGE 3 `targetPts*` / `tailOutput*`. CASE A target output exists → rematch bookkeeping only. CASE B never exists → genuine WebCodecs drain if queue>0 after flush; optional ONE extra flush — not frame fallback. lastRequired 140 vs sample 134 is dependency-closed. Do not lower HIGH_WATER (`decodeQueue=2`). AFE-11 FINAL_FLUSH intact. AFE-12/13/14 water marks unchanged. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. **AFE-16:** empty pump slice + LOW_WATER starvation. Windows AFE-15: requested sample 74 PTS 3125000, lastSubmitted 59, lastDecodedTs 2000000 stuck, decodeQueue 7, LOW 6, HIGH 12, `backpressureBlocked` / `noMoreSubmission`, pumpSlice 60-65, submit trace `PUMP_LOOKAHEAD:60-59/q7->7/ts2000000->2000000/paused`. Root cause: `beginSubmitPhase(nextDecode=60)` then `waitForDecodeCapacity` refuses solely because paused && queue 7>LOW 6 (5 HIGH credits unused); no `decode()`; `endSubmitPhase` writes submittedTo=lastSubmitted 59. Backpressure assumed queued input would produce further output / drain to LOW. False when useful decode-order input toward lastRequired remains. CAPACITY INVARIANT: exact frame not ready AND useful input remains AND lastSubmitted<lastRequired AND queue<HIGH → must not block solely because queue>LOW. Horizon is lastRequiredDecodeSample (H.264 reorder/B-frame deps), not requestedSample. LOW_WATER hysteresis applies only after lastRequired is fully submitted. HIGH_WATER still caps growth. Helper: `mustAdvanceTowardDependencyHorizon`. No stall-timeout bump, no nearest PTS, no dropped frames, no queue-limit raise, no MP4 special case. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-17:** HIGH_WATER target reachability / bounded dependency credits. Windows AFE-16: requested 43 PTS 2000000, lastSubmitted 40, lastRequired 140, decodeQueue 12 = SOFT HIGH 12, LOW 6, lastDecodedTs 1000000 stuck, frozenAtHighWater / backpressureBlocked / noMoreSubmission, usefulInputExhausted no, FINAL_FLUSH no, packet/config parity yes, firstSubmittedAfterRecreate 0 key, postRecreateSubmitted 41 / outputs 23, targetPtsSeen no. Submit `PUMP_LOOKAHEAD:0-40` then empty `41-40/paused`. Stale `pumpSlice 92-97` contradicted the live attempt. Root: exact sample 43 lies beyond lastSubmitted 40 while submission is permanently blocked at SOFT HIGH. AFE-16 fixed LOW_WATER starvation; this is the producer at SOFT HIGH before the current requested frame / its local decode deps. LOCAL horizon = lastRequired(current requested), capped by transaction lastRequired (sample 43 / reorder 2 / prefetch 4 → **49**, not 140). SOFT_HIGH_WATER = existing AFE-14/16 HIGH. HARD_DEPENDENCY_CEILING = min(CAP, SOFT + min(remaining-to-local, L+B)) after recreate only (human HARD **21**). Borrow HARD only when exact unresolved, useful input remains, currentTarget > lastSubmitted, no output progress, queue already at SOFT. Stop once the local horizon is submitted. HARD reached + no progress → no more submit (existing recover/stall). No global HIGH raise, no timeout bump, no snap/nearest/drop/fallback, no mid-run flush, no 40/125 flood. pumpSlice is the current/last actual submit attempt. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-18:** post-horizon liveness / bounded local advance. Local Powershell after AFE-17: requested 61 PTS 2583333 (clip B / sourceInMs 2500), lastSubmitted 67 >= currentTarget 67 >= 61, lastRequired 102, lastDecodedTs 2208333 < 2583333, targetPtsSeen no, SOFT==HARD 12, queue 12 peak 22, frozen/backpressure/noMoreSubmission, FINAL_FLUSH yes, stalledMs 3000, videoReq/Dec/Enc 46/45/45. Correct root: formula LOCAL **was** reached; exact PTS never produced. Not "target beyond lastSubmitted". Not "only raise HARD above SOFT". Formula lastRequired(61)=**67**; dump proves 67 insufficient (lastDecoded stuck ~sample 52). One extra lookahead+prefetch window → live **77**, not 102/140. HARD at 67/77 = 12+10 = **22**. Freeze that ceiling so remaining-shrink cannot stop the advance. Recreate/beginStream + `releaseStaleFinalFlushIfLiveHorizonOpen` clear leftover FINAL_FLUSH (same file vA→VIS→vB, or premature arm at 67) so this request can borrow then drain. `mayLocalHorizonFinalFlush` after live horizon submitted + held queue + lastDecoded < target. Transaction FINAL_FLUSH still lastSubmitted>=lastRequired. First-fill HARD may exceed SOFT diagnostically when remaining>0; borrow still requires recreate (first-fill stays on SOFT HIGH). No timeout bump, no snap/nearest/drop, no global HIGH raise. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-19:** formula-horizon drain — AFE-18 formulas reached production Chrome but did not emit the exact PTS. MODE A @ AFE-18 HEAD: live target **77** / HARD **22** computed, lastSubmitted stayed **67**, queue **20**, lastDecoded **1875000**, pumpSlice **68-67**, `finalFlushArmed` cleared because 67<77, transaction flush illegal at 67<102, unresolved 1, MP4 0 bytes. Requested sample **61** was already submitted. HARD-pin-after-recreate hypothesis discarded. Fix: one formula-horizon `FINAL_FLUSH` when lastSubmitted>=formula **67**, exact not ready, queue held — not a flood to 102, not AFE-06 mid-run pressure flush. After recreate, require `postRecreateOutputs>=lookahead` so AFE-13 freeze-after-few-emits still stalls without hang-flush. Variant b0 (vB sourceIn 0): lastDecoded null / 0 outputs after recreate → extra drain when the first post-recreate chunk is a keyframe. MODE A Chrome production `exportWithWebCodecs`: VIDEO→VIS→VIDEO 4s 1280×720 30fps completes; req/dec/enc **90/90/90**, vis **30**, black **0**, unresolved **0**; MP4 `ffprobe` 4.000s / 120 frames / h264. Variant b0 also 90/90/90. Headless AAC probe produced `audio: none` this run. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-20:** human EXE stall on a different real clip (`897e0449-….mp4`), not fixture 61/67. Sample **81** PTS **3416667**, originExportFrame 37 / ~1233ms, lastDecodedTs **2500000**, decodeQueue **15**, frozenAtHighWater, earlierKeyframeRecovered **no**, recreates 1. Root: `gopStart 0` makes AFE-13 earlier-I escape ineligible (correct). SOFT HIGH for maxReorder 5 is **15**; lastSubmitted inferred **~75 < 81**; progressive treated SOFT freeze as terminal so HARD credits (25) never reached sample 81. Not a missing drain of an already-submitted PTS. Fix: `mayAdvancePastSoftFreeze` — while lastSubmitted < live local horizon and queue < HARD, keep borrowing after recreate even if frozen at SOFT. Drain also legal once lastSubmitted ≥ requested. Stall dump now **front-loads** lastSubmitted / requestedSubmitted / currentTarget / formula / soft / hard / targetPtsSeen / gopStart / earlierKeyframe* / postRecreate / pumpSlice / submitPhases so one EXE screenshot is complete. Export dialog failed-status scrolls. MODE A fixture still 90/90/90. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-20 Shape A (prioritize):** EXE still **0367eb1**. Sample **90** PTS **3791667**, lastSubmitted **82** < 90 < target **96**, SOFT **12**, HARD **22**, queue **15** (7 HARD unused), frozen/backpressure/noMoreSubmission, pumpSlice **83-82** empty, recreates 1, 62 post-recreate outputs. Root: borrow died once queue left SOFT or neighbors progressed; expire treated `queue>=SOFT` as terminal. Fix: spend HARD while lastSubmitted < live target and queue < HARD, including queue ∈ (SOFT, HARD) and outputProgressed. Do not raise SOFT to 40 or flood to 140. **AFE-20 Shape B / FINAL_FLUSH tail:** sample **134** PTS **5625000** submitted, lastSubmitted **140**, queue **2**, lastDecoded **5583333**, exact never seen. Root: CASE B drain skipped when identity gone / first flush sat 3s / `targetPtsUs` rebound. Fix: extra genuine drain + exact-only `targetPts*` + 120ms post-flush wait. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE dump build identity:** stall / export-fail text front-loads `productVersion` (5.5.0), `gitSha` (Vite `git rev-parse --short HEAD`), `frameEngine AILEXSI`, `branch`. **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (operator EXE dumps on the `a01576b` lineage). **AFE-21:** HARD ceiling reached before local horizon + post-recreate liveness. Human on AFE-20 tip: sample **38** PTS **1625000**, lastSubmitted **36** < 38 < target **44**, SOFT **12**, HARD **20**, queue **21** peak **22**, lastDecoded **458333**, recreates 1, postRecreate 37/10, pumpSlice **37-36** empty, gopStart 0, no earlier I, stalledMs 3000. Root: first post-recreate HARD is **22**; remaining-shrink + pin-clear reported HARD **20** under a live queue of 21 (HARD was not a cap). After recreate the decoder froze at 458333 with 27 submittedMinusOutputs; AFE-20 mid-band spend cannot borrow past HARD; no earlier I. Fix: pin HARD at the episode max while lastSubmitted < live target; `queue >= HARD` never submits; one output-gated HARD-horizon reset+rebuild from gopStart when lastSubmitted < requested < target and queue >= HARD; typed stall only after that escape is exhausted. Do not raise SOFT/HARD globally, flood to 140, or bump the timeout. AFE-20 Shape A/B unchanged. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-22:** hard-horizon reset must cover submitted-but-unseen exact PTS. Human EXE @ `c73447a`: sample **28** PTS **1375000**, requestedSubmitted **yes**, lastSubmitted **34**, currentTarget **44** · formula **34** · lastRequired **144**, SOFT **12**, HARD **22**, queue **19** peak **22**, lastDecoded **458333**, targetPtsSeen **no**, gopStart 0, no earlier I, postRecreate 35/10, hardHorizonReset **no**, FINAL_FLUSH yes, frozen/backpressure/noMoreSubmission, pumpSlice **35-34** empty, recreates 1, stalledMs 3000. Root: exact sample already submitted (34>=28) but PTS never emitted; decoder dead at 458333 after recreate (10 outputs). AFE-21 requires lastSubmitted < requested so it correctly did not fire. formula **34** = lastRequired(28); current **44** = AFE-18 post-horizon (34+6+4) because formula was submitted and lastDecoded < target — dump names `horizonExtended yes`. Fix: `maySubmittedUnseenHorizonReset` when exact unresolved + requestedSubmitted + targetPtsSeen no + recreates>=1 + no progress toward target + (queue>=SOFT or frozen) + no earlier I + reset unused — one controlled recreate+ownership rebuild from gopStart, then output-gated refill; typed stall only after exhausted. Do not require lastSubmitted < requested for this escape. Prefer reset over empty 35-34 borrow toward 44/144. No global HARD raise, no flood to 144, no timeout bump, no snap/Mediabunny. AFE-20/21 unchanged. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-23:** hard-horizon reset fired but same liveness death. Human EXE @ `b91ecfc`: sample **28** PTS **1375000**, requestedSubmitted **yes**, lastSubmitted **34**, current **44** · formula **34** · `horizonExtended yes`, SOFT **12**, HARD **22**, queue **19**, lastDecoded **458333**, postRecreate 35/10, **hardHorizonReset yes**, recreates **2**, gopStart 0, no earlier I, pumpSlice **35-34**, visFrames **0** at stall, videoReq/Dec/Enc **191/190/190**. Pure VIDEO export works; VIDEO+VIS mix still fails. Root: AFE-22 repeated the same gopStart=0 recreate; packetParity/configParity **yes**; decoder still dies at ~10 outputs / 458333. Fix: after reset exhausted **and** identical fingerprint → `mayPostResetLivenessReopen` closes the native decoder and cold-reopens (no recreateCount bump); SOFT window until lastDecoded moves past the death PTS; typed stall only if that reopen dies the same way. VIS→VIDEO / black→VIDEO evicts the cached frame source (`mustColdOpenVideoDecoder`). Transaction-end **closes** instead of reset+reconfigure. No timeout bump, no snap, no flood to 144, no Mediabunny. AFE-20/21/22 predicates kept. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-24:** liveness reopen did not fire despite fingerprint match. Human EXE @ `dea72ca`: same 28/1375000 / 34 / 458333 / 10 / hardHorizonReset **yes** / recreates 2, **postResetFingerprintMatch yes**, **livenessReopen no**, **coldOpenAfterVis no**, FINAL_FLUSH, stalledMs 3000. Root: reopen was gated on `hardHorizonResetExhausted` (`lastDecoded===lastDecodedAtSubmit`). After AFE-22 reset, WebView2 emits the death *after* the last submit, so exhausted stayed false and the scheduler never called reopen. Fix: invoke reopen when fingerprint matches after hardHorizonReset (including after FINAL_FLUSH); dump `livenessReopen yes` / `livenessReopenReason`. `coldOpenAfterVis no` is correct — visFrames 0, first video run, VIS later in the mix. No timeout bump, no snap, no flood to 144. AFE-20/21/22/23 kept. **IMPLEMENTED / AUTOMATED-TESTED**, not HUMAN-PROVEN. Do not mark HUMAN-PROVEN from this pass. **AFE-25:** EOF / tail differential on `5bec440` (not 458333 liveness). Human: sample **142** PTS **5958333**, lastSubmitted **144**, lastDecoded **5916667**, targetPtsSeen **no**, FINAL_FLUSH, queue 0, resets/recreates 0. **CASE B.** Sample 142 / 5958333 exists on the 24fps 145-sample analog; 143/144 are later decode refs; sourceTime of the last export frame selects 142. Chrome VideoDecoder **emits 5958333** (matched 142) during flush; Mediabunny VideoSampleSink also emits 5.958333s. AILEXSI Chrome `getFrameAt` succeeds. avcC already has VUI bitstream_restriction (not a missing-VUI clip). Human WebView2 never emits 5958333 (`targetPtsSeen no`). Fix: export `VideoDecoder` `hardwareAcceleration: prefer-software` — first decode-lifecycle difference vs Chromium HW tail-drop; no new escape, no HIGH/LOW/HARD change, no snap, no Mediabunny runtime. **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** on Windows WebView2 (operator confirmed EXE from tip `a01576b`, merged via PR #17). Intermediate AFE-17–24 items stay **AUTOMATED-TESTED** as the path to that tip; the proven product surface is Mediabunny-free AILEXSI export including VIS-mix / multi-clip + prefer-software tail + dump identity. **ENC-01** 1920×1080 H.264 @ 24/25/30 is **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** on EXE tip `0ec7758` (PR **#18**). AFE remains closed. V5 EXE HUMAN-PROVEN is historical (Mediabunny default, chip 5.0.0). |
| Visualizer | **HUMAN-PROVEN** (earlier). Canvas-Modi unverändert. Geladenes first-audible-audio / Mix-PCM treibt Onset/Energy. Silence gate (`rms < 0.02 && bass < 0.03`). Beat = audio-derived onset/energy — **kein** DAW Beat-Grid-Lock. |
| Persistenz | `last-project.json` in V5.5 AppData (`com.ailexsi.resonance-studio-v5-5`). Keys `resonance-studio-v5-5*`. JSON `schemaVersion` **5**. App/Tauri/Cargo **5.5.0**. Separate from V5. |
| Dev/test fixtures | `tests/fixtures/user-video.mp4` + `user-audio.mp3` only. Owner-provided development/test fixture supplied specifically for internal Grok VM testing during remote development. Not intended for product distribution. **NOT DISTRIBUTED / TEST-ONLY** — removed from `public/fixtures/` so Vite/`dist`/Tauri cannot copy them. `export-check.html` is repo-root / Vite-dev only (not under `public/`). This note is provenance of presence, **not** a copyright-ownership or commercial-clearance claim. |
| Deps / SBOM | Mediabunny **removed**. CycloneDX SBOMs + inventory: `docs/compliance/`. MODE A AFE-25 (tip `a01576b`, still on main after PR #17): **1209 passed / 2 failed / 1211 total in 144 files** (`tsc --noEmit` clean). The 2 failures are the pre-existing AFE-15 A/N dump-ban (`visFrames`/`blackFrames`/`null` trip `/VIS|BLACK|null/`) — still present on main; not a merge regression. AFE-25 file: **4/4**. AFE-24 file: **4/4**. AFE-23 file: **7/7**. AFE-22 file: **7/7**. AFE-21 file: **8/8**. AFE-20 Shape A file: **13/13**. AFE-20 Shape B tail file: **7/7**. AFE-19 file: **7/7**. AFE-18 file: **10/10**. AFE-17 file: **12/12**. MODE A Chrome VIDEO→VIS→VIDEO fixture still **90/90/90** — **AUTOMATED-TESTED**, not HUMAN-PROVEN. Chrome B-frame pixels **1188/1188 EXACT** remain AFE-04/05 MODE A evidence. Windows WebView2 AILEXSI export (VIS-mix / multi-clip + AFE-25 prefer-software) is **HUMAN-PROVEN** at `a01576b` merged. **No LICENSE. No THIRD_PARTY_NOTICES. Does not claim MPL FREE. Licensing is not HUMAN-PROVEN.** |
| Nächster Slice | Production Pass **I** (44-Track Acceptance) — **PLANNED / NOT IMPLEMENTED**. D + E + F + G + **H** stay HUMAN-PROVEN. Future UI zettel is **not** I. STOP — no I+. |
| Production Pass | **D HUMAN-PROVEN** (incl. mixer resize/scroll). **E HUMAN-PROVEN** (Stem Import). **F HUMAN-PROVEN** (Track/Chapter Groups collapse UI — create / assign / collapse / rename). **G HUMAN-PROVEN** (Volume Automation — VOL lane). **H HUMAN-PROVEN** (Write Volume **W** — Vite + Root-Exe `24f4337`). **I–N + zettel PLANNED / NOT IMPLEMENTED**. Four Chapters + bis 11 Suno-Stems × 4. Kein Cubase-Klon. VIS-Ausbau-Intent = K–N. Version 5.0.0. AUTO unangetastet. |

## ENC-01 — 1080p AVC encoder capability

**IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** on Windows WebView2 MODE B EXE tip `0ec7758` (PR **#18**). AFE remains closed.

| | |
| --- | --- |
| Cause | Export pinned `avc1.42001f` (Baseline / Level 3.1). Level 3.1 cannot legally encode 1920×1080. |
| Diff | `src/core/exporter/avc-capability.ts` probes `VideoEncoder.isConfigSupported` from the minimum H.264 level for width×height×fps upward (Baseline → Main → High). `webcodecs.ts` uses the selected AVC config. AFE decoder paths untouched. |
| Test | `tests/export/enc-01-avc-capability.test.ts` — 720p still prefers `avc1.42001f`; 1080p starts at Level 4.0 and escalates; no-support fails with `FAIL:` + `WebM is not a fallback`. |
| Result | 720p path unchanged when Level 3.1 is supported. 1080p no longer hardcodes Level 3.1-only. |
| Human (MODE B) | Operator EXE tip `0ec7758`: `C:\Users\marti\ailexsi-resonance-studio-v5.5\AILEXSI Resonance Studio V5.5.exe` SHA256 `0FA47C1E71975D0480699EA972F8897193A247A4061FDA83B2B72B61DFF35678`. Confirmed **1920×1080 H.264 @ 30 / 25 / 24 fps**. Screenshot (30 fps): `docs/enc-01-1080p-acceptance-2026-09-16.png` — Fertig `Untitled_Resonance.v2.mp4`, Frame Engine **AILEXSI**, **1920×1080 / 30 fps**, IN ~00:00.40 · OUT ~06:59.93. |

## Verification paths

| Mode | Name | What it is | What it may claim |
| --- | --- | --- | --- |
| **A** | **FAST / HUMAN ITERATION** | Vite `npm run web:dev` or `npx tauri dev` on `127.0.0.1:1421`. Agent/Chrome screenshots, layout iteration, automated tests. | **IMPLEMENTED** / **AUTOMATED-TESTED**. Never **HUMAN-PROVEN**. |
| **B** | **PRECISION / ACCEPTANCE** | Local standalone EXE (`npm run tauri:exe`) built from a **named SHA**. Operator drives Arrange / File / Export on Windows. Evidence: Task Manager process + in-app Export **Fertig** + status `Exported … bytes` + version chip 5.0.0. | Only the operator’s explicit EXE list is **HUMAN-PROVEN**. |

This 2026-09-13 pass is **MODE B**. Screenshot: Task Manager `AILEXSI Resonance Studio V5` + Export Fertig `Untitled_Resonance.v1.mp4` + status `Exported … bytes` + chip **5.0.0** + dynamic tracks/mixer visible. Details: `docs/ACCEPTANCE.md`.

## Production Pass (D + E + F + G + H HUMAN-PROVEN · I–N planned)

**D** is in App-Code and **HUMAN-PROVEN** in the accepted EXE (dynamic lanes + mixer resize/scroll/sync). **E Stem Import** is in App-Code and **HUMAN-PROVEN** in the accepted EXE (operator correction). **F Track/Chapter Groups** is in App-Code and **HUMAN-PROVEN** in EXE (operator: create / assign / collapse / rename). **G Volume Automation** is in App-Code and **HUMAN-PROVEN** in EXE (operator: VOL lane works well; Volume Automation accepted). **H Write Volume** is in App-Code and **HUMAN-PROVEN** in local Vite + Root-Exe tip `24f4337` (owner). I–N remain docs-only. AUTO unangetastet. Version bleibt **5.0.0**.

**Ziel:** vierteiliges Werk + bis 11 Suno-Stems × 4 Kapitel. Kein Cubase-Klon. **01** A Signal in the Dark · **02** The Living Seal · **03** Neverland: The Flight · **04** New Reality: Beyond the Code.

Älterer VIS-Ausbau-Intent ist hier in **K–N** aufgegangen — keine zweite Roadmap.

| ID | Item | Status |
| --- | --- | --- |
| D | Dynamic Audio Tracks — Kapazität 64, anlegen nach Bedarf, stabile IDs, A1/A2 rückwärtskompatibel; last-lane `+/−`; vertical lane scroll; mixer follows collection; horizontal mixer scroll; resizable mixer / workspace divider; track↔mixer sync | **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (EXE) |
| E | Stem Import — Multi-WAV Suno-Stems, gleicher Start, ZIP in-memory; Chapter `groupId` prefix maps into F groups | **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (EXE) |
| E+ | E refinements: Suno filename normalize; single-vs-multi placement polish (code already: 2+ same start / 1 appends) | **PLANNED** (do not implement here) |
| F | Track/Chapter Groups — Collapse nur UI, kein Group-Bus | **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (EXE) |
| G | Volume Automation — VOL-Lane, Punkte, linear; Clip-Gain ≠ Static Vol ≠ Automation | **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (EXE) |
| H | Write Automation **W** — Volume only während Playback; writes into G envelope | **IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (EXE `24f4337`) |
| I | 44-Track Acceptance — 4×11 | **PLANNED / NOT IMPLEMENTED** |
| J | Four Chapters — echte Produktion: **01** A Signal in the Dark · **02** The Living Seal · **03** Neverland: The Flight · **04** New Reality: Beyond the Code | **PLANNED / NOT IMPLEMENTED** |
| K | VIS Library — bestehende Szenen = feste **BASICS**-Gruppe; Klassifikation `basics` \| `audioReactive` | **PLANNED / NOT IMPLEMENTED** |
| L | Shared Modulation Bus — nur bestehende Features (Energy/Bass/Onset …); kein zweites Metronom | **PLANNED / NOT IMPLEMENTED** |
| M | Audio Reactive v1 — Image/Video: Bass→Scale, Energy→Exposure, Onset→Glow | **PLANNED / NOT IMPLEMENTED** |
| N | Späterer Ausbau nur aus nachgewiesenem Bedarf (Four Chapters) | **PLANNED / NOT IMPLEMENTED** |
| Zettel | Preview Zoom (preview pane, not timeline zoom) | **PLANNED / NOT IMPLEMENTED** |
| Zettel | Audio channel strip EQ / FX (mixer is volume / pan / mute / solo only) | **PLANNED / NOT IMPLEMENTED** |
| Zettel | Track / Mixer Channel Rename — one shared display name; inline edit from header or mixer | **PLANNED / NOT IMPLEMENTED** |
| Zettel | Track Color — one shared color from Timeline header and Mixer channel | **PLANNED / NOT IMPLEMENTED** |
| Zettel | Distribute Colors — sequential palette on a selection or Chapter group | **PLANNED / NOT IMPLEMENTED** |
| Zettel | Relink filename assist — picker should prefer the expected / last-known filename | **PLANNED / NOT IMPLEMENTED** (do not expand Relink UX in G) |

## F Evidence Report

**IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (EXE). Operator confirmed create / assign / collapse / rename. Feature tip `c4391cb` — this docs stamp is not the EXE SHA. MODE A on that tip: tsc 0; vitest **841 / 96**; vite build 5.0.0.

### Files

- `src/core/track-groups.ts` — group model, assign/rename, arrange rows, last-lane chrome host
- `src/core/models.ts` — `TrackGroup`; optional `Project.groups`; `Track.groupId` still membership
- `src/core/project.ts` — `groups: []` default; deserialize hydrates from `groups` + stem `groupId`
- `src/core/stem-import.ts` — prefix `groupId` upserts `Project.groups`
- `src/core/layout-prefs.ts` — `resonance-studio-v5-group-collapsed` (JSON id list)
- `src/app/commands.ts` / `src/app/session.ts` — `createTrackGroup` / `assignTracksToGroup` / `renameTrackGroup`
- `src/ui/timeline/Timeline.tsx` / `src/ui/mixer/Mixer.tsx` / `src/app/App.tsx` / `src/styles.css`
- Tests: `tests/core/track-groups.test.ts`, `tests/layout/track-groups.test.tsx`, layout-prefs + stem-import + zip-audio

### How to create / collapse a group

1. Select one or more audio lanes (or leave the last audio targeted).
2. Click **Grp** on the last audio header (next to `+/−`). Default name `Chapter N`. Or use the per-lane **—** dropdown → an existing group or **New group…**.
3. Stem import of files that share a prefix (`01_vocals.wav`, `01_drums.wav`) still writes `Track.groupId` and now also a `Project.groups` row (`id`/`name` = `01`). Rename the header to e.g. `Chapter IV — New Reality`.
4. Collapse: chevron on the Timeline group header **or** the Mixer group strip. Child lanes/channels hide. Expand restores the same rows.
5. `+/−` stay on the last **visible** audio lane; if that lane is inside a collapsed group, they move onto that group header.

### Persistence

| What | Where | Persist? |
| --- | --- | --- |
| Group id + display name + track membership (`Track.groupId`) | Project JSON (`schemaVersion` 5, `groups: []` default) | **Yes** (Speichern) |
| Collapse open/closed | `localStorage` key `resonance-studio-v5-group-collapsed` | **Yes** (layout-prefs, not the project file) |

Collapse does **not** change playback, mute/solo, volume, pan, routing, or export mix. No group bus / group FX / group mute.

## G Evidence Report

**IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (EXE). Operator: VOL lane works well; Volume Automation accepted. Feature tip `896b640` (VOL label, not V) — this docs stamp is not the G EXE SHA. Stacked on F tip `9afed5e`. Version **5.0.0**. AUTO unangetastet. MODE A on the feature tip: tsc exit 0; vitest **862 / 98**; vite build 5.0.0, 196 modules.

### What shipped

- Model: `Track.volumeAutomation = { enabled, points: [{ timeMs, value }] }` on audio tracks. Linear gain internally (1 = 0 dB). `schemaVersion` stays **5**. Missing field = identity (exact prior mix).
- Lane: per-track **VOL** toggle opens a Volume sub-lane (UI state in `resonance-studio-v5-volume-lane-open`). Clip-lane height is unchanged. Same project-time axis as clips (zoom / pan / Follow / scroll). Chapter collapse hides child automation with the tracks.
- Editing: click empty lane to create; drag H/V; Delete / double-click to remove. Linear interpolation only. Clamp / reject NaN / Infinity.
- Playback: `effective = clipGain × staticTrackVolume × automationValueAt(t)` (+ existing master / mute / fades). Empty or disabled = prior behavior. Points stay when disabled.
- Mixer: static fader stays static. Ghost + dB readout of `static × automation` while the envelope is active. No Write Automation.
- Undo: create / delete / completed move / enable = one history entry each (no spam while dragging).
- Save/Load / rename / group assign / missing+relink keep the track-owned envelope.

### Files

- `src/core/volume-automation.ts` — sanitize, interp, point edit, export remap/schedule
- `src/core/models.ts` / `src/core/project.ts` / `src/core/volume.ts` / `src/core/layout-prefs.ts`
- `src/core/exporter/job.ts` / `types.ts` / `audio.ts` — envelope rides after baked clip/static/master gain
- `src/ui/preview/Preview.tsx` / `src/core/visualz/playback-tap.ts` — live mix + short gain smoothing
- `src/ui/timeline/VolumeAutomationLane.tsx` / `Timeline.tsx` / `src/ui/mixer/Mixer.tsx` / `src/app/App.tsx` / `commands.ts` / `session.ts` / `src/styles.css`
- Tests: `tests/core/volume-automation.test.ts`, `tests/layout/volume-automation.test.tsx`, layout-prefs + mixer volume

### Persistence

| What | Where | Persist? |
| --- | --- | --- |
| `volumeAutomation.enabled` + points | Project JSON (`schemaVersion` 5) | **Yes** (Speichern) |
| Open/closed Volume sub-lane | `localStorage` `resonance-studio-v5-volume-lane-open` | **Yes** (layout-prefs, not the project file) |

### Human acceptance (MODE B — operator EXE PASS)

Operator accepted G in the local EXE from feature tip `896b640`. Checklist that passed:

1. Import a WAV onto an audio track (or stem-import).
2. Click **VOL** on that audio header — Volume sub-lane opens under the clips; other tracks stay single-height.
3. Click the lane to create points; drag horizontally (time) and vertically (volume). Readout in dB; 0 dB is the faint unity line.
4. Draw a fade (e.g. 0 dB → −∞ or −12 dB). Play — audible level follows the envelope.
5. Mixer: static fader stays where you left it; ghost / cyan readout follows the envelope. Moving the static fader still changes overall level (automation is a separate multiplier).
6. Collapse the Chapter group that contains the track — child lane + envelope hide; playback does not change. Expand restores.
7. Speichern / reopen — points and enabled state return. Optional: Relink missing media — envelope stays on the track.
8. Confirm D (add/remove audio + mixer resize), E (stem import), F (create/assign/collapse/rename groups) still work.

STOP — no I / EQ / FX / Pan automation / Chapter bus / mixer redesign / second automation engine.

## H Evidence Report

**IMPLEMENTED / AUTOMATED-TESTED / HUMAN-PROVEN** (local Vite + Root-Exe). Owner confirmed tip `24f4337`. Writes into the existing G model only. Stacked on G tip `9099f6a` (PR #18 docs stamp of HUMAN-PROVEN G). Version **5.0.0**. AUTO unangetastet. W is session chrome — defaults **OFF** on New / Open / reopen. Envelope data persists; arm does not. MODE A on the EXE tip: tsc exit 0; vitest **906 / 101**; vite build 5.0.0, 197 modules. Bare **W** arms Write; **Alt+W** ripple-trims out. Write is buffered (live gain, punch at gesture end). Space stays transport except in real text fields. Ruler stays readable on a short Arrange (flex-fixed 26px). VOL sub-lane header is a two-row pack.

### What shipped

- Compact per-track **W** next to M / S / VOL (Timeline + Mixer). Audio tracks only. Independent arm per track. No gang write. No Touch / Latch / Trim. Bare keyboard **W** is the same arm (focused/selected audio track; no-op if none). It does **not** ripple-trim. Ripple trim out is **Alt+W**. Split **S** and **Ctrl+X** unchanged.
- W OFF: fader = static `Track.volume`. G plays normally. No overwrite of automation.
- W ON alone, opening VOL, selecting a track, or playback without a fader move = **no points**.
- W ON + forward playback + meaningful fader movement → lightweight in-memory gesture buffer at `project.playheadMs`. Live fader value feeds audible gain immediately. **No** project / history / G punch per pointer event.
- Gesture end (idle / pointer-up / STOP / PAUSE / SEEK) simplifies once and punches into `Track.volumeAutomation = { enabled, points: [{ timeMs, value }] }`. One undo per gesture.
- After the gesture: ordinary G points. Edit on the existing VOL lane. Immediate playback via existing G (live write during the gesture; clean handoff at commit).
- Static vs automation unchanged: `effective = clipGain × staticTrackVolume × automationValueAt(t)` (live write value replaces automation for that track while the gesture is open). Arming W does not permanently overwrite static.
- Space play/pauses with normal UI focus, including after mixer fader / W / VOL chrome. Real text/number fields still swallow Space.
- First armed fader move (the EXE 1565c2c failure boundary): does **not** punch G, clone `project.tracks`, push history, or rebind/seek media. Live write is a session buffer + Preview `setGains` only. Mixer range blurs on pointerdown; Space is handled in capture so the focused fader cannot swallow it.
- Short Arrange must not crush the time ruler. Tools + ruler are flex-fixed (26px ruler); locked H lanes scroll inside `.timeline-lanes`.
- VOL sub-lane header packs title + close on one row and On + dB on the next (48px height unchanged). M/S/W/VOL chip row uses a 3px gap.

### Fader ↔ automation mapping

- Mixer fader range is the G range: **+6 … −∞ dB**; linear = `10^(dB/20)`; **1 = 0 dB**.
- W OFF, or W ON without an active write gesture: fader reads/writes **static** `Track.volume`.
- During an active write gesture: fader linear **is** the live write value (same G automation range). It is not punched into the project until the gesture ends.
- If static is not 0 dB, effective ≠ fader (G mixer still shows static vs effective).
- After the gesture the fader returns to static; ghost / cyan readout follow the persisted envelope.

### Write session / punch

- Gesture starts on the first meaningful fader move (`WRITE_MEANINGFUL_DB` 0.35 dB or `WRITE_MEANINGFUL_LINEAR` 0.02) while W ON + playing.
- Stop moving → commit after `WRITE_IDLE_END_MS` 280 ms (pointer-up may use `WRITE_POINTER_UP_MS` 80 ms). Later movement = a new gesture / new undo.
- STOP / PAUSE / SEEK / reverse shuttle / disarm W / remove that track → clean terminate (commit if samples exist).
- PAUSE: no writing while time is stationary. SEEK alone invents no point at the destination.
- Loop wrap uses real project time (playhead jump backward ends the gesture). No hidden monotonic write clock.
- Punch replaces only `[firstWritten, lastWritten]`. Points strictly before/after stay. Empty identity envelopes get a 1 ms hold of the **prior** value (unity) before t0 **and after t1** so a write cannot silence the rest of the song (G hold-after-last would otherwise keep the last written gain forever).

### Simplification thresholds (deterministic)

| Constant | Value | Role |
| --- | --- | --- |
| `WRITE_MEANINGFUL_DB` / `WRITE_MEANINGFUL_LINEAR` | 0.35 dB / 0.02 | Start a gesture |
| `WRITE_MIN_LINEAR_DELTA` / `WRITE_MIN_DB_DELTA` | 0.015 / 0.3 dB | Drop flat-run interiors |
| `WRITE_RDP_EPSILON` | 0.02 | Ramer–Douglas–Peucker in (seconds, linear gain) |
| `WRITE_PEAK_LINEAR` | 0.02 | Re-keep local extrema |
| `WRITE_IDENTITY_HOLD_MS` | 1 | Unity hold before first punch on an empty envelope |
| `WRITE_LOOP_WRAP_MS` | 80 | Treat a backward jump as a loop wrap |
| `WRITE_CAPTURE_MIN_MS` | 40 | Minimum playhead gap to store another raw sample (live value still updates) |
| `WRITE_IDLE_END_MS` / `WRITE_POINTER_UP_MS` | 280 / 80 | Gesture boundary |

Duplicate timestamps: last sample wins. Invalid (NaN / Infinity / negative time) samples are dropped; existing envelopes are never wiped as recovery.

### Files

- `src/core/volume-write.ts` — capture, coalesce/simplify, punch into G (commit only)
- `src/app/session.ts` / `src/app/commands.ts` / `src/app/keys.ts` / `src/app/screens.ts` / `src/app/App.tsx`
- `src/ui/mixer/Mixer.tsx` / `src/ui/timeline/Timeline.tsx` / `src/ui/preview/Preview.tsx` / `src/ui/shortcuts/labels.ts` / `src/styles.css`
- Tests: `tests/core/volume-write.test.ts`, `tests/app/write-runtime.test.ts`, W chrome in `tests/layout/volume-automation.test.tsx`, shortcut dispatch in `tests/app/keys.test.ts`

### Persistence

| What | Where | Persist? |
| --- | --- | --- |
| Written points (`volumeAutomation`) | Project JSON (`schemaVersion` 5) | **Yes** (Speichern) — same as G |
| W armed | Session only | **No** — defaults OFF on reopen |

### Human acceptance (MODE B — owner Vite + Root-Exe PASS)

Owner confirmed H on tip `24f4337` (local Vite + Root-Exe). This docs stamp records that SHA. Proven on that tip: Write Volume **W**, short-Arrange ruler (flex-shrink pin), VOL header polish, write-buffer + Space/first-move harden. Checklist that passed:

1. Import a WAV onto an audio track (or stem-import). Confirm D / E / F / G still behave as proven.
2. Arm **W** on that track. Do not play. Move the mixer fader — only static volume changes; VOL lane gains no points.
3. Disarm, play, move the fader — still static only.
4. Arm **W**, play, do not touch the fader — no new points.
5. Arm **W**, play, move that track's fader — points appear on the existing G envelope at the playhead times. Other tracks unchanged.
6. Stop writing (release / idle). Play again — audible level follows the written G curve immediately (no restart-only delay).
7. Open **VOL** and edit a written point with the existing G lane (drag / delete).
8. Mixer: W looks armed while on. After the gesture, fader is static again; ghost / cyan readout is effective (`static × automation`). Example language from G still holds (e.g. static +2.3 dB / effective −5.2 dB).
9. Punch into an existing curve — region under the write changes; before/after points remain.
10. STOP during a write — gesture ends; points stay. PAUSE — no further writing until play. SEEK — no fake point at the seek time. Loop ON — wrap does not draw a line backward across the timeline.
11. Undo once — the whole write gesture disappears. Redo restores it.
12. Speichern / reopen — points return; **W is off**.
13. Repeat write on A3+ (dynamic track). Collapse the Chapter group — lanes hide; playback / envelope values do not change.
14. Confirm Speichern / `.vN` / Export `.vN` / mixer resize / AUTO still as before.
15. Keyboard **W** arms/disarms Write on the selected audio track (same as the W button) and must **not** shorten the song. **Alt+W** still ripple-trims out to playhead. **S** and **Ctrl+X** unchanged.
16. **W + play + 10–20s continuous fader move** stays smooth (no audio stutter). Space pause/resume works before, during, and after Write. Curve appears after the gesture; one Undo removes it.

STOP — no Touch/Latch/Trim, no Pan/EQ/FX/VST/MIDI, no Chapter bus, no mixer redesign, no second engine, no I+.

## Future UI (zettel — production-adjacent, not next slice)

**PLANNED / NOT IMPLEMENTED.** Not HUMAN-PROVEN. Not Production Pass I. Do not implement in this H pass.

`Track.name` already exists as the lane/mixer label (defaults A1…; stem import may write a filename). There is **no** inline rename UI, **no** track color property, **no** Distribute Colors. Project rename and marker rename are unrelated.

### Track / Mixer Channel Rename

A track can be renamed from either representation:

- Timeline track header → click / double-click name → inline edit
- Mixer channel label → click / double-click name → inline edit
- Enter = confirm, Esc = cancel

Both edit the **same** underlying track display name (`Track.name`). Never duplicated state.

Example: internal id stays `A12` (stable). Display name `Lead Vocals`. Rename in Timeline A12→Lead Vocals → Mixer shows Lead Vocals immediately. Rename in Mixer Lead Vocals→Lead Vox → Timeline shows Lead Vox immediately.

Rules:

- one shared display name
- internal track ID remains stable (legacy `A1`/`A2`, generated `a_*`, labels A3…)
- rename must not affect routing, clips, automation, or grouping
- name persists through save / load

### Track Color

Color assignable from Timeline track header **and** Mixer channel; both modify the same track color property.

Reflected consistently in: Timeline track, audio clips, Mixer channel, volume automation lanes.

### Distribute Colors

For a selected set of tracks or a Chapter group (F):

- Distribute Colors
- assign palette colors sequentially
- same colors appear in Timeline + Mixer
- individual colors remain editable afterwards
- persists through save / load
