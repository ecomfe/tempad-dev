# Tempad Dev — Agent Guide (Root)

## Purpose

Provide a single entry point for coding agents. This file links to package-level guides and highlights repo-wide constraints and workflows.

## Repo map (high level)

- `packages/extension/` — Figma plugin + MCP tools implementation
- `packages/mcp-server/` — MCP server runtime
- `packages/mcp-shared/` — shared types and contracts
- `packages/plugins/` — plugin-side code and transforms

## Start here

- `packages/extension/AGENTS.md`
- `packages/mcp-server/AGENTS.md`
- `packages/mcp-shared/AGENTS.md`
- `packages/plugins/AGENTS.md`

## Global conventions

- Package manager: `pnpm`
- Prefer repo-level scripts unless a package explicitly documents otherwise.

## Common commands

- Typecheck: `pnpm typecheck`
- Lint (and format): `pnpm lint:fix`

## Doc index

- `docs/extension/requirements.md`
- `docs/extension/design.md`

## Guardrails

- Keep changes minimal and consistent with existing style.
- Avoid adding new global dependencies unless explicitly requested or approved.

## Contributing & verification

### Tech stack (repo-wide)

- Package manager: `pnpm` (workspace scripts are commonly run as `pnpm -r ...`).
- Language: TypeScript.
- Extension: Vue 3 + WXT (Web Extension Toolkit).
- MCP server: Node.js 18+ + `@modelcontextprotocol/sdk` + WebSocket transport.
- Shared contracts: `zod` schemas.
- Build tool (non-extension packages): `tsdown`.

### Key scripts

Run these at repo root unless noted.

- Dev extension: `pnpm dev`
- Build everything: `pnpm build`
- Build extension: `pnpm build:ext`
- Build plugins: `pnpm build:plugins`
- Build MCP: `pnpm build:mcp`
- Typecheck all packages: `pnpm typecheck`
- Lint all packages: `pnpm lint` / auto-fix: `pnpm lint:fix`
- Format: `pnpm format`
- Zip extension artifact: `pnpm zip`

### Verification checklist (agent-driven changes)

Pick the checks that match your change.

1. Always

- `pnpm typecheck`
- `pnpm lint` (or `pnpm lint:fix`)

2. Extension UI / codegen

- `pnpm dev`
- In Figma, open TemPad Dev panel and validate the impacted section (e.g. “Inspect → Code”).

3. Extension build / packaging

- `pnpm build:ext`
- `pnpm zip`

4. Rewrite subsystem

- `pnpm --filter @tempad-dev/extension build:rewrite`
- Optional: `pnpm --filter @tempad-dev/extension tsx scripts/check-rewrite.ts`
  - Requires `FIGMA_EMAIL`, `FIGMA_PASSWORD`, `FIGMA_FILE_KEY`.

5. MCP schemas / tool behavior

- If you change tool schemas/contracts: update `packages/mcp-shared` first, then `packages/mcp-server`, then `packages/extension`.
- Re-check payload limits and omission rules; see `docs/extension/requirements.md` and `docs/extension/design.md`.
