# Changelog

## 0.3.12

- Improved tool troubleshooting by propagating structured error codes end-to-end.
- Refined MCP instructions/tool guidance to reduce prompt bloat while keeping failure-path recovery actionable.

## 0.3.11

- Improved asset download compatibility: accept `/assets/{hash}.ext` while keeping `/assets/{hash}`.
- Normalized MIME types and derived image extensions for stored filenames and download URLs.

## 0.3.10

- Assets are tool-linked and ephemeral: `resources/list` intentionally returns an empty list to avoid cross-session pollution.
- Added asset cleanup TTL configuration and improved asset lifecycle handling.
- Improved `get_code` usage instructions and layout guidance.

## 0.3.9

- Improved asset HTTP server robustness (upload/download error handling and request logging).

## 0.3.8

- Improved Node.js ESM compatibility for `npx @tempad-dev/mcp` consumers.

## 0.3.7

- Updated package dependency classification: moved `@tempad-dev/mcp-shared` to devDependencies (bundled into `dist`).

## 0.3.6

- Updated build bundling to include workspace-internal deps in `dist` for more reliable installs/runs.

## 0.3.5

- Version bump only.

## 0.3.4

- Monorepo migration of the MCP server package (no behavior change intended).

## 0.3.3

- Version bump only.

## 0.3.2

- Improved server-side logging and operational stability.

## 0.3.1

- Version bump only.

## 0.3.0

- Added `resource_link` blocks to tool outputs to make assets easier to fetch via MCP resources/HTTP fallback.
- Hid `get_assets` from the default tool list (used internally for resolving asset descriptors).

## 0.2.1

- Improved error handling and diagnostics around socket closure, asset uploads, and token/variable resolution.

## 0.2.0

- Introduced an asset pipeline (HTTP upload/download + on-disk store) to avoid embedding large binaries in tool results.
- Standardized tool parameters around a single `nodeId` and added token resolution options.

## 0.1.0

- Initial MCP server release (stdio MCP + WebSocket hub) exposing `get_code`, `get_structure`, `get_screenshot`, and `get_token_defs`.
