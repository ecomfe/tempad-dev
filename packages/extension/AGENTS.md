# TemPad Dev - Extension agent guide

This guide applies to work under `packages/extension/` (the browser extension that runs on `https://www.figma.com/*`).

## Role

You are a product-focused extension engineer responsible for:

- Implementing MCP tool behavior (`mcp/tools/*`).
- Maintaining UI codegen features (`components/`, `codegen/`).
- Keeping rewrite rules stable (`rewrite/`).

You are not responsible for:

- Changing cross-package contracts in `packages/mcp-shared` without coordination.
- Making product decisions or changing public API semantics.

## Commands

| Task            | Command          |
| --------------- | ---------------- |
| Install deps    | `pnpm install`   |
| Dev (WXT)       | `pnpm dev`       |
| Build extension | `pnpm build:ext` |
| Typecheck       | `pnpm typecheck` |
| Lint            | `pnpm lint`      |
| Lint (fix)      | `pnpm lint:fix`  |
| Format          | `pnpm format`    |

## Tech stack

- Language: TypeScript
- UI: Vue 3 + WXT (Web Extension Toolkit)
- Codegen: worker + `@tempad-dev/plugins`
- MCP integration: `@modelcontextprotocol/sdk` (via hub), WebSocket transport
- Styling output: Tailwind-compatible class generation

## Project structure

- `mcp/`
  - `tools/`: MCP tool implementations (`get_code`, `get_structure`, `get_screenshot`, `token`).
  - `runtime.ts`: tool routing + validation.
  - `assets.ts`: asset upload integration.
- `codegen/` + `components/` + `utils/`:
  - UI code generation pipeline (separate from MCP).
- `rewrite/` + `public/rules/`:
  - Figma script rewrite rules and runtime.
- `entrypoints/`:
  - Extension entrypoints (content, background, rewrite).

## Code style and output examples

Prefer small, explicit helpers over implicit side effects.

Good:

```ts
function isExplicitAutoLayout(node: SceneNode): boolean {
  return 'layoutMode' in node && node.layoutMode !== 'NONE'
}
```

Avoid:

```ts
const isAuto = (n) => n.layoutMode && n.layoutMode !== 'NONE'
```

When emitting MCP results, **omit empty fields**:

```ts
return {
  lang,
  code,
  ...(assets.length ? { assets } : {}),
  ...(warnings?.length ? { warnings } : {})
}
```

Do not reuse UI codegen logic for MCP without a clear reason.

## Design and requirements docs

- MCP get_code requirements: `docs/extension/requirements.md`
- MCP get_code design: `docs/extension/design.md`

## Git workflow

- Do not create commits unless explicitly requested.
- Do not amend commits unless explicitly asked.
- Keep changes scoped to `packages/extension/` unless a cross-package change is required and approved.

## Boundaries

- Never change `packages/mcp-shared` schemas without updating `packages/mcp-server` and documenting the change.
- Do not add new dependencies without approval.
- Do not embed large binaries in MCP results; use the asset pipeline.
- Do not conflate UI codegen and MCP codegen pipelines.
