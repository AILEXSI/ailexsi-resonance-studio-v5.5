# AI-0 Phase 1 — V5.6 Version + Repository Freeze

**Recorded before any AI-0 documentation commits.**  
**Date:** 2026-09-18  
**Principle:** FACT → EVIDENCE → CONTRACT → GAP → DECISION

This freeze is the implementation baseline for AI Director + MCP.  
**V5.6 replaces V5.5 as the implementation baseline.** This is not a V6 rewrite.

---

## Snapshot (working tree clean, no AI-0 files yet)

| Field | Value | Evidence |
| --- | --- | --- |
| Branch at freeze | `cursor/ai-0-recon-architecture-freeze-45e4` created from detached `HEAD` | `git checkout -b` |
| Parent / starting ref | `35b6503cfced27e9a5908a97154dca6693fdc424` | `git rev-parse HEAD` before docs |
| Subject | `Merge pull request #35 from AILEXSI/cursor/ui-responsive-track-headers-6a5d` | `git log -1` |
| Working tree | clean | `git status --porcelain` empty |
| Product version | **5.6.0** | `src/core/build-info.ts` `AILEXSI_PRODUCT_VERSION` |
| npm package | `@ailexsi/resonance-studio-v5.5` **5.6.0** | `package.json` |
| Tauri productName | `AILEXSI Resonance Studio V5.6` | `src-tauri/tauri.conf.json` |
| Tauri version | **5.6.0** | `src-tauri/tauri.conf.json` `version` |
| Tauri identifier | `com.ailexsi.resonance-studio-v5-5` | `src-tauri/tauri.conf.json` |
| Cargo package | `ailexsi-resonance-studio-v5-5` **5.6.0** | `src-tauri/Cargo.toml` |
| JSON schema | `schemaVersion: 5` | `src/core/models.ts` `Project.schemaVersion`; `src/core/project.ts` `PROJECT_SCHEMA_VERSION` |
| Toolbar chip | `V5.6.0` | `README.md`, `CURRENT.md` |
| Tag `v5.6.0` | **Not present in this checkout** | `git tag -l` empty. Product metadata + `docs/V5.6-RELEASE.md` still declare V5.6 HUMAN-PROVEN at this SHA. |
| PRE-AI / not V6 | Explicit | `CURRENT.md`, `docs/V5.6-RELEASE.md` |

## V5.6 baseline confirmation

**FACT:** This SHA is the V5.6 HUMAN-PROVEN release tip on `main` (PR #35 merge).

**EVIDENCE:**

- `README.md`: “AILEXSI Resonance Studio V5.6 / Version **5.6.0**”
- `CURRENT.md`: “**V5.6** = V5.5 media baseline + LEXI FLOW … **HUMAN-PROVEN** 2026-09-18. PRE-AI. Not V6.”
- `docs/V5.6-RELEASE.md`: “Version **5.6.0**. … PRE-AI. **Not V6.** … No AI/MCP product surface.”

**DECISION:** All later AI work treats `35b6503cfced27e9a5908a97154dca6693fdc424` as the proven core. If architecture spec v0.2 names V5.5, substitute V5.6. Do not silently rebuild media/export/AFE.

## Test / build status (Phase 18, this branch)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| Focused editor/history/layout | 186 / 186 passed |
| Full `vitest run` | 1389 passed / 6 failed / 1395 (same pre-existing AFE-15 dump-ban ×2 + STRESS-03 missing clip ×4 as `CURRENT.md`) |
| `npx vite build` | OK |

See `AI_0_RECON_REPORT.md` §18.

## Identity leftovers (not a version downgrade)

These names still say “v5.5” / “v5-5” by design (storage isolation from original V5):

- npm name `@ailexsi/resonance-studio-v5.5`
- Tauri / Cargo identifier `com.ailexsi.resonance-studio-v5-5`
- localStorage / IndexedDB prefix `resonance-studio-v5-5*`

**GAP:** Cosmetic naming ≠ product version. AI metadata must not write into these keys as if they were secrets or project files.
