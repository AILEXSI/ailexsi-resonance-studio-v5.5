# V5.5 tests

Vitest under `tests/`. AFE-10 MODE A: **1054 passed / 127 files** (vitest 3.2.7). AFE-09: **1044 / 126**. AFE-08: **1037 / 125**. AFE-07: **1028 / 124**. AFE-05: **1005 / 121**. Last full count on the accepted EXE SHA `234a781` (PR #15): **831 passed / 94 files**. F branch: **841 passed / 96 files**. G branch: **862 passed / 98 files**. H tip MODE A: **887 passed / 99 files**. Test count ≠ HUMAN-PROVEN.

Suites by area:

- foundation / models
- media (import, still, user-fixtures from `tests/fixtures/` only — not `public/`, **stem-import**, **zip-audio**)
- timeline (edit, zoom, markers, clip preview)
- persistence (project-file, last-project, Speichern vs Speichern unter + Tauri `lastPath`)
- preview / playback
- export (dialog, destination, aac-mux, filename-version / export-name `.vN`, AFE CTTS/B-frame)
- visualizer
- mixer / volume
- layout (**dynamic-audio-lanes**, **mixer-resize**, **track-groups**, **volume-automation**)
- core (**audio-tracks**, **track-groups**, **volume-automation**, **volume-write**)
- app (commands, keys, close-gap, ripple, duplicate, relink)

MODE A: `npm test` / `npx tsc --noEmit`. MODE B HUMAN-PROVEN is operator EXE only — see `docs/ACCEPTANCE.md`.
