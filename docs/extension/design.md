# MCP get_code - Design

This document describes the implementation design for MCP `get_code` in `packages/extension/mcp/tools/code`. It aligns with the requirements and reflects the current pipeline.

## High-level pipeline

1. **Validate selection**
   - Exactly one visible root node required.
   - Build a visible tree with depth capping.

2. **Plan assets and plugin overrides**
   - Plan vector roots (vector-only containers) and mark their descendants for skipping.
   - If a plugin is enabled, pre-resolve plugin components for instances.
   - When a plugin returns component/code, skip collecting its descendants and reuse the cached plugin output in render.

3. **Collect data**
   - `collectNodeData()`
     - `getCSSAsync()` once per node (skipped nodes are excluded).
     - `getStyledTextSegments()` for text nodes.
     - Preprocess styles (clean background, expand shorthands, merge inferred layout, infer resizing, apply overflow).
     - Apply positioning (auto layout absolute, constraints).
     - Replace image fills with uploaded assets.

4. **Normalize variables**
   - Normalize variable names and codeSyntax to a canonical form.
   - Capture variable usage candidates for token detection.

5. **Sanitize styles**
   - Patch known layout issues (negative gap).
   - Ensure layout parents are `position: relative` when children are absolute.

6. **Build layout-only styles**
   - Extract layout-related CSS into a secondary map for SVG external layout.

7. **Export assets**
   - Export SVGs/images only once per planned asset.

8. **Render markup**
   - Render nodes into JSX/HTML component tree.
   - Inject SVG content or `<img>` when applicable.
   - Apply Tailwind class conversion.
   - Reorder flex/grid siblings by position (see “Sibling ordering”).

9. **Token pipeline**
   - Detect token references in output code.
   - Apply plugin transforms to token names.
   - Rewrite code with transformed token names.
   - Build a single `tokens` map (direct + alias-chain tokens).
   - When `resolveTokens` is true, resolve per-node (mode-aware) before Tailwind conversion.

10. **Truncate and finalize output**
    - Enforce payload size limits.
    - Emit warnings only for truncation, inferred auto layout, and depth-cap.
    - If tree depth was capped, include a `depth-cap` warning with capped node ids.

## Tree and layout semantics

### Visible tree

- Built via `buildVisibleTree`.
- Nodes include bounds, data-hints, and inferred layout hints.
- GROUP/BOOLEAN nodes are preserved for structure but ignored for layout-parent calculations.

### Layout parent resolution

- `getLayoutParent` walks up to the nearest non-GROUP/BOOLEAN ancestor.
- All relative transforms and constraints are interpreted against this layout parent.

### Positioning rules

- **Explicit auto layout (layoutMode)**
  - Children with `layoutPositioning === 'ABSOLUTE'` use absolute positioning.
  - Other children stay in flow.
- **Inferred auto layout**
  - Can emit flex/padding/gap (hinted), but is non-authoritative.
  - Constraint-based positioning is skipped under inferred layout.
- **No layout**
  - Constraint-based absolute positioning is applied to children.

### Relative container injection

- A layout parent is made `position: relative` if any descendant is absolute.
- GROUP/BOOLEAN nodes are not made relative/absolute.

## Styles pipeline

### Preprocess (per node)

- `cleanFigmaSpecificStyles`:
  - Fix background quirks and inject fills when absent.
- `expandShorthands`:
  - Break down padding/margin/inset shorthands.
- `mergeInferredAutoLayout`:
  - Inject inferred flex/padding/gap where applicable.
- `inferResizingStyles`:
  - Translate Figma layout sizing into `align-self` and size deletions.
- `applyOverflowStyles`:
  - Add overflow rules based on clips/scroll.

### Sanitize (tree-level)

- `patchNegativeGapStyles`
- `ensureRelativeForAbsoluteChildren`

### Layout-only extraction

- Builds layout-only style map for SVG containers.
- SVG roots remove width/height from layout map (SVG has own size).

## Sibling ordering

- Ordering is applied during render, not during tree build.
- Triggered only when the computed `display` is:
  - `flex` / `inline-flex` (flex ordering)
  - `grid` / `inline-grid` (grid ordering)
- Uses `absoluteBoundingBox` only (no fallback). If any child is missing a box, original order is preserved.
- Flex ordering uses the primary axis:
  - `row` / `row-reverse` → `x`
  - `column` / `column-reverse` → `y`
  - If `flex-direction` is missing, fall back to node’s `layoutMode` / `inferredAutoLayout.layoutMode`.
- Grid ordering is row‑major (`y` then `x`), with a small epsilon (~0.5px) to keep stable order for near‑ties.

## SVG and asset strategy

- Vector-like nodes may be exported to SVG.
- Vector containers can be converted to a single SVG if all leaves are vector-like.
- SVG nodes only receive external layout styles, not visual paint styles.
- Placeholder SVG is emitted when export fails or is unavailable, using node width/height.
- Vector-root descendants are not rendered; their CSS is not collected.

## Token pipeline (detailed)

1. Build source index from variable IDs and codeSyntax.
2. Strip fallbacks, then extract raw token names from code (boundary-aware).
3. Apply plugin transforms to names.
4. Rewrite code with transformed names (only if any rename occurs).
5. Derive final used names from the rewrite map (no second scan).
6. Build a single token map (direct + alias-chain tokens).
7. Per-node resolve (only when `resolveTokens` is true).

### Pipeline guards

- If no source names exist, return early with no tokens.
- If no token names are detected, skip plugin transforms and defs.
- If rewrites yield no bridged ids, skip defs.

## Error handling

- Fatal: invalid selection, no renderable root, failure to build markup.
- Non-fatal: CSS collection failure, text segment failures, export failure.
- Warnings (output field): only truncation, inferred auto layout presence, and depth-cap.

## Performance notes

- Single-pass CSS collection per node.
- Asset export is planned and executed once.
- Token detection is string-based and bounded by truncation.
- Token detection avoids a second scan after rewrites.
- Skip CSS collection for vector-root descendants and plugin-rendered subtrees.
- Variable candidate scan is limited to bound variables and paint references (not inferred variables).
- Logging goes through `utils/log.ts` and adds `[tempad-dev]` prefix automatically.

## Variable modes and overrides

- Mode overrides are emitted as `data-hint-variable-mode="Collection=Mode;Collection=Mode"`.
- `tokens` values for multi-mode variables use keys `${collectionName}:${modeName}`.
- Collection names are assumed unique; duplicates are unsupported and should be warned.
