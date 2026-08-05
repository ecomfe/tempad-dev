# Tempad Dev — agent guide (root)

## Purpose

Provide a single entry point for coding agents. This file links to package-level guides and highlights repo-wide constraints and workflows.

## Repo map (high level)

- `packages/extension/` — Figma plugin + MCP tools implementation
- `packages/mcp-server/` — MCP server runtime
- `packages/shared/` — shared types and contracts
- `packages/plugins/` — plugin-side code and transforms
- `agent-plugins/` — shared agent plugin bundles and platform manifests

## Start here

- `packages/extension/AGENTS.md`
- `packages/mcp-server/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/plugins/AGENTS.md`

## Global conventions

- Package manager: `pnpm`
- Prefer repo-level scripts unless a package explicitly documents otherwise.
- When creating commits, use Conventional Commits (for example: `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`).

## Common commands

- Typecheck: `pnpm typecheck`
- Lint (and format): `pnpm lint:fix`
- Test (watch): `pnpm test`
- Test (run): `pnpm test:run`
- Test (coverage): `pnpm test:coverage`
- Generate the local agent plugin: `pnpm agent-plugin:dev`
- Extension node tests: `pnpm --filter @tempad-dev/extension test:node`
- Extension browser tests: `pnpm --filter @tempad-dev/extension test:browser`
- Extension browser setup: `pnpm --filter @tempad-dev/extension test:setup`

## Agent plugin workflow

- `agent-plugins/tempad-dev/` is the tracked release source shared by Codex and Claude. The agent
  plugin is distributed through the Git marketplace, not npm.
- `.dev/plugins/tempad-dev-dev/` is the ignored local build. Generate it with
  `pnpm agent-plugin:dev`; do not edit generated files under `.dev/`.
- Run `pnpm agent-plugin:dev` after changing the shared skill, agent-plugin manifests, icons, or
  marketplace metadata. Ordinary `pnpm build` must not modify agent-plugin artifacts.
- `pnpm dev` watches the extension, shared package, and MCP server. The generated development
  plugin points directly at the current checkout's MCP build, so MCP-only changes require a new
  agent task or plugin reload, not an agent-plugin rebuild or reinstall.
- Keep Codex and Claude support equivalent. Both development manifests must launch the same
  working-tree MCP runtime.
- Release MCP configuration must use `@tempad-dev/mcp@latest`, never an alpha tag, fixed version,
  or local path.
- See `agent-plugins/tempad-dev/README.md` for the Codex and Claude installation commands.

## Doc index

- `TESTING.md`
- `docs/testing/architecture.md`
- `docs/extension/mcp-get-code-requirements.md`
- `docs/extension/mcp-get-code-design.md`
- `docs/extension/mcp-canvas-authoring-design.md`
- `docs/extension/mcp-canvas-assets-design.md`
- `docs/extension/mcp-browser-gateway-design.md`
- `docs/marketing-screenshots.md`

## Guardrails

- Keep changes minimal and consistent with existing style.
- Avoid adding new global dependencies unless explicitly requested or approved.
- Keep pull request descriptions concise. Do not include a validation section unless explicitly requested.

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
- Dev site: `pnpm dev:site`
- Build everything: `pnpm build`
- Build site: `pnpm build:site`
- Build extension: `pnpm build:ext`
- Build plugins: `pnpm build:plugins`
- Build MCP: `pnpm build:mcp`
- Typecheck all packages: `pnpm typecheck`
- Lint all packages: `pnpm lint` / auto-fix: `pnpm lint:fix`
- Test all packages: `pnpm test:run`
- Coverage report: `pnpm test:coverage`
- Format: `pnpm format`
- Zip extension artifact: `pnpm zip`

### Verification checklist (agent-driven changes)

Pick the checks that match your change.

1. Always

- `pnpm typecheck`
- `pnpm lint` (or `pnpm lint:fix`)
- `pnpm test:run`

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

- If you change tool schemas/contracts: update `packages/shared` first, then `packages/mcp-server`, then `packages/extension`.
- Re-check payload limits and omission rules; see `docs/extension/mcp-get-code-requirements.md` and `docs/extension/mcp-get-code-design.md`.

## Testing notes

- Testing runbook and required checks: `TESTING.md`.
- Testing architecture and coverage model: `docs/testing/architecture.md`.
- Root coverage composition is configured in `vitest.config.ts`; shared thresholds and the extension
  node source list live in `vitest.coverage.ts`.
- Root coverage excludes build artifacts (`**/dist/**`, `**/.output/**`) to avoid polluted reports.
- Root coverage provider is `istanbul` to avoid V8 remap parse failures under Vite 8 dependency trees.
- Extension browser tests run in Playwright via `packages/extension/vitest.browser.config.ts`.
- Do not introduce jsdom-based tests in this repository.
