# get_code Cache Layer Design

## Status

Implemented on `main`.

This document describes the shipped architecture, not a speculative proposal.

## Problem the cache layer solves

`get_code` was spending too much time on repeated Figma-side reads for the same node and the same style/variable ids.
The slow part was not only `getCSSAsync()`, but the repeated follow-up reads around it:

- `fills` / `strokes`
- `fillStyleId` / `strokeStyleId`
- `effects` / `clipsContent`
- `layoutMode` / `inferredAutoLayout`
- `layoutSizingHorizontal` / `layoutSizingVertical`
- `relativeTransform` / `constraints`
- `figma.getStyleById()`
- `figma.variables.getVariableById()`

Those reads used to be spread across asset planning, extension-owned style resolution, background cleanup, layout inference, vector analysis, and token mapping.

## Implemented architecture

### Request scope only

The cache exists only for one public `get_code` request. The runtime shares it
across roots in a batch; single-root calls create their own context. A shell retry
reuses the same context. Nothing is persisted across requests.

### Package boundary

- `packages/extension` owns the request cache.
- `packages/extension` also owns the Figma style-resolution helpers used by UI codegen and `get_code`.
- A narrow `FigmaLookupReaders` interface is still used internally so cache-backed and direct Figma lookups can share the same pure paint-resolution helpers.

### Cache context

[`GetCodeCacheContext`](../../packages/extension/mcp/tools/code/cache/types.ts)
and its [factory](../../packages/extension/mcp/tools/code/cache/context.ts) own the
cache fields. The context holds raw CSS promises, plugin responses, image bytes
and dimensions, lookup readers, node semantics, overflow and vector analysis.
It also captures the token configuration and plugin for consistent output across
the request's roots.

The [runtime](../../packages/extension/mcp/runtime.ts) supplies the shared context
to the [code pipeline](../../packages/extension/mcp/tools/code/index.ts). Variable
discovery, plugin preparation, asset planning, collection, style preparation and
vector export reuse it. Processed styles remain specific to each root: collection
copies raw CSS before applying layout and token transformations.

### Lookup readers

[`FigmaLookupReaders`](../../packages/extension/utils/figma-style/types.ts) lets
style resolution use either direct or cached lookups. The request-backed readers
deduplicate style and variable IDs, including missing results. Text-range bindings
are cached by node, start/end and field; direct readers may omit that optional hook.

### Node semantics

`NodeSemanticSnapshot` is a lazy read-through cache keyed by `node.id`.

It preserves:

- paint arrays as `missing | unsupported | array`
- fill/stroke style ids
- derived booleans such as visible fill/stroke, renderable stroke, image fill, visible effects
- explicit and inferred layout fields
- clipping and mask state
- geometry fields needed by positioning helpers

The important part is that unsupported values stay unsupported.
The cache records what Figma returned; it does not synthesize alternate semantics.

### Paint-style summaries

`PaintStyleSummary` stores:

- raw style paints
- visible paint count
- single visible paint
- single visible solid paint

It intentionally does not cache gradient strings by `styleId` alone.
Gradients still depend on the current node size and are resolved at the call site from cached raw paints plus the current width/height.

### Vector analysis

Vector color-model detection now reuses:

- cached node semantics for paint/effect/mask state
- cached paint-style summaries for single-solid style-backed channels
- cached variable lookups for variable-backed solid colors

Per-root vector analysis results are cached in `ctx.vectorAnalysis`.

## Metrics and tracing

[`CacheMetrics`](../../packages/extension/mcp/tools/code/cache/types.ts) defines
optional request counters. In dev builds, `get_code` logs stage timings. When the
context is created with `metrics: true`, traces also include node, style,
paint-style, variable, text-range and vector-analysis hit/miss counts and the
vector export result breakdown.

This keeps performance investigation architectural instead of adding throwaway trace code to each pass.

## What this design does not do

- No cross-request caching.
- No caching of final markup or CSS maps.
- No caching of `getCSSAsync()` across requests.
- No per-pass one-off caches that duplicate the central request context.

Within one request, raw `getCSSAsync()` promises are shared by node ID, including
plugin preparation, overlapping roots and shell retries. Collection still checks
cancellation before and after awaiting them; it does not cache processed styles.
Regression fixtures enforce one raw read per collected node, zero CSS reads for
skipped descendants, isolated processed styles and fresh reads on later requests.
Repeated layout-semantic access produces one cache miss followed by hits per node.

## Current limitations

The request cache removed a large amount of duplicate lookup work, but the next real bottlenecks are now clearer:

- `collectNodeData()` still dominates large selections.
- `NodeSemanticSnapshot` currently reads paint, layout, and geometry together on first miss.
- The descendant-text preflight now avoids full collection and asset/export work when text alone
  proves the response cannot fit. Overflow caused by markup, token metadata, or formatted response
  overhead still falls back after full collection.

## Next work

The next useful optimization steps are:

1. Split node semantics into lazier paint/layout/geometry buckets.
2. Add finer-grained `collect` trace stages, especially around `getCSSAsync()` and per-node post-processing.
3. Measure markup-heavy and vector-heavy overflow fixtures that the text preflight cannot prove, then
   decide whether a safe second checkpoint can skip export without guessing final output.
4. Measure the bounded two-root vector export batches on realistic vector-heavy fixtures before
   changing that cap; preserve the current source-order merge if the cap changes.
