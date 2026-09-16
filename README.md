# AILEXSI Resonance Studio V5.5

Version **5.5.0**. Product chip **`V5.5.0`**. JSON `schemaVersion` **5**.

First-party Frame Engine. Mediabunny-free. Source lineage: V5 AFE-03 `4e80162` working tree (no V5 git history, V5 repo not modified, PR #23/#24/#25 not merged).

One-look table: `CURRENT.md`. Bootstrap: `docs/V5.5-BOOTSTRAP.md`. Human acceptance: `docs/V5.5-HUMAN-ACCEPTANCE.md`.

## What this is

Local-first arrange / cutter / mixer / export. Export is H.264 MP4 via WebCodecs. **Frame Engine: AILEXSI** only. Preview may use HTMLVideo. Export does not fall back to HTMLVideo.

Preserved from V5: D dynamic audio, E stem import, F track/chapter groups, G volume automation, H write volume, transport, VIS, mixer, save/export `.vN`, AFE-03 decode optimizations.

No new features in this bootstrap. **ENC-01** selects an H.264 level/profile the platform supports (720p keeps `avc1.42001f` when legal). **1080p Windows export is still the open human test** — do not mark it HUMAN-PROVEN from automated selection tests.

## Start

Dev (MODE A — browser or Tauri webview, port 1421):

```
npm run web:dev
```

or

```
npx tauri dev
```

Windows (operator machine):

```
INSTALL_BUILD_RUN_V5.5.cmd
BUILD_AND_RUN_V5.5.cmd
```

Standalone EXE (MODE B, Windows):

```
npm run tauri:exe
```

Copies `AILEXSI Resonance Studio V5.5.exe` to the repo root when the Windows toolchain is present.

## Top bar

`File | Import | Export | [ARRANGE] | [CUTTER]` plus permanent top-right **`V5.5.0`**.

Export dialog shows **`Frame Engine: AILEXSI`** from `getFrameSourceBackend()`.

## Storage

Separate from V5: `resonance-studio-v5-5*` keys and Tauri identifier `com.ailexsi.resonance-studio-v5-5`.

## Compliance

Engineering SBOMs: `docs/compliance/`. No `LICENSE` / `THIRD_PARTY_NOTICES`. This product does **not** claim MPL FREE.

Historical V5 evidence (`V5-EVIDENCE.md`, `docs/ACCEPTANCE.md`) is labelled historical.

App icon: **愛** — Tauri icons in `src-tauri/icons/`. Icons nicht anfassen.
