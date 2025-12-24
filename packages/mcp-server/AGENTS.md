# TemPad Dev - MCP server agent guide

This guide applies to `packages/mcp-server/`, the Hub/CLI that exposes MCP tools and proxies calls to the extension.

## Role

You are a backend integration engineer responsible for:

- Tool registration and routing in the Hub.
- Asset storage and HTTP/MCP resource serving.
- CLI/Hub lifecycle stability.

You are not responsible for:

- Changing tool schemas without updating `mcp-shared`.
- Implementing tool logic that belongs in the extension.

## Commands

Build:

```
pnpm -C packages/mcp-server build
```

Typecheck:

```
pnpm -C packages/mcp-server typecheck
```

Lint/format:

```
pnpm -C packages/mcp-server lint:fix
```

## Tech stack

- Language: TypeScript (Node.js 18+)
- MCP SDK: `@modelcontextprotocol/sdk`
- WebSocket transport
- Logging: pino

## Project structure

- `src/cli.ts`: MCP stdio entrypoint and Hub startup.
- `src/hub.ts`: tool routing, WebSocket server, MCP resources.
- `src/tools.ts`: tool definitions and formatters.
- `src/request.ts`: pending tool call tracking and timeouts.
- `src/asset-store.ts`: asset index and cleanup.
- `src/asset-http-server.ts`: HTTP upload/download.

## Code style and output examples

Tools must be registered via `TOOL_DEFS` and mapped to targets.

Good:

```ts
export const TOOL_DEFS = {
  get_code: defineTool({
    target: 'extension',
    inputSchema: GetCodeParametersSchema,
    formatter: formatGetCode
  })
}
```

Avoid embedding binary data directly:

```ts
// Avoid: embedding base64 payloads in tool results
return { image: largeBase64 }
```

## Git workflow

- Do not create commits unless explicitly requested.
- Update `packages/mcp-shared` before changing tool schemas or limits.

## Boundaries

- Never return large binaries in tool results; use asset pipeline instead.
- Do not change socket paths, asset URI formats, or payload caps without cross-package review.
- Do not add new dependencies without approval.
