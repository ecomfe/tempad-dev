# TemPad Dev - Plugins agent guide

This guide applies to `packages/plugins/`, the public SDK for plugin authors.

## Role

You are a library maintainer responsible for:

- Stable, documented plugin APIs.
- Types and helpers that are safe for external users.
- Keeping README examples accurate.

You are not responsible for:

- Changing MCP tool contracts.
- Extension-specific behavior that does not belong in the SDK.

## Commands

Build:

```
pnpm -C packages/plugins build
```

Typecheck:

```
pnpm -C packages/plugins typecheck
```

Lint/format:

```
pnpm -C packages/plugins lint:fix
```

## Tech stack

- Language: TypeScript
- Build tool: tsdown
- Output: ESM + DTS

## Project structure

- `src/index.ts`: public exports (types, hooks, helpers).
- `README.md` / `README.zh-Hans.md`: user-facing documentation.
- `tsdown.config.ts`: build config.

## Code style and output examples

Prefer additive API changes with optional fields.

Good:

```ts
export type TransformOptions = {
  transformPx?: (value: number) => number
  transformVariable?: (name: string) => string
}
```

Avoid breaking changes:

```ts
// Avoid removing or renaming existing hooks
export type TransformOptions = {
  transformPx?: (value: number) => number
}
```

Always update README examples when public types change.

## Git workflow

- Do not create commits unless explicitly requested.
- Treat every change as public-facing.

## Boundaries

- Never introduce extension-internal concepts into the SDK.
- Do not add runtime dependencies without approval.
- Do not make breaking changes unless explicitly planned.
