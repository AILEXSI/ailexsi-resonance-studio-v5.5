# Software Bill of Materials (engineering inventory)

This is an **engineering dependency inventory**. It is **not** a legal compliance certificate, license opinion, commercial clearance, or distribution approval.

V5.5 bootstrap. Source lineage: V5 AFE-03 `4e80162`. Mediabunny is **absent**.

Generated: 2026-09-15 (UTC).

## Files

| File | Ecosystem | Format |
| --- | --- | --- |
| `docs/compliance/sbom-npm.cdx.json` | npm / JS / TS | CycloneDX JSON 1.6 |
| `docs/compliance/sbom-cargo.cdx.json` | Cargo / Rust / Tauri | CycloneDX JSON 1.7 |
| `docs/compliance/LICENSE-INVENTORY.md` | both | engineering classification only |

No SPDX JSON was generated. No `LICENSE` / `THIRD_PARTY_NOTICES`. This product does **not** claim MPL FREE.

## npm (`sbom-npm.cdx.json`)

- Source lockfile: `package-lock.json` (lockfileVersion 3) after Mediabunny removal.
- Tool: `@cyclonedx/cyclonedx-npm@4.1.2` via `npx --yes` (not an application dependency).
- Command:

```
NODE_ENV= npx --yes @cyclonedx/cyclonedx-npm@4.1.2 \
  --ignore-npm-errors \
  --output-reproducible \
  --spec-version 1.6 \
  --output-format JSON \
  --output-file docs/compliance/sbom-npm.cdx.json \
  --validate \
  package.json
```

- Metadata component: `resonance-studio-v5.5` **5.5.0** (`@ailexsi/resonance-studio-v5.5`).
- Component count: **144** library components. **mediabunny is not present.**
- Direct runtime (`package.json` `dependencies`): `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`, `react`, `react-dom`.

## Cargo (`sbom-cargo.cdx.json`)

- Source lockfile: `src-tauri/Cargo.lock` (crate graph unchanged from V5 AFE-03 except workspace name/version).
- Workspace crate: `ailexsi-resonance-studio-v5-5` **5.5.0**.
- Syft was **not** available on this Linux bootstrap host. This file is the V5 lock catalog with V5.5 identity overlay (name/version/CPE). Crate set is the same as V5 AFE-03.
- Direct runtime crates: `tauri`, `tauri-plugin-fs`, `tauri-plugin-dialog`, `serde`, `serde_json`.
- Direct build crate: `tauri-build`.
- Workspace `license` field is empty.

## Known limitations

- Not a legal review.
- npm CycloneDX `scope` is incomplete (dev vs runtime must be read from `package.json` / inventory).
- Cargo CycloneDX was not freshly Syft-scanned on this host.
- Application product license is **not** chosen. No `LICENSE` / `THIRD_PARTY_NOTICES`.
- Does **not** claim MPL FREE.
