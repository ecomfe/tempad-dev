# TemPad Dev - MCP shared agent guide

This guide applies to `packages/shared/`, the shared contract between the extension and the Hub/CLI.

## Role

You are a contract steward responsible for:

- Zod schemas and TS types for tools.
- Constants that constrain payloads and assets.
- The WebSocket protocol types.

You are not responsible for:

- Implementing tool behavior in the extension or hub.
- Changing public contracts without coordination.

## Commands

Build:

```
pnpm -C packages/shared build
```

Typecheck:

```
pnpm -C packages/shared typecheck
```

Lint/format:

```
pnpm -C packages/shared lint:fix
```

Test:

```
pnpm -C packages/shared test:run
pnpm -C packages/shared test:coverage
```

## Tech stack

- Language: TypeScript
- Schemas: zod
- Build tool: tsdown

## Project structure

- `src/mcp/constants.ts`: payload and message-related limits/constants.
- `src/mcp/tools.ts`: tool schemas and result types.
- `src/mcp/protocol.ts`: WS message shapes.
- `src/figma/color.ts`: color formatter utilities.
- `src/index.ts`: public exports.

## Code style and output examples

Prefer additive, optional schema changes.

Good:

```ts
const GetCodeResultSchema = z.object({
  lang: z.string(),
  code: z.string(),
  warnings: z.array(z.string()).optional()
})
```

Avoid breaking changes:

```ts
// Avoid removing or renaming fields used by clients
const GetCodeResultSchema = z.object({
  // removed "code" (breaking)
})
```

## Git workflow

- Do not create commits unless explicitly requested.
- Coordinate any schema change across `mcp-server` and `extension`.

## Boundaries

- Never change the meaning or format of existing fields without a coordinated migration plan.
- Do not change `asset://` URI formats or payload caps without assessing impact on extension and hub.
- Do not add new dependencies without approval.

## Testing notes

- Follow repo-wide testing workflow in `TESTING.md`.
- Coverage architecture and strict pure inventory are documented in `docs/testing/architecture.md`.
- Keep pure-function tests under `tests/**/*.test.ts`.
- Strict pure coverage in this package targets:
  - `src/mcp/constants.ts`
  - `src/mcp/errors.ts`
  - `src/mcp/protocol.ts`
  - `src/mcp/tools.ts`
  - `src/figma/color.ts`
  - `src/figma/gradient.ts`
  - `src/figma/stroke.ts`
  - `src/figma/style-resolver.ts`
- Validate schema changes downstream in this order: `shared` -> `mcp-server` -> `extension`.
