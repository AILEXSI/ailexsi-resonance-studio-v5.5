# ADR-004 — Secure credential storage

**Status:** Accepted direction for AI-2+ (not implemented in AI-0)  
**Date:** 2026-09-18  
**Baseline:** V5.6 @ `35b6503`

## Context

No Settings UI. No OS credential API. Tauri plugins are `fs` + `dialog`. Capabilities scope `$APPDATA` for project autostart, not secrets.

LAW-11 forbids keys in project files, normal logs, prompts, diagnostics, or Git.

## Decision

1. **AI-0 / AI-1:** no keys, no Settings AI page, no plaintext placeholder files.
2. **AI-2 (first provider chat):** introduce a credential port:

   ```ts
   interface SecretStore {
     get(providerId: string): Promise<string | null>;
     set(providerId: string, secret: string): Promise<void>;
     delete(providerId: string): Promise<void>;
   }
   ```

3. **MODE B (Tauri EXE):** implement `SecretStore` with an OS credential plugin (Windows Credential Manager / macOS Keychain / libsecret). Add an explicit Tauri capability. Do not store secrets via `tauri-plugin-fs` under `$APPDATA`.
4. **MODE A (browser Vite):** no durable cloud keys. Memory-only for a session, or refuse cloud providers. Local OpenAI-compatible endpoints may use a non-secret URL in preferences (not a key).
5. Preferences that are **not** secrets (provider id, model id, endpoint URL, privacy mode) may later live in a dedicated `resonance-studio-v5-5-ai-prefs` localStorage key or AppData JSON **without** secret fields.

See `SECRET_STORAGE_CONTRACT_v0.1.md`.

## Rejected alternatives

- Put keys in `last-project.json` or project JSON: violates LAW-11 and would roam with projects.
- Vite `import.meta.env` baked keys: land in `dist/` and the EXE.
- Reuse `$APPDATA` text files: readable, copied by backups, appear in support zips.
