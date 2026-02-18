# MCP context strategy (v2)

This document records the current context-control strategy for TemPad Dev MCP outputs.

## Goals

- Reduce tool outputs that trigger upstream client/model truncation.
- Keep MCP APIs stable (no additional tool params/outputs).
- Prefer lightweight metadata in MCP responses; avoid shipping large image payloads through context.

## Decisions

1. `get_code` keeps existing API but uses token-aware budget guards.
   - Budget is computed in bytes with conservative token estimation.
   - Output is validated in UTF-8 bytes at render and rewrite stages.
   - If over budget, fail fast with guidance to reduce selection scope (no partial code).
2. `get_structure` keeps existing API but output is compacted by default.
   - Limit total nodes.
   - Normalize/trim long names.
   - Round geometry values.
   - Iteratively reduce node cap to keep payload small.
3. `get_screenshot` is internal-only (`exposed: false`) and removed from normal tool guidance.
4. Image/SVG asset bytes are downloaded via `asset.url`.
   - Asset resources are not exposed via MCP `resources/read`.

## Why

- Different agent clients apply their own MCP/tool output limits before model context limits.
- Partial/truncated code increases hallucination risk in downstream agents.
- Character-only truncation does not map well to model token budgets.
- Image and SVG payloads are high-context-cost and do not need to be embedded in model input.

## Non-goals

- No chunked `get_code` protocol.
- No artifact manifests or additional retrieval abstractions.
- No schema expansion for existing MCP tools.
