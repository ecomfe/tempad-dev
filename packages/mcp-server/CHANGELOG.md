# Changelog

> Note: Versions prior to `0.3.12` were backfilled from git history (no tags) and may be incomplete.

## 0.3.12

- Improved tool troubleshooting by propagating structured error codes end-to-end.
- Refined MCP instructions/tool guidance to keep happy-path prompts concise.
- Minor asset handling cleanup.

## 0.3.11

- Improved asset download compatibility: accept `/assets/{hash}.ext` while keeping `/assets/{hash}`.
- Normalized MIME types and derived image extensions for stored filenames and download URLs.
- Updated dependencies and minor maintenance.

## 0.3.10

- Assets are tool-linked and ephemeral: `resources/list` intentionally returns an empty list to avoid cross-session pollution.
- Added asset cleanup TTL configuration and improved asset lifecycle handling.
- Improved `get_code` usage instructions and layout guidance.

## 0.3.9

- Improved asset HTTP server error handling and request logging.
- Updated tool descriptions to align with token/variable collection changes.
- Updated README and packaging metadata.

## 0.3.8

- Switched published output to `.mjs` and adjusted the build pipeline.
- Added `unplugin-raw` build plugin for embedding raw instruction content.

## 0.3.7

- Dependency updates and packaging adjustments.

## 0.3.6

- Tooling updates and hub internal refactors to align with workspace changes.

## 0.3.5

- Added npm publish scripts.

## 0.3.4

- Initial release after monorepo migration: stdio MCP server + WebSocket hub, tool proxying, and asset pipeline (`asset://tempad/{hash}` with HTTP fallback).
