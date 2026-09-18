# SECRET STORAGE CONTRACT v0.1

**Status:** Docs only. No credential plugin, Settings UI, or provider keys in AI-0.  
**Baseline:** Resonance Studio V5.6 @ `35b6503cfced27e9a5908a97154dca6693fdc424`  
**Law:** LAW-11 — Secrets never enter project data.

---

## FACT — current storage

| Store | What lives there | Evidence |
| --- | --- | --- |
| Project `.resonance.json` | `Project` including playhead, mixer, clips, VIS | `serializeProject` `src/core/project.ts` |
| IndexedDB `resonance-studio-v5-5` | Media blobs | `DB_NAME` `src/core/persistence.ts` |
| IndexedDB `resonance-studio-v5-5-project-file` | File-handle memory, recents, export names | `src/core/project-file-store.ts` |
| localStorage `resonance-studio-v5-5*` | Layout chrome | `src/core/layout-prefs.ts` |
| localStorage `ailexsi.vis-browser-pos` | VIS overlay position | `src/ui/inspector/vis-browser-layout.ts` |
| Tauri AppData `last-project.json` | Last path + name (string path, not FileHandle) | `src/core/last-project.ts`, `src-tauri/src/lib.rs` |
| OS credential store | **None** | No keychain / stronghold / password plugin |
| Settings panel | **None** | No Settings route or AI prefs tree |

## FACT — Tauri capability surface

`src-tauri/capabilities/default.json`:

- `core:default`
- `dialog:allow-open` / `dialog:allow-save`
- `fs:allow-read-text-file` / `write-text-file` / `read-file` / `exists` / `mkdir`
- `fs:scope` limited to `$APPDATA` and descendants

`src-tauri/Cargo.toml` plugins: `tauri-plugin-fs`, `tauri-plugin-dialog` only.

Rust commands: `allow_media_paths` plus autostart whitelist of remembered project + asset `sourcePath`s (`src-tauri/src/lib.rs`).

**GAP:** No secret-capable permission. Future key storage must add a dedicated plugin + capability, not reuse `$APPDATA` plaintext JSON.

---

## CONTRACT — what must never be stored where

| Material | Project JSON | Layout localStorage | IDB blobs | last-project.json | Logs / stall dumps / export-fail | Audit log | Git |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Provider API keys / tokens | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | redacted | FORBIDDEN |
| Local runtime auth headers | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | redacted | FORBIDDEN |
| Provider session objects | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN | FORBIDDEN |
| Raw user conversation if classified private | do not mix into Project | n/a | separate store later | n/a | redacted | optional redact | FORBIDDEN |
| Project media / timeline | allowed (existing) | no | blobs allowed | path only | build identity only | no media | user repo only |

`withBuildIdentityPrefix` / stall dumps already front-load `productVersion` / `gitSha` (`src/core/build-info.ts`). They must never gain API keys.

---

## CONTRACT — future API key storage (AI-2+, not implemented)

**DECISION (ADR-004):** Use OS-protected credential storage via a Tauri plugin when Resonance runs as MODE B EXE. Browser / MODE A has no OS keychain — cloud keys are unsupported or session-memory-only until a host exists.

Required properties:

1. Service name scoped to `com.ailexsi.resonance-studio-v5-5` (existing identifier) + provider id.
2. Key material never copied into `Project`, `Session.status`, `Session.error`, or conversation markdown.
3. `testConnection()` may report `AUTH_FAILED` without echoing the secret.
4. Wipe on provider removal.
5. Fail closed if the plugin is missing: treat as `DISCONNECTED`, do not fall back to plaintext prefs.

Forbidden fallbacks:

- `localStorage` plaintext
- `resonance-studio-v5-5*` layout keys
- project `.vN.resonance.json`
- `last-project.json`
- environment variables baked into the Vite bundle

---

## CONTRACT — AI conversation persistence (deferred)

Canonical conversation belongs to Resonance (LAW-10). When implemented:

- Store beside, not inside, `Project` (MIG-09).
- Older projects must open with AI disabled (MIG-08).
- No provider proprietary session blob as source of truth.
