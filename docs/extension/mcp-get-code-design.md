# MCP get_code - design

This design describes MCP `get_code` in `packages/extension/mcp/tools/code`. It aligns with the requirements and reflects the current pipeline, including the request-scoped cache layer used to dedupe slow Figma reads within a single request.

The Hub gives `get_code` a bounded 30-second default deadline because its codegen, vector export,
and asset work can legitimately exceed the 15-second general tool deadline on larger selections.
`TEMPAD_MCP_GET_CODE_TIMEOUT` overrides this deadline; the existing
`TEMPAD_MCP_TOOL_TIMEOUT` remains the fallback when operators set a general override.
Calls without a singular `nodeId` add the ten-second batch work window to that deadline.

`runtime.ts` snapshots exact targets through `node-reads.ts` and runs the existing single-root
pipeline sequentially. Explicit `nodeIds` and multi-selection return keyed success/error entries;
single-node calls keep their flat result. The batch formatter participates in byte checks, and
deferred roots are returned as `remainingNodeIds`. A later root that cannot fit is deferred without
triggering shell degradation from earlier roots' output. Each call starts at most eight roots and
stops starting roots after ten seconds. Screenshots use the same target and continuation handling.

One call shares raw CSS, variable, collection, consumer-value, style, and semantic lookup caches across overlapping roots.
Each root keeps its own processed styles, render context, asset registry, token map, and language.
Raw CSS is copied before preprocessing. Codegen configuration and plugin identity are fixed on the first root; all caches are discarded after the call, including before a continuation request.

For splittable roots, the extension limits tree construction and full generation together to 20 seconds, then attempts a root-only
shell with a separate 5-second limit. These extension limits are fixed; a shorter Hub override can
still expire first. The fallback shares lookup and CSS-promise caches with the original attempt,
and abort checks fence late results and prevent subsequent collection, export, and plugin batches.
A completed full or shell result wins if synchronous work finishes before its overdue timer runs;
the deadline wrapper does not recheck elapsed time after success or discard completed output.
Synchronous checkpoints cover depth selection, tree traversal (including hidden siblings),
candidate-variable scans, and collection between nodes and after text, CSS, style, and media reads.
They also run within physical-child overflow scans, per-field text-variable reads, and nested
binding/paint scans, including overflow work during semantic-cache population. Group flow and
vector positioning reuse the tree's existing inferred-layout hint without rescanning children.
Token alias resolution and plugin naming batches receive the current attempt's checkpoint;
shared token caches retain data without capturing an expired full-generation deadline.
Vector export checks the same deadline between candidates, after color analysis, and around each
export batch. Cached or immediately resolved reads cannot defer cancellation until collection or
export finishes. Media and vector helpers also check after native byte reads or exports and before
starting uploads, fallback exports, or the next fill; their fallback handlers preserve cancellation.
An incomplete tree fails without a shell; a completed tree can use the
fallback even when its last getter exhausts the full-generation budget. Checkpoints cannot interrupt
a single native getter or cancel in-flight Figma API calls. Actual leaf and vector roots retain their full-only
generation path after bounded tree construction; unbounded debug calls bypass these time limits.
A root whose descendants were depth-capped still receives the deadline even with no retained children.
A stalled root or unusable shell still fails.

## High-level pipeline

1. **Validate each root**
   - The inner pipeline receives exactly one visible root; the runtime owns node-set orchestration.
   - Select the deepest complete level within 2,000 visible nodes, then build that bounded tree
     before reading inferred layout hints. Stop the level-order preflight at the 2,001st visible
     node; retain a traversal guard for native tree changes between preflight and collection.
     Check the synchronous time budget between physical
     node visits and layout inference calls, without treating hidden layers as visible output nodes.

2. **Preflight the response budget**
   - Sum descendant text using UTF-8 bytes and stop as soon as it alone exceeds the inline budget.
   - Disable the early shell path for plugin output and unbounded debug calls because those modes
     require full-tree semantics.
   - When the preflight proves overflow, scan variables and collect styles for the root only, skip
     asset planning/export and full rendering, then emit the existing shell contract.

3. **Create request-scoped lookup context**
   - Create a `GetCodeCacheContext` near the existing variable cache.
   - Build variable mappings only from nodes in the bounded visible tree (the root alone for early
     shells), using shared lookup readers without descending into the original subtrees.
   - Pass the same readers through text-segment rendering so bound-variable and style lookups
     discovered during scanning are reused rather than read again.

4. **Plan assets and plugin overrides**
   - Plan vector roots (vector-only containers) and mark their descendants for skipping.
   - If a plugin is enabled, pre-resolve plugin components for instances.
   - When a plugin returns component/code, skip collecting its descendants and reuse the cached plugin output in render.

5. **Collect data**
   - `collectNodeData()`
     - `getCSSAsync()` once per node (skipped nodes are excluded).
     - `getStyledTextSegments()` for text nodes.
     - Resolve fill/stroke style-backed CSS through shared lookup readers instead of issuing new ad hoc style/variable lookups per pass.
     - Preprocess styles (clean background, expand shorthands, merge inferred layout, infer resizing, apply overflow).
     - Apply positioning (auto layout absolute, constraints).
     - Replace image fills with uploaded assets.

6. **Canonicalize MCP variable output and sanitize styles**
   - Rewrite supported variable-backed output into canonical CSS variable IR.
   - Capture variable usage candidates for token detection and resolution.
   - Patch known layout issues (negative gap).
   - Ensure layout parents are `position: relative` when children are absolute.

7. **Build layout-only styles**
   - Extract layout-related CSS into a secondary map for SVG external layout.

8. **Export assets**
   - Export SVGs/images only once per planned asset.
   - Export independent vector roots in bounded batches of two, using a per-root asset map that is
     merged in source order so timing cannot change response ordering.
   - Vector planning and themeable-color classification share the same request cache and paint/effect semantics helpers to avoid drift between asset eligibility and color-model detection.

9. **Render markup**
   - Render nodes into JSX/HTML component tree.
   - Emit `<svg data-src="...">` placeholders when applicable; inline SVG only as a degradation path when asset upload fails after export.
   - Apply Tailwind class conversion.
   - Reorder flex/grid siblings by position (see “Sibling ordering”).

10. **Token pipeline**

- Detect token references in the rendered component tree's styling values before serialization.
- Apply plugin transforms to token names.
- Rewrite class, style, and SVG presentation values with transformed token names. Preserve literal
  children, labels, other non-style props, and quoted CSS strings and URLs. Native inline SVG uses
  XML attributes as its styling boundary, preserving text and whitespace; literal XML text and CDATA
  are escaped for the target template syntax. Explicit plugin `raw()`
  content retains its authored code contract and is processed as code.
- Build a single `tokens` definition map from exact used variable IDs and alias dependencies, preserving all modes and aliases regardless of `resolveTokens`.
- When `resolveTokens` is true, resolve code through native `Variable.resolveForConsumer(node)` before final render. Pass the actual node for styles, text runs, and SVG presentation.
- The resolve rerender applies to both collected node styles and themeable vector-placeholder root presentation styles so emitted vector color evidence stays in sync with token resolution.
- The first render records its text-run style inputs after inheritance pruning and default resets.
  Token resolution reuses those inputs without new native reads; unchanged node, vector, and text
  styles retain the first rendered output, including failed-resolution diagnostics.
- Serialize the transformed component tree. Apply fallback removal and resolved color simplification
  at the same styling boundary so CSS-looking design text remains unchanged.

11. **Build unresolved-literal diagnostics**

- For unresolved-token full responses, inspect the canonicalized collected style map for repeated
  unbound literal colors across at least two concrete nodes.
- Normalize supported hex and rgb/rgba forms, retain bounded node/property evidence, and omit
  variable references, non-color values, single-node repeats, resolved-token calls, and shells.
- Treat equal literals as a classification lead only; the tool does not decide semantic ownership.

12. **Enforce budget and finalize output**
    - Validate output size using a shared `CallToolResult` UTF-8 byte budget (`64 KiB` by default).
    - If over budget, prefer a shell response for the current node.
    - Overflow not proven by the preflight remains correctness-first and reuses the already-collected
      tree/style context instead of rerunning the request. Preserve the full output's resolved
      language when a shell omits the plugin child that established it.
    - Emit lightweight `type + message` warnings for inferred auto layout, depth-cap, repeated
      unbound color evidence, and shell guidance.
    - If tree depth was capped, include a `depth-cap` warning that tells agents to continue with
      narrower `get_code` calls using returned `data-hint-id` values. For a root-only cap, point to
      `get_structure` to choose children without claiming a complete shell child-ID list.
    - If a shell response is returned, list omitted direct child ids in an inline comment in render order and emit a `shell` warning that points agents to that comment.

## Tree and layout semantics

### Visible tree

- Built via `buildVisibleTree`.
- Nodes include bounds, data-hints, and inferred layout hints.
- GROUP/BOOLEAN nodes are preserved for structure. GROUP chains under an explicit or inferred
  auto-layout container retain layout boxes, including nested and absolute groups.

### Layout parent resolution

- `getLayoutParent` walks up to the nearest boxed GROUP or non-GROUP/BOOLEAN ancestor.
- Native transforms use container coordinates. For a boxed GROUP parent, subtract its native
  origin before applying child constraints; nested boxes each preserve their own offset.

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
- A direct flow GROUP gets a relative box. Nested GROUP boxes use absolute placement in their
  parent box, and direct `ABSOLUTE` groups use the existing auto-layout absolute-placement rule.
  Freeform structural GROUP/BOOLEAN wrappers preserve their existing containing blocks. For paint ranking, a GROUP
  with a direct transform, filter, or backdrop-filter that already establishes a containing block can become relative
  when no insets or explicit z-index would become active. An atomic SVG export receives the
  original node's placement as a single layout item.

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

### Tailwind output

Tailwind output uses the v4 custom-property shorthand for standalone variable
references, for example `w-(--size)` and `text-(length:--font-size)`. Type hints
remain explicit where configured. Expressions and arbitrary properties retain
their bracket syntax. Internal style values remain CSS `var(...)` expressions;
token collection, renaming, and resolution use the same variable identities.

## Variable output semantics

### Product boundary

- UI codegen and MCP `get_code` intentionally use different variable-output contracts.
- Shared `figma-style` helpers are policy-neutral by default. They may repair Figma CSS artifacts, recover missing fill/stroke channels, and reconstruct omitted background data, but they must not decide whether a variable-backed value is emitted as exact `codeSyntax` or canonical CSS variable IR.
- Safe style-name variable synthesis is an explicit caller opt-in for UI/plugin codegen; MCP does not enable it.
- The shared layer should expose either neutral values or enough binding metadata for UI and MCP callers to format independently.

### UI codegen contract

- UI codegen is the human-facing export/display surface.
- If a bound variable has `codeSyntax.WEB`, UI codegen should emit that exact string as the style value.
- UI codegen does not validate, normalize, warn on, or silently fall back away from a present `codeSyntax.WEB`.
- If `codeSyntax.WEB` is absent, UI codegen may fall back to the default variable expression or literal behavior already supported by the serializer/export path.
- When a Figma `{Paint,Text,Effect}Style` is applied, a style-name CSS variable may be emitted only when one CSS value fully and safely represents that style in the current output property.
- Unsafe style references, such as multi-fill paints or gradients that require layered or size-sensitive CSS, must be resolved to concrete CSS rather than collapsed into `var(--StyleName)`.
- Differences between UI codegen output and MCP output are intentional, not bugs by themselves.

### Plugin variable transform contract

- Plugin code blocks with `transformVariable` receive a variable-oriented style map before UI/MCP-specific formatting.
- If the applied style has a safe single-value representation, the plugin path may synthesize `var(--StyleName, fallback)` from the style name whether `getCSSAsync()` emitted a CSS variable or a literal.
- Unsafe style references from `getCSSAsync()` must still resolve to concrete CSS rather than being preserved for plugin transforms.
- Current safe synthesis is limited to single visible solid paint styles for fill/stroke-like color properties. Text and effect styles must add their own safety predicates before style-name variables are synthesized.
- The plugin path still runs the full value pipeline after variable replacement; only the protected variable fragment bypasses later unit/color normalization.

### MCP `get_code` contract

- `get_code` is an agent-facing IR, not a human-facing export surface.
- When `resolveTokens` is `false`, every supported variable-backed property must emit canonical `var(--token)` output derived from variable identity rather than directly from `codeSyntax`.
- Inline `var(..., fallback)` values are not the source of truth for MCP token values; `tokens` carries token values, alias chains, and mode-specific values so code output can stay canonical.
- The same variable id must resolve to the same canonical token name across paint-derived properties, typography/text-run properties, and any future layout/effect/property families that become variable-backed.
- `codeSyntax` remains useful as source metadata and alias input for candidate discovery, rewrite bridging, and downstream export transforms, but it does not control the final emitted MCP style value.
- When `resolveTokens` is `true`, the same supported properties should resolve from canonical IR to per-node literals without changing the token identity model.
- Figma style names are not MCP token identities. A style may cause variables inside its bound paints/text/effects to be discovered, but the style name itself must not create a `tokens` entry.
- Font-face variables cannot be consumed as CSS `font-style` values. Render native text-run
  weight and style, preserving necessary normal-value overrides. Only bindings from text that
  reaches the output contribute their exact variable IDs to the existing token transform and
  definition pipeline; omitted or plugin-replaced text does not. Keep their original definitions
  and aliases without adding synthetic CSS properties or markup hints.

### Current implementation note

- UI and MCP now share variable identity and binding discovery through `packages/extension/utils/figma-variables.ts`.
- `packages/extension/utils/variable-output.ts` is the explicit output boundary:
  - UI codegen formats supported variable-backed properties with exact `WEB codeSyntax` when present.
  - MCP `get_code` formats the same supported properties as canonical CSS variable references.
- String-based token rewrites remain a compatibility/backstop pass for legacy CSS output, alias bridging, and downstream transforms.

## Request-scoped cache layer

### Purpose

- Reduce repeated Figma property reads and lookup calls during a single `get_code` execution.
- Keep output semantics unchanged by centralizing reads instead of adding pass-specific memoization.

### Boundary

- The cache context lives only in `packages/extension`.
- Shared style helpers in `packages/extension/utils` receive a narrow `FigmaLookupReaders` interface.
- Shared style and gradient resolution stay reusable outside MCP because they do not depend on an extension-local cache type.

### Cached data

- `variables`: request-scoped `Variable | null` lookup map.
- `tokens`: request-scoped collection/name lookups and raw native values keyed by consumer node ID and variable ID. Code reads traverse exact IDs and aliases without indexing all local variables. The names-only `get_token_defs` request creates its own fresh context and lazy full index.
- `styles`: request-scoped `BaseStyle | null` lookup map.
- `paintStyles`: `PaintStyleSummary` values containing raw paints plus size-independent facts, such as visible paint count and single-solid-channel analysis.
- Text range variable bindings: request-scoped results keyed by text node, character range, and
  field; the scan and formatter reuse the same binding, including null and mixed results.
- Text style formatting resolves a field's full-range binding only when the corresponding CSS
  property is present. Variable discovery still scans every supported field for token candidates.
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
- Explicit auto layout retains native child order. Geometric sorting applies to inferred flow
  children only, preserving absolute siblings in their original slots and treating horizontal wrap
  as row-major.
- Triggered only when the computed `display` is:
  - `flex` / `inline-flex` (flex ordering)
  - `grid` / `inline-grid` (grid ordering)
- Uses `absoluteBoundingBox` only (no fallback). If any child is missing a box, original order is preserved.
- Flex ordering uses the primary axis:
  - `row` / `row-reverse` → `x`
  - `column` / `column-reverse` → `y`
  - If `flex-direction` is missing, fall back to node’s `layoutMode` / `inferredAutoLayout.layoutMode`.
- Grid ordering is row‑major (`y` then `x`), with a small epsilon (~0.5px) to keep stable order for near‑ties.
- Mixed flow/absolute siblings use native child order for paint ranks, independent of inferred
  DOM ordering. Honor native reverse painting, preserve explicit z-index values, and isolate the
  parent when introducing paint ranks. Flex/grid items need no positioning change. Plain
  transparent, untransformed non-flow GROUP wrappers containing only absolute-positioned paint
  children participate in the outer paint order. Use `display: contents` only when all siblings are also transparent wrappers or
  absolute items; otherwise retain the wrapper boxes so later flow siblings do not move.
  Nested wrappers retain DOM hints, inheritance and event bubbling without introducing a
  containing block. Native NORMAL groups retain their blending boundary with `isolation: isolate`
  when they render a box and do not specify isolation; PASS_THROUGH groups remain transparent.
  SVG exports and groups with their own layout, compositing, effects or other box styling keep
  their existing representation. Groups with direct transform, filter, or backdrop-filter
  containing blocks can receive relative positioning and paint ranks when no insets or explicit
  z-index would become active; this retains their descendant geometry. When the remaining static
  groups already have stacking contexts through literal opacity below 1, `isolation: isolate`,
  or a supported non-normal `mix-blend-mode`,
  retain their positioning and place siblings at level zero in native DOM order. This preserves
  interleaved painting without rebasing absolute descendants. For structural PASS_THROUGH groups
  with bound opacity, preserve the boxes and use natural level-zero painting (`z-index: auto`)
  across their sibling sequence and nested structural groups. Prove transparent ancestor groups
  bottom-up so wrapping a bound group does not restore the negative-rank fallback. Do not add
  isolation to these groups: opacity becoming 1 must restore descendant blending with the outer
  backdrop. Keep native transforms, filters, and inert insets unchanged. Ordinary frames retain
  their own ordering rules. This works before token resolution,
  so both unresolved mode changes and literal output retain the same paint order and metadata.
  Other unpositioned structural wrappers retain the previous stacking fallback; arbitrary
  external CSS is not assumed to establish a containing block or stacking context.

## SVG and asset strategy

- Exact native image-fill assets include `figmaImageHash` so a canvas-authoring client can reuse
  the same current-file resource. If any native bytes cannot be read, the rendered bitmap fallback
  instead includes ordered unique `figmaImageHashes` for every visible image fill.
- Native video fills share one composited PNG preview per node and record their ordered unique
  current-file identities as `figmaVideoHashes`. Figma exposes the hash on each `VideoPaint` but no
  API for reading the original video bytes, so the descriptor does not present the preview as the
  source video.
- Vector-like nodes may be exported to SVG.
- Vector containers can be converted to a single SVG when their subtree is vector-like and the container itself does not carry wrapper semantics such as its own fill/stroke/effects/clipping or design-component hints.
- Themeable vectors are single-color vectors that can safely use one contextual color channel.
  Full-bounds SVG exports are mapped from Figma's baked absolute coordinates into local coordinates
  using the inverse linear transform. Node geometry replaces integer-rounded export dimensions,
  unioned with native render bounds for visible stroke/effect overflow; clipped render bounds never
  shrink the geometry box. Zero-width or zero-height geometry uses native render-bounds export
  with that export's origin. Paths remain intact. When the inverse-mapped rectangle exceeds the local node box, a node-sized
  layout wrapper positions the larger SVG viewport, preserving rotated edge strokes in external
  images as well as inline output. Asset dimensions stay in design pixels. Instance color belongs
  to the SVG root. Positioned vectors retain their relative linear transform on the layout root;
  flow vectors bake it into the asset and reserve its transformed bounding box as their flow slot.
- Fixed-color vectors preserve their internal palette in the uploaded SVG asset.
- Plugin/component output short-circuits vector export for that subtree.
- Placeholder SVG nodes receive external layout styles plus presentation color on the root markup when the vector is single-channel.
- Themeable-vector eligibility and single-channel color detection reuse shared paint/effect semantics instead of maintaining separate vector-only interpretations.
- Token paint channels compare variable IDs. A descendant token is promoted to the SVG root only when their effective mode maps match; otherwise preserve the native fixed-color asset, since cross-collection aliases can depend on any differing mode.
- The tool emits `<svg data-src="...">` placeholders by default for the current response. If asset upload fails after export, it falls back to inline SVG so the response still carries vector structure. Host apps may refactor to their own SVG policy, such as repo icon primitives, bundler/dev-server SVG transforms, inline SVG, or asset-backed SVG usage, as long as themeable vectors remain single-channel and fixed-color vectors keep their palette.
- Placeholder SVG is emitted when export fails or is unavailable, using node width/height.
- Vector-root descendants are not rendered; their CSS is not collected.

## Token pipeline (detailed)

1. Build source index from variable IDs and codeSyntax.
2. Strip fallbacks, then extract raw token names from code (boundary-aware). Include font-face
   bindings collected from the text actually emitted by this render.
3. Apply plugin transforms to names.
4. Rewrite code with transformed names (only if any rename occurs).
5. Build a single definition map from the transform's final name-to-ID mapping (direct + alias-chain tokens), always preserving modes and aliases.
6. Resolve code for each consuming node when `resolveTokens` is true. Native Figma resolution owns inherited modes and cross-collection alias traversal; known length properties override token-name heuristics, and serialized literals stay in native pixels until rendering applies the request's units and scale. Divide native opacity percentages by 100 only for that property. Unresolved opacity, font-weight and known length properties retain canonical references in dimensionally compatible `calc()` expressions, using final definition dimensions across modes and aliases. Font-weight length conversion divides by 100px then multiplies by 100; the reverse conversion for unitless definitions in length properties multiplies by 100px then divides by 100. Both avoid rounding a 1px factor during rem conversion. Length division emits a bounded `token-resolution` warning because it requires CSS typed arithmetic support; `resolveTokens:true` produces portable literals. Preserve length units on zero definitions; mixed or unknown dimensions retain the reference with a consumer-specific `token-resolution` warning.

### Pipeline guards

- If no source names exist, return early with no tokens.
- If neither code references nor rendered font-face bindings use token names, skip plugin
  transforms and defs.
- If rewrites yield no bridged ids, skip defs.

## Error handling

- Fatal: invalid selection, no renderable root, failure to build markup.
- Non-fatal: CSS collection failure, text segment failures, export failure.
- Warnings (output field): lightweight `type + message` guidance for inferred auto layout, depth-cap, literal clusters, shell fallback, `token-definition`, and `token-resolution`.
- A failed native resolution leaves its code reference intact. Missing definitions or ambiguous names never produce guessed values. Token warnings are root-local, deduplicated, and limited to three samples of at most 180 characters per type; the final formatter budget includes them.

## Output budget strategy

- `get_code` output uses a UTF-8 byte budget check on the final `CallToolResult`, not raw character count or token estimation.
- Default inline budget is `64 KiB`, measured on the serialized `CallToolResult` body (`content`, `structuredContent`, `isError`, `_meta`).
- If the formatted result exceeds budget, the tool first attempts to return a shell for the current node.
- The v1 shell algorithm omits all direct children for the current node and expects clients/agents to fetch them one by one in the order written in the inline comment.
- If a usable shell cannot be generated, the tool throws and asks clients to reduce selection scope.
- Token rewrite no longer has its own token-aware budget branch; budget enforcement happens on the finalized tool result.

## Performance notes

- Single-pass CSS collection per node.
- Request-scoped cache reuse for node semantics, style lookups, paint-style summaries, variable
  lookups, full-range text bindings, and vector analysis across scanning, collection, and render.
- Text-run token resolution reads only typography fields consumed by the rendered run; list and
  paragraph geometry continue to use the segment's native values.
- Asset export is planned and executed once.
- A descendant-text preflight can bypass descendant collection and all asset work when UTF-8 text
  alone proves the response cannot fit. Tests assert that it short-circuits before scanning the rest
  of a large synthetic tree.
- Plugin inputs are prepared four at a time, then sent in batches of at most 32 jobs with at most
  four sandbox Workers active.
- Independent vector roots export in bounded batches of two; SVG and asset ordering remains the
  source-tree order.
- Deterministic regression fixtures assert one CSS read per collected node, no CSS reads for omitted
  descendants, one semantic extraction per node across repeated layout reads, bounded plugin input
  preparation and Worker batches, and at most two active vector exports with source-order output.
  These are operation-count guards rather than machine-dependent timing benchmarks.
- Token detection is string-based and bounded by budget checks.
- Token detection avoids a second scan after rewrites.
- Skip CSS collection for vector-root descendants and plugin-rendered subtrees.
- Variable candidate scan is limited to bound variables and paint references (not inferred variables).
- Paint-style cache entries store raw paints and size-independent facts only; gradient strings are still resolved against the current node size at the call site.
- Logging goes through `utils/log.ts` and adds `[tempad-dev]` prefix automatically.
- In dev builds, `logger.debug` may include stage timings plus cache/export counters such as node/style/paint-style/variable hit rates and vector export result breakdown.

## Variable modes and overrides

- Effective root modes (including inheritance outside the export) and explicit descendant overrides are emitted as `data-hint-variable-mode="Collection=Mode;Collection=Mode"`. Only collections reachable through that root's variable candidates and aliases participate.
- `tokens` values for multi-mode variables use keys `${collectionName}:${modeName}`.
- Internal identity uses collection/mode IDs. Duplicate collection names produce a definition warning and use IDs in hints; token definitions retain the existing display-label format.
