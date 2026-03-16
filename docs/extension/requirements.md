# MCP get_code - requirements

This document records the source requirements and hard constraints for the MCP `get_code` tool in `packages/extension/mcp/tools/code`.

## Non-negotiables

- Accept exactly one visible node; otherwise throw a user-facing error.
- Never emit empty optional fields (`assets`, `tokens`, `warnings`).
- Do not use `renderBounds` diffs for positioning.
- Do not inject positioning containers on GROUP/BOOLEAN nodes.
- Keep `getCSSAsync()` at most once per node.
- Do not persist Figma-derived cache state across requests.
- If a plugin returns component/code for an instance, do not collect or render its descendants.

## Scope

- Applies to MCP `get_code` only (not the UI codegen pipeline).
- Output is markup + Tailwind classes + optional assets/tokens metadata.

## Input constraints

- Exactly one node is required.
- The node must be visible.
- `vectorMode` is optional:
  - `smart` (default): emit `<svg data-src="...">` placeholders in code and preserve themeable instance color on the emitted `svg` root markup for downstream adaptation. If asset upload fails after export, inline the SVG as a fallback to preserve source of truth.
  - `snapshot`: preserve vector assets for fidelity, even if a vector would otherwise be themeable.
- Tree traversal is capped by a depth limit (semantic-tree driven). If capped, log a warning.
- If depth is capped, emit a `depth-cap` warning telling agents to continue with narrower `get_code` calls using returned `data-hint-id` values.

## Output contract (GetCodeResult)

- Required fields:
  - `lang`: resolved language for output markup.
  - `code`: string markup.
  - `codegen`: `{ plugin: string, config: CodegenConfig }`.
- Optional fields (omit when empty):
  - `assets`: array of exported assets (image/vector).
  - `tokens`: one-layer map of token entries keyed by canonical token name.
  - `warnings`: lightweight `type + message` guidance for inferred auto layout, depth-cap, or shell fallback.
- SVG assets may include `themeable: true` when the vector can safely adopt a single contextual color channel.

## Size and budget guard

- Tool transport is still constrained by `MCP_MAX_PAYLOAD_BYTES`, but inline response budgeting is separate.
- The default inline budget for `get_code` is `64 KiB`, measured on the final `CallToolResult` UTF-8 bytes.
- If output exceeds the inline budget, prefer returning a shell response for the current node.
- A shell response:
  - preserves the current node wrapper/layout markup,
  - omits all direct children for that node,
  - lists omitted child ids in an inline code comment in render order,
  - emits a lightweight `shell` warning that points agents to that inline comment.
- v1 shell fallback may still depend on the already-collected full-tree context; reducing collection/export cost is a later optimization, not part of this contract.
- Only throw a user-facing budget error when a usable shell cannot be generated.

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

- Inferred auto layout remains a hint in the raw Figma model, but once `get_code` emits flex/gap/padding for that node, the emitted auto-layout becomes the authoritative flow model for non-absolute children in this response.
- Inferred layouts are flagged with `data-hint-auto-layout="inferred"` for downstream interpretation.
- Children under inferred layout must not be constraint-positioned, unless `layoutPositioning === 'ABSOLUTE'`.
- Any fixed/hug/fill cleanup must preserve that emitted flow model and only remove redundant size/padding expressions.

## SVG and assets

- Vector-only nodes or containers are classified before render as either:
  - themeable single-color vectors, which preserve one contextual color channel on the emitted placeholder `svg` root markup.
  - fixed-color vectors, which keep their internal palette in the exported SVG asset.
- Images are exported as PNG/JPEG when the node is an image fill.
- Vector placeholders use the form `<svg data-src="...">`, keep `viewBox`, retain node-sized `width`/`height`, and expose the uploaded asset URL via `data-src` on the emitted `svg` root markup.
- Themeable vector placeholders preserve the instance color on the emitted `svg` root markup, preferring token/class output when available.
- Themeable-vector eligibility and single-channel color detection must share the same paint/effect visibility semantics used elsewhere in the asset pipeline; do not maintain a separate vector-only interpretation of visible paints, effects, or variable-backed solid colors.
- `themeable` means one safe contextual color channel. The authoritative color evidence is the emitted `svg` root markup for that instance, not asset metadata. It does not imply multi-slot SVG theming.
- The emitted markup is the tool's default delivery for the current response, not a mandatory final integration format. Clients may adapt vector delivery to repo policy, such as:
  - existing icon/component primitives,
  - import-time SVG transforms in the dev server or bundler,
  - inline SVG,
  - asset-backed SVG usage.
- Any such adaptation must preserve the vector semantics:
  - `themeable` vectors stay single-channel and context-color-driven,
  - fixed-color vectors keep their internal palette.
- Snapshot-preserved SVG assets may include `themeable: true` when the underlying vector is safe to adapt to a single contextual color channel, even if the current delivery stays asset-backed.
- Public asset metadata does not carry per-instance theme color; that remains a markup concern.
- SVG size comes from node size (rounded), not export metadata.
- If the SVG export succeeded but asset upload failed, inline the SVG fallback rather than dropping the vector structure.
- When vector export fails or assets are unavailable, preserve layout using a placeholder SVG with node size.
- Omit `assets` when empty.

## Plugin output

- If a plugin returns component/code for an instance, the instance subtree is not collected or exported as vector assets.
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
- This resolve step must also update themeable vector-placeholder root presentation color when that color is token-backed, so vector markup and token payload stay aligned.
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

- Emit `warnings` for inferred auto layout, depth-cap, and shell guidance.
- Emit `depth-cap` warnings when tree depth is capped.
- Other degradations should be logged via the shared `logger` (prefix is automatic).
- The tool may log high-level timing info via `logger.debug` for performance diagnostics.
- Dev timing logs may include cache hit/miss counters and vector export result counters. These diagnostics are not part of the MCP response contract.

## Performance

- `getCSSAsync` must be called at most once per node.
- `getStyledTextSegments` only for text nodes.
- Repeated node/style/variable/vector-analysis reads should go through one request-scoped cache context instead of pass-local ad hoc caches.
- Shared style helpers must depend only on injected lookup readers or pure paint inputs; they must not depend on an extension-local cache type.
- Paint-style cache entries must store raw paints and size-independent facts only. Any gradient string still has to be resolved with the current node size.
- Avoid repeated vector export calls; plan and export once per tree.
- Skip style collection for vector-root descendants (they are not rendered).
- Variable candidate scanning uses bound variables and paint references; inferred variables are not required.
- Variable candidate scanning must continue from the raw selected roots rather than `VisibleTree` so depth-cap and variable collection semantics stay unchanged.
