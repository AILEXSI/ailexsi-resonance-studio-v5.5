# ADR-003 — AI Host placement

**Status:** Accepted direction (not implemented in AI-0)  
**Date:** 2026-09-18  
**Baseline:** V5.6 @ `35b6503`

## Context

Architecture v0.2 recommends logical isolation now and optional process isolation later. Inspection:

- One JS heap: React + Web Audio + WebCodecs + AFE + export loop (`src/app/App.tsx`, `src/core/frame-engine/`, `src/core/exporter/`).
- **Zero** `Worker` / `SharedWorker` / `OffscreenCanvas` / `AudioWorklet` in `src/`.
- Tauri Rust is FS scope + dialog only (`src-tauri/src/lib.rs`). No sidecar process API.
- Playhead transport is `requestAnimationFrame` → `advancePlayhead` → `setSession` (`App.tsx`). No `fetch` / `invoke` on that path.

## Decision

**Least invasive future boundary:**

```
App.tsx / session.ts     ← AI Director UI + conversation state (AI-1)
        │
src/ai/* (new, gated)    ← Orchestrator, context, transactions  (AI-2+)
        │  typed tools
applyCommand / apply*    ← only mutation entry (already reserved: commands.ts)
        │
core/timeline + project  ← deterministic V5.6
```

Rules:

1. AI modules must not import `src/core/frame-engine/**` or `src/core/exporter/**` except read-only job **planning** types.
2. Provider SDKs must not enter `src/core/**`.
3. Context cache updates are in-process function calls after `setSession` — **never** from the playhead RAF as a network trigger (LAW + §10.5).
4. Physical sidecar / `Worker` is deferred until a provider SDK or local runtime would otherwise share the media heap. Interfaces (`AIProvider`, tool registry) must not prevent a later process split.
5. AI-1 attaches as Inspector-body section or overlay (`ADR` here + recon §7). Do not invent a docking framework.

## Rejected alternatives

- Embedding chat inside `Preview.tsx` or the export dialog: couples untrusted code to media bind / encode.
- Tauri Rust host in AI-1: no existing command surface beyond FS; would expand capabilities prematurely.
- New Worker in AI-0/AI-1: no messages to send yet; speculative infrastructure.

## Playhead / network invariant

Playhead movement must never automatically cause network traffic. The RAF loop only calls `advancePlayhead` + `applyPlayhead`. Future context-cache subscribers may record `playheadMs` locally. Provider `chat`/`stream` runs only on explicit user send (or policy-controlled Agent step), never on `playhead.changed`.
