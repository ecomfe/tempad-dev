# MCP get_code - Requirements

This document records the source requirements and hard constraints for the MCP `get_code` tool in `packages/extension/mcp/tools/code`.

## Non-negotiables

- Accept exactly one visible node; otherwise throw a user-facing error.
- Never emit empty optional fields (`assets`, `tokens`, `warnings`).
- Do not use `renderBounds` diffs for positioning.
- Do not inject positioning containers on GROUP/BOOLEAN nodes.
- Keep `getCSSAsync()` at most once per node.
- If a plugin returns component/code for an instance, do not collect or render its descendants.

## Scope

- Applies to MCP `get_code` only (not the UI codegen pipeline).
- Output is markup + Tailwind classes + optional assets/tokens metadata.

## Input constraints

- Exactly one node is required.
- The node must be visible.
- Tree traversal is capped by a depth limit (semantic-tree driven). If capped, log a warning.
- If depth is capped, emit a `depth-cap` warning listing capped node ids so agents can call `get_code` on those nodes.

## Output contract (GetCodeResult)

- Required fields:
  - `lang`: resolved language for output markup.
  - `code`: string markup.
  - `codegen`: `{ plugin: string, config: CodegenConfig }`.
- Optional fields (omit when empty):
  - `assets`: array of exported assets (image/vector).
  - `tokens`: one-layer map of token entries keyed by canonical token name.
  - `warnings`: only for truncation, inferred auto layout, or depth-cap.

## Size and truncation

- Total payload is constrained by `MCP_MAX_PAYLOAD_BYTES`.
- The `code` field is limited to ~60% of that cap.
- If truncated, add a warning and truncate the code string only.

## Layout and positioning

### Layout parent

Figma `relativeTransform` is relative to the container parent, not to a GROUP/BOOLEAN parent. The layout parent is the nearest ancestor that is not `GROUP` or `BOOLEAN_OPERATION`.

### Positioning rules

- If parent has explicit `layoutMode` (auto layout):
  - Children with `layoutPositioning === 'ABSOLUTE'` use absolute positioning.
  - Other children stay in flow (flex layout).
- If parent has inferred auto layout:
  - Treat it as a layout parent (see “Inferred auto layout”).
  - Do not apply constraint-based absolute positioning for its children.
- If parent has no auto layout:
  - Compute absolute positioning from `constraints` + `relativeTransform`.

### Flex/grid sibling ordering

- When a node renders as `flex/inline-flex` or `grid/inline-grid`, sibling order is meaningful.
- Siblings are sorted by position using `absoluteBoundingBox` only:
  - Flex: sort by primary axis (`x` for row, `y` for column).
  - Grid: row-major (`y` then `x`).
  - Use stable ordering within ~0.5px to preserve original order.
- If any child lacks `absoluteBoundingBox`, keep the original order.

### Group/boolean

- GROUP and BOOLEAN_OPERATION nodes are kept in the tree for structure and hints.
- They must not become positioning containers (`position: absolute/relative` is not injected there).

### Relative containers for absolute children

- When any node is absolutely positioned, the layout parent is ensured to be `position: relative`.
- Do not add `left/top` to the container during this step.

### Constraint calculation

- Use `relativeTransform` translation plus node/parent sizes to compute `left/top/right/bottom`.
- Respect constraints (`MIN|MAX|CENTER|STRETCH|SCALE`).
- If no constraints exist, fall back to `left/top`.
- All numeric outputs are rounded to at most 3 decimals.

## Inferred auto layout

- Inferred auto layout may emit flex/gap/padding CSS for readability, but it is not authoritative.
- Inferred layouts are flagged with `data-hint-auto-layout="inferred"` for downstream interpretation.
- Children under inferred layout must not be constraint-positioned, unless `layoutPositioning === 'ABSOLUTE'`.

## SVG and assets

- Vector assets are exported as SVG when a node (or container) is classified as vector-only.
- Images are exported as PNG/JPEG when the node is an image fill.
- SVG must contain its own visual styles; no external fill/bg classes.
- SVG layout is governed by external positioning only.
- SVG size comes from node size (rounded), not export metadata.
- When vector export fails or assets are unavailable, preserve layout using a placeholder SVG with node size.
- Omit `assets` when empty.

## Plugin output

- If a plugin returns component/code for an instance, the instance subtree is not collected.
- Plugin output is preferred over fallback rendering for that instance.

## Token handling

- Token detection starts from the emitted markup; names may be transformed/re-written, and final used names are derived from the rewrite map (no second scan).
- Token detection always strips `var(..., fallback)` before matching to avoid false positives.
- Variable names are normalized consistently across Figma variable names, `codeSyntax`, and plugin transforms.
- `tokens` is a single map keyed by canonical token name. Each entry:
  - `kind`: token kind.
  - `value`:
    - string for single-mode value or alias.
    - map for multi-mode, keyed by `${collectionName}:${modeName}`.
- `tokens` includes both directly used tokens and any alias-chain tokens.
- When `resolveTokens` is `true`, code is resolved per-node (mode-aware); token values are literals.
- When `resolveTokens` is `false`, token values remain aliases/literals as emitted by Figma/variables.
- Collection names are assumed unique; duplicates are unsupported and should emit a warning.
- Omit `tokens` when empty.

### Token pipeline guards

- If no source names exist, skip the token pipeline entirely.
- If no tokens are detected in the code, skip plugin transform/rewrites and token defs.
- If rewrites produce no valid bridge entries, skip token defs.

### Variable mode overrides

- Nodes with explicit variable mode overrides emit:
  - `data-hint-variable-mode="Collection=Mode;Collection=Mode"`.
- This hint is for agents only and must be stripped from final output.

## Text

- Use `getStyledTextSegments` where available; failures are logged (not fatal).
- Use fill data when Figma CSS omits visible text paints.

## Logging

- Only emit `warnings` for truncation, inferred auto layout, and depth-cap.
- Emit `depth-cap` warnings when tree depth is capped (include node ids).
- Other degradations should be logged via the shared `logger` (prefix is automatic).
- The tool may log high-level timing info via `logger.debug` for performance diagnostics.

## Performance

- `getCSSAsync` must be called at most once per node.
- `getStyledTextSegments` only for text nodes.
- Avoid repeated vector export calls; plan and export once per tree.
- Skip style collection for vector-root descendants (they are not rendered).
- Variable candidate scanning uses bound variables and paint references; inferred variables are not required.
