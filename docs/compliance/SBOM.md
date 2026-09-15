# Software Bill of Materials (engineering inventory)

This is an **engineering dependency inventory**. It is **not** a legal compliance certificate, license opinion, commercial clearance, or distribution approval.

Inspected base: `26f4d42f3fa8548d8fd8bf761c2e05fed3333d17` (`origin/main` after PR #20).  
This pass also updates `src-tauri/Cargo.lock` so declared Tauri plugins match the lockfile.

Generated: 2026-09-15 (UTC).

## Files

| File | Ecosystem | Format |
| --- | --- | --- |
| `docs/compliance/sbom-npm.cdx.json` | npm / JS / TS | CycloneDX JSON 1.6 |
| `docs/compliance/sbom-cargo.cdx.json` | Cargo / Rust / Tauri | CycloneDX JSON 1.7 |
| `docs/compliance/LICENSE-INVENTORY.md` | both | engineering classification only |

No SPDX JSON was generated. CycloneDX covers both ecosystems as separate BOMs.

## What each SBOM covers

### npm (`sbom-npm.cdx.json`)

- Source lockfile: `package-lock.json` (lockfileVersion 3).
- Installed tree: `node_modules` after `npm ci --ignore-scripts` (lock hash unchanged).
- Tool: `@cyclonedx/cyclonedx-npm@4.1.2` via `npx --yes` (not added to application dependencies).
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

- Component count: **147** library components + metadata component `@ailexsi/resonance-studio-v5` / `resonance-studio-v5` **5.0.0**.
- Dependency relationships: **150** `dependencies` entries (tool graph).
- Direct vs transitive: readable from the root `dependsOn` list (the 14 `package.json` deps) vs nested nodes.
- Runtime vs dev: **not** fully encoded as CycloneDX `scope` (almost all `scope` empty). Classification is taken from `package.json` `dependencies` vs `devDependencies` (see inventory).
- Licenses: CycloneDX `acknowledgement: declared` from each package’s `package.json` `license` field as read by cyclonedx-npm. **Not** a license-file legal read except where this pass separately opened a file (mediabunny `LICENSE`).

### Cargo (`sbom-cargo.cdx.json`)

- Source lockfile: `src-tauri/Cargo.lock` (after this pass resolved the plugin mismatch).
- Graph tool: Syft **1.51.1** (`rust-cargo-lock-cataloger`), installed to `/tmp/sbom-tools` (not a project dependency).
- Command:

```
/tmp/sbom-tools/syft scan dir:src-tauri \
  --source-name ailexsi-resonance-studio-v5 \
  --source-version 5.0.0 \
  --override-default-catalogers rust-cargo-lock-cataloger \
  --exclude './target/**' \
  -o cyclonedx-json=docs/compliance/sbom-cargo.cdx.json
```

- License enrichment: `cargo +1.85.0 metadata --locked --offline` `packages[].license` copied onto matching `name`+`version` components. Syft’s lock cataloger does **not** emit licenses by itself.
- Component count: **443** crates (matches `cargo metadata` package count). The workspace crate has an empty license field.
- Dependency relationships: **318** Syft `dependencies` entries (not a full Cargo resolve dump).
- Direct runtime crates (from `src-tauri/Cargo.toml`): `tauri`, `tauri-plugin-fs`, `tauri-plugin-dialog`, `serde`, `serde_json`.
- Direct build crate: `tauri-build`.
- Direct vs transitive: `ailexsi:dependencyRelation` property (`direct` / `direct-build` / `transitive` / `root`).

## Tools (temporary — not application dependencies)

| Tool | Version | How installed | Project lockfiles touched? |
| --- | --- | --- | --- |
| npm | 10.9.7 | environment | no (`npm ci` left `package-lock.json` SHA-256 `95a4e370adf7e76692ccd8faa4511c7596e14f4c4be50d8f91d493bca2a1f181`) |
| Node | v22.14.0 | environment | no |
| `@cyclonedx/cyclonedx-npm` | 4.1.2 | `npx --yes` | no |
| Syft | 1.51.1 | vendor install script → `/tmp/sbom-tools` | no |
| cargo / rustc | 1.85.0 (check/fetch); env default was 1.83.0 | `rustup toolchain install 1.85.0` | `Cargo.lock` already updated by `cargo fetch` on 1.83 before 1.85 was used for `--locked` verify |
| cargo metadata | 1.85.0 | rustup toolchain | no further lock change |

Host `cargo 1.83.0` **cannot** parse some already-locked crates that declare `edition2024` (observed: `dlopen2_derive 0.4.3`). `cargo +1.85.0 fetch --locked` succeeded on the updated lockfile. Crate `rust-version` fields already in this lock (e.g. `icu_*`, `time`, `darling`) require **rustc 1.88+**. `cargo +1.88.0 check --locked --target x86_64-pc-windows-msvc` compiled `tauri-plugin-fs 2.5.2` and `tauri-plugin-dialog 2.7.3`; the workspace build script then failed (`tauri-winres` / missing `llvm-rc` on this Linux VM). Host Linux check needs GTK `gdk-3.0` (not installed here). No Windows EXE was produced in this environment.

## Known limitations

- Not a legal review. SPDX IDs are **declared metadata** from package manifests / crate `license` fields.
- Dual-license OR expressions are recorded as declared; this pass does **not** choose which alternative applies.
- npm CycloneDX `scope` is incomplete (dev vs runtime must be read from `package.json` / inventory).
- Cargo CycloneDX graph is Syft’s lock catalog (318 edges), not `cargo tree` completeness.
- Platform-specific Cargo deps are all listed in the lockfile; Windows-only vs Linux-only is not fully classified in the BOM.
- Syft guessed CPE strings for the workspace crate; those CPEs are tool output, not a vulnerability statement.
- npm `npm ci` reported **2 moderate** audit findings. This pass did **not** run `npm audit fix` or change npm versions.
- Application product license is **not** chosen. Workspace Cargo package license field is empty. No `LICENSE` / `THIRD_PARTY_NOTICES` files were created.
- Regenerating later may change timestamps, tool versions, or (if lockfiles change) component sets.

## Reproducibility commands used

```
npm ci --ignore-scripts
# package-lock.json SHA-256 unchanged

cd src-tauri
cargo fetch                          # first resolve: added plugins + transitive crates only
cargo +1.85.0 fetch --locked         # lockfile reproducible on 1.85.0
```
