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

Those reads used to be spread across asset planning, shared style resolution, background cleanup, layout inference, vector analysis, and token mapping.

## Implemented architecture

### Request scope only

The cache exists only for one `handleGetCode()` execution.
Nothing is persisted across requests.

### Shared/package boundary

- `packages/extension` owns the request cache.
- `packages/shared` only sees a narrow `FigmaLookupReaders` interface.
- Shared helpers accept readers or pure paint inputs, so non-MCP callers are still supported without importing extension internals.

### Cache context

The request creates one `GetCodeCacheContext` containing:

```ts
type GetCodeCacheContext = {
  readers: FigmaLookupReaders
  variables: Map<string, Variable | null>
  styles: Map<string, BaseStyle | null>
  paintStyles: Map<string, PaintStyleSummary | null>
  nodeSemantics: Map<string, NodeSemanticSnapshot>
  vectorAnalysis: Map<string, VectorColorModel>
  metrics?: CacheMetrics
}
```

It is created in `handleGetCode()` and threaded through:

- `buildVariableMappings()`
- `planAssets()`
- `collectNodeData()`
- `prepareStyles()`
- `exportVectorAssets()`

### Shared lookup readers

`packages/shared/src/figma/types.ts` exports:

```ts
type FigmaLookupReaders = {
  getStyleById(id: string): BaseStyle | null
  getVariableById(id: string): Variable | null
}
```

The extension-backed reader implementation dedupes request-local `figma.getStyleById()` and `figma.variables.getVariableById()` calls.

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
- single visible solid color

It intentionally does not cache gradient strings by `styleId` alone.
Gradients still depend on the current node size and are resolved at the call site from cached raw paints plus the current width/height.

### Vector analysis

Vector color-model detection now reuses:

- cached node semantics for paint/effect/mask state
- cached paint-style summaries for single-solid style-backed channels
- cached variable lookups for variable-backed solid colors

Per-root vector analysis results are cached in `ctx.vectorAnalysis`.

## Metrics and tracing

The cache layer exposes optional request metrics:

```ts
type CacheMetrics = {
  nodeSemanticHits: number
  nodeSemanticMisses: number
  styleHits: number
  styleMisses: number
  paintStyleHits: number
  paintStyleMisses: number
  variableHits: number
  variableMisses: number
  vectorAnalysisHits: number
  vectorAnalysisMisses: number
  vectorExportCandidates: number
  vectorExportSkippedMissing: number
  vectorExportSkippedZeroBounds: number
  vectorExportNull: number
  vectorExportUploaded: number
  vectorExportThemeableInline: number
  vectorExportRawInline: number
}
```

In dev builds, `get_code` trace output logs:

- stage timings
- node/style/paint-style/variable/vector-analysis cache hit rates
- vector export result breakdown

This keeps performance investigation architectural instead of adding throwaway trace code to each pass.

## What this design does not do

- No cross-request caching.
- No caching of final markup or CSS maps.
- No caching of `getCSSAsync()` across requests.
- No per-pass one-off caches that duplicate the central request context.

Within one request, `getCSSAsync()` is still called once per collected node.
The cache layer reduces the expensive reads around that call, not the safety boundary of the call itself.

## Current limitations

The request cache removed a large amount of duplicate lookup work, but the next real bottlenecks are now clearer:

- `collectNodeData()` still dominates large selections.
- `NodeSemanticSnapshot` currently reads paint, layout, and geometry together on first miss.
- Shell fallback still reuses already-collected full-tree context, so some asset/export work can still happen before a shell response is returned.

## Next work

The next useful optimization steps are:

1. Split node semantics into lazier paint/layout/geometry buckets.
2. Add finer-grained `collect` trace stages, especially around `getCSSAsync()` and per-node post-processing.
3. Revisit vector export/upload concurrency only after the cache and `collect` traces show that export is again the dominant cost.
