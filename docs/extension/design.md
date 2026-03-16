# MCP get_code - design

This document describes the implementation design for MCP `get_code` in `packages/extension/mcp/tools/code`. It aligns with the requirements and reflects the current pipeline, including the request-scoped cache layer used to dedupe slow Figma reads within a single request.

## High-level pipeline

1. **Validate selection**
   - Exactly one visible root node required.
   - Build a visible tree with depth capping.

2. **Create request-scoped lookup context**
   - Create a `GetCodeCacheContext` near the existing variable cache.
   - Build variable mappings from the raw selected roots, using shared lookup readers backed by that request context.

3. **Plan assets and plugin overrides**
   - Plan vector roots (vector-only containers) and mark their descendants for skipping.
   - If a plugin is enabled, pre-resolve plugin components for instances.
   - When a plugin returns component/code, skip collecting its descendants and reuse the cached plugin output in render.

4. **Collect data**
   - `collectNodeData()`
     - `getCSSAsync()` once per node (skipped nodes are excluded).
     - `getStyledTextSegments()` for text nodes.
     - Resolve fill/stroke style-backed CSS through shared lookup readers instead of issuing new ad hoc style/variable lookups per pass.
     - Preprocess styles (clean background, expand shorthands, merge inferred layout, infer resizing, apply overflow).
     - Apply positioning (auto layout absolute, constraints).
     - Replace image fills with uploaded assets.

5. **Normalize variables and sanitize styles**
   - Normalize variable names and codeSyntax to a canonical form.
   - Capture variable usage candidates for token detection.
   - Patch known layout issues (negative gap).
   - Ensure layout parents are `position: relative` when children are absolute.

6. **Build layout-only styles**
   - Extract layout-related CSS into a secondary map for SVG external layout.

7. **Export assets**
   - Export SVGs/images only once per planned asset.
   - Vector planning and themeable-color classification share the same request cache and paint/effect semantics helpers to avoid drift between asset eligibility and color-model detection.

8. **Render markup**
   - Render nodes into JSX/HTML component tree.
   - Emit `<svg data-src="...">` placeholders when applicable; inline SVG only as a degradation path when asset upload fails after export.
   - Apply Tailwind class conversion.
   - Reorder flex/grid siblings by position (see “Sibling ordering”).

9. **Token pipeline**
   - Detect token references in output code.
   - Apply plugin transforms to token names.
   - Rewrite code with transformed token names.
   - Build a single `tokens` map (direct + alias-chain tokens).
   - When `resolveTokens` is true, resolve per-node (mode-aware) before final render.
   - The resolve rerender applies to both collected node styles and themeable vector-placeholder root presentation styles so emitted vector color evidence stays in sync with token resolution.

10. **Enforce budget and finalize output**
    - Validate output size using a shared `CallToolResult` UTF-8 byte budget (`64 KiB` by default).
    - If over budget, prefer a shell response for the current node.
    - v1 shell fallback is correctness-first: it reuses the already-collected tree/style context rather than trying to re-run a shell-only collection path.
    - Emit warnings for inferred auto layout, depth-cap, and shell guidance.
    - If tree depth was capped, include a `depth-cap` warning with capped node ids.
    - If a shell response is returned, list omitted direct child ids in an inline comment in render order and expose the next recommended `get_code` call via `warnings.data`.

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
  - May be promoted into emitted flex/padding/gap output.
  - Once emitted, that auto-layout is treated as the authoritative flow model for non-absolute children in the current response.
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
- `canonicalizeAutoLayoutStyles`
  - Only runs on proven single-child auto-layout containers.
  - Resolves each axis as fixed/hug/fill/absolute/unknown.
  - Removes only redundant size or padding expressions without changing the emitted flow model.
- `ensureRelativeForAbsoluteChildren`

## Request-scoped cache layer

### Purpose

- Reduce repeated Figma property reads and lookup calls during a single `get_code` execution.
- Keep output semantics unchanged by centralizing reads instead of adding pass-specific memoization.

### Boundary

- The cache context lives only in `packages/extension`.
- Shared helpers in `packages/shared` only receive a narrow `FigmaLookupReaders` interface.
- Shared style and gradient resolution stay reusable outside MCP because they do not depend on an extension-local cache type.

### Cached data

- `variables`: request-scoped `Variable | null` lookup map.
- `styles`: request-scoped `BaseStyle | null` lookup map.
- `paintStyles`: `PaintStyleSummary` values containing raw paints plus size-independent facts, such as visible paint count and single-solid-channel analysis.
- `nodeSemantics`: lazy `NodeSemanticSnapshot` values keyed by `node.id`.
- `vectorAnalysis`: per-root vector color model results.
- `metrics`: optional counters used only for dev tracing.

### Node semantics snapshot

- Paint arrays are preserved as tri-state values: `missing`, `unsupported`, or `array`.
- Layout fields include explicit and inferred auto-layout information, sizing, alignment, clipping, and mask state.
- Geometry includes `relativeTransform` and `constraints` so positioning helpers do not need to re-read live Figma nodes.

### Consumers

The request context is threaded through:

- variable mapping
- asset planning
- CSS/style collection
- background cleanup and layout inference
- auto-layout canonicalization
- vector color analysis
- asset export

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
- Vector containers can be converted to a single SVG when their subtree is vector-like and the container itself does not carry wrapper semantics such as its own fill/stroke/effects/clipping or design-component hints.
- Themeable vectors are single-color vectors that can safely use one contextual color channel. The current implementation keeps node-sized `width`/`height` plus `viewBox`, uploads the SVG asset, and injects the instance color onto the emitted placeholder `svg` root markup.
- Fixed-color vectors preserve their internal palette in the uploaded SVG asset.
- Plugin/component output short-circuits vector export for that subtree.
- Placeholder SVG nodes receive external layout styles plus presentation color on the root markup when the vector is single-channel.
- Themeable-vector eligibility and single-channel color detection reuse shared paint/effect semantics instead of maintaining separate vector-only interpretations.
- The tool emits `<svg data-src="...">` placeholders by default for the current response. If asset upload fails after export, it falls back to inline SVG so the response still carries vector structure. Host apps may refactor to their own SVG policy, such as repo icon primitives, bundler/dev-server SVG transforms, inline SVG, or asset-backed SVG usage, as long as themeable vectors remain single-channel and fixed-color vectors keep their palette.
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
- Warnings (output field): inferred auto layout presence, depth-cap, and shell guidance.

## Output budget strategy

- `get_code` output uses a UTF-8 byte budget check on the final `CallToolResult`, not raw character count or token estimation.
- Default inline budget is `64 KiB`, measured on the serialized `CallToolResult` body (`content`, `structuredContent`, `isError`, `_meta`).
- If the formatted result exceeds budget, the tool first attempts to return a shell for the current node.
- The v1 shell algorithm omits all direct children for the current node and expects clients/agents to fetch them one by one in the order written in the inline comment.
- If a usable shell cannot be generated, the tool throws and asks clients to reduce selection scope.
- Token rewrite no longer has its own token-aware budget branch; budget enforcement happens on the finalized tool result.

## Performance notes

- Single-pass CSS collection per node.
- Request-scoped cache reuse for node semantics, style lookups, paint-style summaries, variable lookups, and vector analysis.
- Asset export is planned and executed once.
- Token detection is string-based and bounded by budget checks.
- Token detection avoids a second scan after rewrites.
- Skip CSS collection for vector-root descendants and plugin-rendered subtrees.
- Variable candidate scan is limited to bound variables and paint references (not inferred variables).
- Paint-style cache entries store raw paints and size-independent facts only; gradient strings are still resolved against the current node size at the call site.
- Logging goes through `utils/log.ts` and adds `[tempad-dev]` prefix automatically.
- In dev builds, `logger.debug` may include stage timings plus cache/export counters such as node/style/paint-style/variable hit rates and vector export result breakdown.

## Variable modes and overrides

- Mode overrides are emitted as `data-hint-variable-mode="Collection=Mode;Collection=Mode"`.
- `tokens` values for multi-mode variables use keys `${collectionName}:${modeName}`.
- Collection names are assumed unique; duplicates are unsupported and should be warned.
