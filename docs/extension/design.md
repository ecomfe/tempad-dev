# MCP get_code - Design

This document describes the implementation design for MCP `get_code` in `packages/extension/mcp/tools/code`. It aligns with the requirements and reflects the current pipeline.

## High-level pipeline

1. **Validate selection**
   - Exactly one visible root node required.
   - Build a visible tree with depth capping.

2. **Collect data**
   - `collectNodeData()`
     - `getCSSAsync()` once per node.
     - `getStyledTextSegments()` for text nodes.
     - Preprocess styles (clean background, expand shorthands, merge inferred layout, infer resizing, apply overflow).
     - Apply positioning (auto layout absolute, constraints).
     - Replace image fills with uploaded assets.

3. **Normalize variables**
   - Normalize variable names and codeSyntax to a canonical form.
   - Capture variable usage candidates for token detection.

4. **Asset planning and export**
   - Plan vector/image export at the tree level.
   - Export SVGs/images only once.

5. **Sanitize styles**
   - Patch known layout issues (negative gap).
   - Ensure layout parents are `position: relative` when children are absolute.

6. **Build layout-only styles**
   - Extract layout-related CSS into a secondary map for SVG external layout.

7. **Render markup**
   - Render nodes into JSX/HTML component tree.
   - Inject SVG content or `<img>` when applicable.
   - Apply Tailwind class conversion.

8. **Token pipeline**
   - Detect token references in output code.
   - Apply plugin transforms to token names.
   - Rewrite code with transformed token names.
   - Resolve tokens to values when requested.

9. **Truncate and finalize output**
   - Enforce payload size limits.
   - Emit warnings only for truncation or inferred auto layout.

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

## SVG and asset strategy

- Vector-like nodes may be exported to SVG.
- Vector containers can be converted to a single SVG if all leaves are vector-like.
- SVG nodes only receive external layout styles, not visual paint styles.
- Placeholder SVG is emitted when export fails or is unavailable, using node width/height.

## Token pipeline (detailed)

1. Build source index from variable IDs and codeSyntax.
2. Extract raw token names from code (boundary-aware).
3. Apply plugin transforms to names.
4. Rewrite code with transformed names.
5. Extract final used names from code.
6. Build used token metadata and (optionally) resolved values.

## Error handling

- Fatal: invalid selection, no renderable root, failure to build markup.
- Non-fatal: CSS collection failure, text segment failures, export failure.
- Warnings (output field): only truncation and inferred auto layout presence.

## Performance notes

- Single-pass CSS collection per node.
- Asset export is planned and executed once.
- Token detection is string-based and bounded by truncation.
