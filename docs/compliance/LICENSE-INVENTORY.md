# License inventory (engineering classification)

Input: resolved `package-lock.json` + installed `node_modules` package.json fields, and `cargo metadata --locked` crate `license` fields after the Cargo plugin lock fix.

This is **not** a legal conclusion, THIRD_PARTY_NOTICES draft, or clearance.

Classes used here:

| Class | Meaning in this pass |
| --- | --- |
| GREEN | Declared MIT, Apache-2.0, BSD-2/3, ISC, Zlib, 0BSD, MIT-0, CC0, Unlicense, LLVM-exception, or an **OR** of those. |
| YELLOW | MPL-2.0, Unicode-3.0, CC-BY, **AND** expressions, missing/unknown, or unusual/custom. |
| RED | Only if independently verified as a problem. **None verified in this pass.** |
| UNKNOWN | Insufficient metadata. |

## Special attention

| Component | Resolved | Ecosystem | Declared license | Class | Notes |
| --- | --- | --- | --- | --- | --- |
| mediabunny | — | removed in V5.5 | — | — | **ABSENT.** Historical V5 runtime only. Not in `package.json`, lock, `src/`, or `dist/`. This product does **not** claim MPL FREE. |
| @tauri-apps/plugin-fs | 2.5.2 | npm runtime | MIT OR Apache-2.0 | GREEN | Matches Rust crate 2.5.2. |
| @tauri-apps/plugin-dialog | 2.7.3 | npm runtime | MIT OR Apache-2.0 | GREEN | Matches Rust crate 2.7.3. |
| tauri-plugin-fs | 2.5.2 | Cargo direct | Apache-2.0 OR MIT | GREEN | Used in `src-tauri/src/lib.rs` (`tauri_plugin_fs::init`, `FsExt`). |
| tauri-plugin-dialog | 2.7.3 | Cargo direct | Apache-2.0 OR MIT | GREEN | Used in `src-tauri/src/lib.rs` (`tauri_plugin_dialog::init`). Depends on `tauri-plugin-fs`. |
| react / react-dom | 19.2.8 | npm runtime | MIT | GREEN | `node_modules/react/package.json`, `node_modules/react-dom/package.json`. |
| tauri | 2.11.5 | Cargo direct | Apache-2.0 OR MIT | GREEN | |
| tao | 0.35.3 | Cargo transitive | Apache-2.0 | GREEN | Path: `tao` → `tauri-runtime-wry` → `tauri`. Present on `--target x86_64-pc-windows-msvc` tree. |
| wry | 0.55.1 | Cargo transitive | Apache-2.0 OR MIT | GREEN | Same path as tao. Windows app webview host. |
| brotli | 8.0.4 | Cargo transitive | BSD-3-Clause **AND** MIT | YELLOW | AND expression. Path: `tauri-codegen` / `tauri-utils`. |
| unicode-ident | 1.0.24 | Cargo transitive | (MIT OR Apache-2.0) **AND** Unicode-3.0 | YELLOW | AND + Unicode-3.0. Proc-macro stack (`syn` / `quote`). |
| icu_* (7 crates) | 2.3.0 / 2.3.1 | Cargo transitive | Unicode-3.0 | YELLOW | `icu_collections`, `icu_locale_core`, `icu_normalizer`, `icu_normalizer_data`, `icu_properties`, `icu_properties_data`, `icu_provider`. Typical `idna` / URL stack. |
| Rust MPL crates | see below | Cargo transitive | MPL-2.0 | YELLOW | See next section. |
| caniuse-lite | 1.0.30001810 | npm transitive (dev/build) | CC-BY-4.0 | YELLOW | Via Vite / browserslist. Not a runtime `package.json` dependency. |

## Rust MPL-2.0 components

All five appear on the default tree **and** on `--target x86_64-pc-windows-msvc` via `tauri-utils` / `tauri` (Windows app path). This pass did not compile a Windows EXE here; the lockfile + `cargo tree --target` is the evidence.

| Crate | Version | Path (abbreviated) |
| --- | --- | --- |
| cssparser | 0.36.0 | cssparser → dom_query → tauri-utils → tauri / tauri-build / tauri-plugin |
| cssparser-macros | 0.6.1 | proc-macro of cssparser |
| dtoa-short | 0.3.5 | dtoa-short → cssparser → (same as above) |
| selectors | 0.36.1 | selectors → dom_query → tauri-utils |
| option-ext | 0.2.0 | option-ext → dirs-sys → dirs → tauri / wry |

Whether each crate’s object code is **linked into** the Windows EXE vs used only at build time is not fully separated here. `cssparser` / `selectors` / `option-ext` sit under runtime crates (`tauri-utils`, `dirs`, `wry`). `cssparser-macros` is a proc-macro (build-time). Treat compiled-in vs build-only as **not fully proven** beyond this tree.

## npm summary

Direct **runtime** (`package.json` `dependencies`), resolved by `npm ci`:

| Package | Resolved | Declared | Class |
| --- | --- | --- | --- |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT | GREEN |
| @tauri-apps/plugin-dialog | 2.7.3 | MIT OR Apache-2.0 | GREEN |
| @tauri-apps/plugin-fs | 2.5.2 | MIT OR Apache-2.0 | GREEN |
| react | 19.2.8 | MIT | GREEN |
| react-dom | 19.2.8 | MIT | GREEN |

Direct **dev**: `@tauri-apps/cli` 2.11.0 (Apache-2.0 OR MIT), `@types/react` 19.2.18 (MIT), `@types/react-dom` 19.2.5 (MIT), `@vitejs/plugin-react` 5.2.0 (MIT), `jsdom` 26.1.0 (MIT), `typescript` 5.9.3 (Apache-2.0), `vite` 7.3.6 (MIT), `vitest` 3.2.7 (MIT).

cyclonedx-npm reported **147** components, **0** missing license fields. Unusual declared IDs: **MPL-2.0** (mediabunny), **CC-BY-4.0** (caniuse-lite). Remainder GREEN (MIT / ISC / Apache-2.0 / BSD / MIT-0 / Apache-2.0 OR MIT).

## Cargo summary

| Declared expression (from crate metadata) | Count | Class |
| --- | --- | --- |
| MIT OR Apache-2.0 / Apache-2.0 OR MIT / MIT/Apache-2.0 / Apache-2.0/MIT / Apache-2.0 / MIT / slash variants | majority | GREEN |
| Zlib OR Apache-2.0 OR MIT; MIT OR Zlib OR Apache-2.0; Unlicense OR MIT; 0BSD OR …; CC0-1.0 OR MIT-0 OR Apache-2.0; ISC; BSD-3-Clause; BSD-3-Clause/MIT; Apache-2.0 WITH LLVM-exception (OR MIT) | several | GREEN |
| Unicode-3.0 | 18 | YELLOW |
| MPL-2.0 | 5 | YELLOW |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 | YELLOW |
| BSD-3-Clause AND MIT (brotli) | 1 | YELLOW |
| Apache-2.0 AND MIT | 1 | YELLOW |
| MIT OR Apache-2.0 OR LGPL-2.1-or-later | 2 | GREEN* |
| workspace `ailexsi-resonance-studio-v5-5` 5.5.0 | 1 | UNKNOWN |

\* OR includes MIT/Apache-2.0, so classified GREEN as a choosable permissive option. The LGPL alternative was **not** selected or analyzed.

No RED items verified.

## UNKNOWN license metadata

- **Application crate / npm package itself:** no product `LICENSE` file; Cargo workspace `license` field empty. Out of scope for this engineering pass (do not draft the AILEXSI license here).
- **Secondary-license compatibility of mediabunny:** standard MPL-2.0 text includes an Exhibit B template; this pass did **not** find an attached “Incompatible With Secondary Licenses” notice on installed mediabunny sources. Still not a legal determination.
- **Which dual-license alternative applies** for every OR crate/package: UNKNOWN (not chosen).
- **Exact Windows link-in of each MPL crate:** tree says they are on the Windows target graph; object-code inclusion is not fully proven without a Windows link map.

## Explicitly not done

- No `LICENSE` created.
- No `THIRD_PARTY_NOTICES` created.
- Licensing is **not HUMAN-PROVEN**.
