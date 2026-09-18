# ADR-005 — MCP / tool internal transport

**Status:** Accepted direction (not implemented in AI-0)  
**Date:** 2026-09-18  
**Baseline:** V5.6 @ `35b6503`

## Context

There is no MCP server, no tool registry, no IPC bus. Mutation already has a typed in-process dispatch:

```ts
// src/app/commands.ts
export function applyCommand(session: Session, command: EditorCommand): Session
```

Comment on that file: “UI keys/toolbar and a **future AI path** share this dispatch.”

Architecture v0.2 draws “Resonance MCP / Tool Server”. Building a real MCP server before in-process tools would create a second engine (LAW-04).

## Decision

**Phase order:**

1. **AI-5:** In-process function table `Map<toolName, handler>`. Handler validates schema → calls existing read functions or `applyCommand`. Same process as `App`.
2. **Transport object:** `ResonanceToolClient` is a TypeScript interface. First impl: direct function calls. Later impl may speak MCP JSON-RPC over stdio / HTTP **without changing tool names or handlers**.
3. **External MCP (AI-14):** only after internal tools + permissions + audit are proven. Same schemas, same grants, same revision checks.
4. Do **not** stand up a listening server in AI-0–AI-7.

## Consequences

- Tool names stay `namespace.action` (`project.describe`, `timeline.move_clip`).
- `timeline.move_clip` commit path = `applyMove` / `{ type: "moveClips" }` / `moveClip` — not a new mover.
- Read tools wrap `serialize`-safe views of `Session.project` + `selectionOf(session)`.

## Rejected alternatives

- Invent a second “Command Bus” object beside `applyCommand`.
- Ship `@modelcontextprotocol/sdk` server in AI-0.
- HTTP localhost MCP in the media process (port + firewall + playhead-adjacent runtime) before the in-process table exists.
