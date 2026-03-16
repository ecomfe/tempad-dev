# MCP context strategy (v2)

This document records the current context-control strategy for TemPad Dev MCP outputs.

## Goals

- Reduce tool outputs that trigger upstream client/model truncation.
- Keep MCP APIs stable (no additional tool params/outputs).
- Prefer lightweight metadata in MCP responses; avoid shipping large image payloads through context.

## Decisions

1. `get_code` keeps existing API but uses a shared inline budget guard.
   - Budget is computed on the final `CallToolResult` UTF-8 bytes (`64 KiB` default).
   - If over budget, prefer a shell response that preserves the current node wrapper and omits direct children.
   - Warnings stay lightweight (`type + message` only); shell continuation lives in the inline omitted-child comment, and depth-cap recovery relies on returned `data-hint-id` values.
   - v1 shell fallback optimizes correctness first, not collection cost; it may still reuse full-tree context before returning the shell.
   - Only fail fast when a usable shell cannot be generated.
2. `get_structure` keeps existing API but output is compacted by default.
   - Limit total nodes.
   - Normalize/trim long names.
   - Round geometry values.
   - Iteratively reduce node cap until the formatted result enters the shared inline budget.
3. `get_screenshot` is internal-only (`exposed: false`) and removed from normal tool guidance.
4. Image/SVG asset bytes are downloaded via `asset.url`.
   - Asset resources are not exposed via MCP `resources/read`.

## Why

- Different agent clients apply their own MCP/tool output limits before model context limits.
- Partial/truncated code increases hallucination risk in downstream agents.
- Shell responses preserve parent composition facts without relying on arbitrary string truncation.
- Character-only truncation does not map well to tool response byte budgets.
- Image and SVG payloads are high-context-cost and do not need to be embedded in model input.

## Non-goals

- No chunked `get_code` protocol.
- No artifact manifests or additional retrieval abstractions.
- No schema expansion for existing MCP tools.
