# Multi-fill Background Resolution Design

This document analyzes issue `#101` and proposes a complete implementation strategy for background resolution when a Figma node has multiple fill paints.

The goal of this design is to preserve same-node fill intent directly. If a user explicitly configured multiple fills on one Figma node, the generated CSS should preserve that stack whenever those fills can be represented as CSS background layers.

## Summary

The current implementation assumes that background-like fill output can be reduced to one of two values:

- a single `background-color`
- a single gradient `background`

That assumption is embedded in both the shared style resolver and the extension-side MCP cleanup pipeline. As a result, the repo cannot preserve same-node multi-fill stacks as authored.

However, issue `#101` is not sufficient evidence that every visual involving "multiple layers" should be solved by emitting multiple CSS background layers:

- the screenshot attached to the issue shows two fill entries on the same node, both named `bg/secondary`
- the screenshot does not show separate child geometry
- the issue does not prove that the visual comes from separate child geometry rather than same-node fills

The recommended direction is:

1. treat same-node multi-fill support as an authoring-intent feature
2. preserve the ordered fill stack whenever it is representable as CSS background layers
3. avoid heuristic collapse based on opacity or inferred visual equivalence

In practical terms, this means the implementation should distinguish between:

- author-authored Figma fills, which should be preserved
- API-introduced fallback tokens from `getCSSAsync()`, which should be normalized away before stack preservation

## Research Findings

### 1. CSS constraints

Official references:

- [MDN: `background-color`](https://developer.mozilla.org/en-US/docs/Web/CSS/background-color)
- [MDN: Using multiple backgrounds](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_backgrounds_and_borders/Using_multiple_backgrounds)

Relevant constraints:

- `background-color` accepts a single `<color>` value.
- Multiple background layers are expressed through comma-separated background image layers.
- In a multi-background stack, the first listed layer is painted on top and the last listed layer is at the back.
- Only the last background may include a `background-color`.

Implications for this repo:

- `background-color: color1, color2` is invalid CSS.
- When multiple pure-color layers must be represented as independent background layers, a solid color must be encoded as an image-like layer, for example `linear-gradient(color, color)`.
- Position keywords such as `top` and `bottom` do not create independent geometric regions by themselves. Without explicit size and repeat control, they do not reproduce a top-half / bottom-half split.
- Existing `background` / `background-image` values that contain image layers must not be merged blindly with inferred fill layers unless the ordering semantics are explicitly defined.

### 2. Figma constraints

Official reference:

- [Figma plugin docs: `fills`](https://developers.figma.com/docs/plugins/api/properties/nodes-fills/)

Relevant constraints:

- `fills` is `ReadonlyArray<Paint> | figma.mixed`.
- Fills are paints applied to the shape area of a node.
- Fills can differ by visibility, opacity, gradient stops, and blend mode.
- The `fills` property itself does not provide independent rectangle geometry for separate top/bottom regions on a single node.
- The repo already relies on Figma paint visibility semantics in multiple places; multi-fill support should reuse those semantics instead of introducing a second interpretation.

Implications for this repo:

- Multiple solid fills on one node are full-node layers, not independently positioned rectangles.
- If the visual in a Figma design is created by separate child layers, the fix is a tree/rendering change, not a background-layer change.
- If the visual comes from same-node fills, CSS background layering can only preserve the subset that is representable as full-node background layers.

### 3. Diagnosis of issue #101

Issue `#101` currently contains an ambiguous problem statement:

- The body says the object has two colors on separate layers.
- The attached screenshot shows two fill entries on one node, both named `bg/secondary`.
- The expected CSS in the issue is invalid because it places gradients in `background-color`.

Based on the available evidence, the safest interpretation is:

- the issue is about multiple fills on the same node, not about multiple child layers
- the expected CSS in the issue body is invalid, but the product request itself is reasonable

Therefore, `#101` should be addressed as "same-node multi-fill stacks should survive into CSS when representable", not as "try to infer whether duplicate fills matter visually".

## Current Repository Behavior

### Shared style resolver

The UI/codegen path uses:

- `packages/extension/utils/codegen.ts`
- `packages/shared/src/figma/style-resolver.ts`

Current limitations:

- `resolveGradientFromPaints()` in `packages/shared/src/figma/gradient.ts` picks the first visible gradient paint.
- `resolveSolidFromPaints()` in the same file picks the first visible solid paint.
- `ResolvedPaintStyle` in `packages/shared/src/figma/types.ts` only models one `gradient` or one `solidColor`.
- `resolveStylesFromNodeData()` rewrites fill-derived CSS channels with a single resolved result.

Impact:

- same-node multi-fill stacks are reduced to one layer
- explicit fill ordering configured in Figma is lost

### Extension MCP cleanup path

The MCP `get_code` path uses:

- `packages/extension/mcp/tools/code/collect.ts`
- `packages/extension/mcp/tools/code/styles/background.ts`
- `packages/extension/mcp/tools/code/styles/normalize.ts`

Current limitations:

- `cleanFigmaSpecificStyles()` injects at most one `background-color` or one gradient `background`
- `findVisibleSolidPaint()` uses `find()`, so it only sees the first visible solid paint
- the local gradient resolver only returns a gradient when exactly one visible paint is present
- style-backed fill summaries in the cache are optimized around `singleVisibleSolidColor`

Impact:

- even after shared resolution, MCP fallback/injection logic still cannot produce layered backgrounds

### `getCSSAsync()` fallback gray behavior

The repo already contains a compatibility rule for Figma's default gray image-fill fallback:

- shared path: `packages/shared/src/figma/style-resolver.ts`
- MCP path: `packages/extension/mcp/tools/code/styles/background.ts`

Current behavior:

- when `getCSSAsync()` produces `background: url(...) lightgray ...`
- the synthetic `lightgray` token is removed
- real fill data is used to recover the intended background color when possible

This behavior must be preserved.

Why:

- the gray token is not author intent
- it is API-generated fallback noise from `getCSSAsync()`
- multi-fill preservation must not accidentally treat that gray token as a real background layer

### Plugin component data path

The plugin component serializer in `packages/extension/utils/component.ts` already preserves multiple solid fills for vector children through `VectorNode.fills`.

This means the problem is not "the repository cannot represent multiple fills anywhere". The problem is specifically background-style generation for node CSS.

## Product Decision

The repository needs an explicit decision on what it is trying to preserve.

### Recommended decision

Preserve same-node fill intent, not only inferred rendered equivalence.

That means:

- If a node has multiple visible fills and those fills are representable as CSS full-box background layers, preserve them as separate layers.
- Do not try to collapse layers by inspecting opacity or guessing visual redundancy.
- If the effect depends on geometry outside a single full-node fill stack, do not force it into background CSS.
- Normalize API-generated fallback tokens before applying any of the above rules.

### Why this is the right default

- It matches the user's explicit configuration in Figma.
- It avoids heuristic logic that can become fragile and surprising.
- It keeps the implementation easier to reason about and test.
- It still leaves room for later optimization if the project decides to canonicalize redundant fill stacks.

## Proposed Scope

### In scope for v1

- Same-node fill stacks containing supported paint types:
  - `SOLID`
  - `GRADIENT_LINEAR`
  - `GRADIENT_RADIAL`
  - `GRADIENT_DIAMOND`
  - `GRADIENT_ANGULAR`
- Preservation of ordered same-node fill stacks.
- Shared resolver behavior used by both UI/codegen and MCP collection.
- MCP cleanup fallback when background channels are missing.

### Explicitly out of scope for v1

- Flattening sibling layers into one background.
- Deriving top/bottom/left/right subregions from same-node fills.
- Supporting image/video/pattern fill mixing in the first pass.
- Full `background-blend-mode` support for non-`NORMAL` fill blend modes.
- Changing MCP schemas or public tool contracts.

## Design Principles

1. Keep single-fill output unchanged.
2. Preserve explicit multi-fill intent when the stack is representable in CSS.
3. Do not add heuristic occlusion analysis in the first implementation.
4. Do not change public shared types unless there is a clear downstream need.
5. Treat fill order as a verified runtime behavior, not an assumption hidden in code.
6. Treat `getCSSAsync()` gray fallback cleanup as a normalization pass, not as fill intent.

## Precedence Rules

The repository already has precedence rules for resolving paints:

1. style-backed paints from `fillStyleId`, when present and resolvable
2. direct node `fills`, when style lookup is absent or unusable

The multi-fill design should preserve this precedence.

That means:

- if `fillStyleId` resolves to a paint style, the stack is built from the style paints
- otherwise the stack is built from direct node paints
- the stack is never composed by partially mixing a resolved paint style with unrelated direct fills

This keeps multi-fill behavior aligned with the current single-fill resolver semantics.

## Normalization Rules

Before preserving a fill stack, the implementation should normalize raw CSS and Figma-derived signals in a fixed order.

### Rule 1: Remove API-generated fallback gray

If `getCSSAsync()` produces `background: url(...) lightgray ...`, that `lightgray` token must be removed before multi-fill processing.

This remains true even after multi-fill support lands.

### Rule 2: Do not reinterpret fallback gray as a fill layer

The removed gray token must not become:

- a `background-color`
- a synthetic `linear-gradient(lightgray, lightgray)` layer
- part of a multi-layer `background`

Only real Figma fills may contribute background layers.

### Rule 3: Preserve existing image shorthand cleanup

When the input contains image shorthand from `getCSSAsync()`, existing shorthand cleanup must remain intact:

- preserve `background-image`
- preserve `background-size`
- preserve `background-repeat`
- preserve `background-position`

The multi-fill implementation must layer on top of this behavior rather than replacing it.

### Rule 4: Keep single-fill simplification

If normalization leaves exactly one representable fill layer:

- a single solid fill still becomes `background-color`
- a single gradient still becomes `background`

The repository should not wrap a single solid layer into `linear-gradient(color, color)` just for consistency with the multi-layer case.

## Proposed Output Rules

For same-node visible fill stacks:

1. Filter to visible paints using the existing semantics:
   - `visible !== false`
   - paint opacity must be greater than zero
   - gradient paints with all stop alpha zero are treated as invisible

2. Preserve the ordered visible stack:
   - keep every visible representable paint
   - do not collapse duplicate colors
   - do not collapse opaque-over-opaque stacks
   - exclude API-generated fallback gray from the stack entirely

3. Resolve the preserved stack:
   - zero preserved layers: no fill-derived background output
   - one preserved opaque solid layer: emit `background-color`
   - one preserved gradient layer: emit `background`
   - multiple preserved representable layers: emit comma-separated `background`

4. Encode solid layers in multi-layer output as:

```css
linear-gradient(color, color)
```

This is not used because the layer is visually a gradient. It is used because CSS background layering requires image-like layers, and a solid `linear-gradient()` is the most direct full-box representation.

## Supported and Unsupported Stack Shapes

### Supported in v1

- solid + solid
- solid + gradient
- gradient + gradient
- any number of visible representable solid/gradient fills on the same node

### Unsupported in v1

- image + solid stacks expressed as one merged CSS stack
- image + gradient stacks expressed as one merged CSS stack
- non-`NORMAL` blend mode composition
- geometry-dependent composition that would require child elements instead of one background stack

### Fallback behavior for unsupported stacks

When the visible stack is unsupported, the implementation should degrade predictably:

- preserve the current image-fill cleanup behavior
- preserve current single-layer fill resolution behavior where applicable
- do not emit partially merged multi-layer CSS with ambiguous ordering
- log or test the unsupported branch explicitly so behavior stays intentional

## Why the issue's proposed CSS should not be implemented

The expected output proposed in `#101` should not be used as the design target.

Problems with the proposal:

- it uses `background-color` with gradient values, which is invalid CSS
- it assumes same-node fills can be independently positioned as `top` and `bottom`
- it omits the size/repeat controls that would be required even if independent positioning were valid

If the intended design really contains independently positioned color bands, the source is almost certainly separate child geometry rather than multiple fills on one node.

## Implementation Plan

### Phase 1: Add layered background resolution without changing public contracts

Do not change `ResolvedPaintStyle` or MCP result schemas.

Instead, add new internal helpers for background stacks while keeping existing single-result helpers for stroke and simple fill consumers.

Recommended internal abstraction:

```ts
type ResolvedBackgroundStack =
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  | { kind: 'layers'; layers: string[] }
```

This type should remain internal to background resolution logic.

Suggested internal invariants:

- `kind: 'none'` means no usable fill-derived background signal after normalization
- `kind: 'color'` means exactly one preserved solid fill
- `kind: 'layers'` means one or more image-like layers suitable for CSS background stacking

In practice, `kind: 'layers'` should be used for:

- one preserved gradient
- multiple preserved solid/gradient layers

The caller may still simplify a single gradient to `background` output for readability.

### Phase 2: Refactor shared paint helpers into per-paint formatters

In `packages/shared/src/figma/gradient.ts`:

- keep `resolveGradientFromPaints()` and `resolveSolidFromPaints()` for backward compatibility
- extract per-paint helpers:
  - `resolveGradientPaint()`
  - `resolveSolidPaint()`
- add a new helper that resolves an ordered background stack from multiple paints

This avoids breaking current consumers while enabling stack-aware background logic.

### Phase 3: Use stack-aware logic in the shared style resolver

In `packages/shared/src/figma/style-resolver.ts`:

- replace the current fill-to-single-value rewrite in `resolveStylesFromNodeData()`
- when fill-derived background channels are being resolved, use the new stack helper instead of `ResolvedPaintStyle`
- keep the old single-value logic for:
  - `color`
  - `fill`
  - stroke handling
- keep the current `url(...) lightgray` cleanup ahead of stack resolution

Important compatibility requirement:

- if a background contains a real image layer from `getCSSAsync()`, the shared resolver must not silently interleave inferred fill layers into that image stack in v1
- mixed image/fill stack preservation is a follow-up feature, not part of the first implementation

Expected behavior:

- UI codegen immediately benefits through `resolveStylesFromNode()`
- MCP collection also benefits because `collectNodeData()` already calls `resolveStylesFromNodeData()`

### Phase 4: Use stack-aware logic in extension fallback cleanup

In `packages/extension/mcp/tools/code/styles/background.ts`:

- add local stack-aware fallback/injection logic for cases where:
  - `getCSSAsync()` omits background channels
  - MCP-specific variable formatting still needs to be derived from live paints or style-backed paints
- keep the current special handling for:
  - gradient opacity rewriting
  - `url(...) lightgray` cleanup

Important behavior requirement:

- fallback cleanup must not recreate a removed gray token as a new background layer
- fallback cleanup should only ever synthesize layers from real Figma paints

Important note:

The extension-side helper does not need to share the exact string formatter with the shared package, because the extension currently uses different variable formatting rules in this stage. What must be shared is the decision logic:

- visibility filtering
- supported paint-type rules
- layer ordering rules

### Phase 5: Preserve existing image asset behavior

Do not expand scope to mixed image + color fill stacks in the first pass.

For v1:

- leave current image-fill behavior unchanged
- only generate layered backgrounds when the preserved fill stack is composed entirely of representable solid/gradient paints

This keeps the first implementation focused and avoids reworking `replaceImageUrlsWithAssets()` and shorthand merging at the same time.

### Phase 6: Optional follow-up for mixed image/fill stacks

Only after the solid/gradient-only implementation is stable:

- define ordering rules for real image layers from `getCSSAsync()`
- define how fill-derived layers should merge with `background-image`
- update asset replacement tests accordingly

## Implementation Checklist

This checklist translates the design into a concrete execution sequence for the repo.

### 1. Shared paint helpers

Target files:

- `packages/shared/src/figma/gradient.ts`
- `packages/shared/src/figma/types.ts` if and only if an internal helper type cannot remain file-local

Tasks:

- add per-paint formatting helpers for:
  - solid paint -> CSS color expression
  - gradient paint -> CSS gradient expression
- add a stack-aware helper that resolves an ordered background stack from a paint list
- keep `resolveGradientFromPaints()` and `resolveSolidFromPaints()` available for existing consumers
- do not change MCP schemas or shared public contracts for the first pass

Definition of done:

- shared helpers can resolve one or more representable solid/gradient fills in order
- hidden paints and zero-opacity paints are excluded
- fallback gray from `getCSSAsync()` is not modeled here as a paint layer

### 2. Shared style resolver integration

Target file:

- `packages/shared/src/figma/style-resolver.ts`

Tasks:

- keep `url(...) lightgray` cleanup before any fill-stack resolution
- introduce a helper that applies a resolved background stack onto CSS channels
- preserve the existing precedence:
  - style-backed fill paints first
  - direct node fills only as fallback
- keep single-fill output compact:
  - single solid -> `background-color`
  - single gradient -> `background`
- preserve current non-background behavior for:
  - `color`
  - `fill`
  - stroke channels
- do not merge real image shorthand output with inferred fill layers in v1

Definition of done:

- UI codegen path preserves same-node multi-fill stacks for supported solid/gradient shapes
- existing image shorthand cleanup still works
- unsupported mixed image/fill stacks stay on the current behavior path

### 3. Extension MCP cleanup integration

Target file:

- `packages/extension/mcp/tools/code/styles/background.ts`

Tasks:

- add stack-aware fallback logic for live paints and style-backed paints
- preserve current handling for:
  - gradient opacity rewriting
  - `url(...) lightgray` normalization
  - shorthand splitting to `background-image`, `background-size`, `background-repeat`, and `background-position`
- ensure fallback cleanup only synthesizes layers from real Figma paints
- ensure removed fallback gray is never recreated as:
  - `background-color`
  - a synthetic solid gradient layer
  - part of a multi-layer `background`

Definition of done:

- MCP `get_code` fallback behavior matches the shared resolver's multi-fill rules
- background injection when `getCSSAsync()` omits channels can now produce layered output for supported stacks
- fallback gray never leaks into final output

### 4. Cache and data-shape review

Target files:

- `packages/extension/mcp/tools/code/cache/context.ts`
- `packages/extension/mcp/tools/code/cache/types.ts`

Tasks:

- verify whether the existing cached raw `paints` field is sufficient for stack-aware resolution
- avoid expanding cache summaries unless a concrete performance need appears
- if a cache change is needed, keep it extension-local and avoid public contract changes

Definition of done:

- stack-aware resolution can reuse cached style paints where appropriate
- no unnecessary shared contract churn is introduced

### 5. Shared tests

Target files:

- `packages/shared/tests/figma/gradient.test.ts`
- `packages/shared/tests/figma/style-resolver.test.ts`

Add tests for:

- two visible solid fills emit layered background output
- two visible identical solid fills still emit layered output
- solid + gradient emits layered output
- hidden and zero-opacity fills are excluded
- `url(...) lightgray` is stripped before fill-stack preservation
- unsupported mixed image/fill cases follow the intended fallback path

Definition of done:

- the shared resolver behavior is locked in with explicit multi-fill regression tests

### 6. Extension tests

Target files:

- `packages/extension/tests/mcp/tools/code/styles/background.test.ts`
- optionally `packages/extension/tests/mcp/tools/code/cache/context.test.ts`
- optionally `packages/extension/tests/mcp/tools/code/assets/image.test.ts` if the normalization path needs extra coverage

Add tests for:

- multi-fill fallback injection when no usable background channel exists
- style-backed paint stacks resolved through cached paints
- removed fallback gray is not reintroduced as a layer
- existing single-fill behavior remains unchanged
- image shorthand cleanup still produces the expected split properties

Definition of done:

- MCP-side behavior is aligned with shared resolver behavior
- the gray fallback branch has explicit regression coverage

### 7. Manual verification

Use a live Figma fixture to verify:

1. the visual order of `node.fills`
2. a same-node multi-fill example with at least:
   - solid + solid
   - solid + gradient
3. an image-fill case where `getCSSAsync()` emits `url(...) lightgray ...`

Definition of done:

- fill order is confirmed once and recorded by tests
- gray fallback does not appear in final generated CSS

### 8. Repository verification

Run the repo checks that match the touched files:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:run`

If only a subset is practical while iterating, the minimum useful sequence is:

- targeted shared tests
- targeted extension tests
- final full `pnpm test:run` before merge

## Affected Files

Primary implementation targets:

- `packages/shared/src/figma/gradient.ts`
- `packages/shared/src/figma/style-resolver.ts`
- `packages/shared/tests/figma/gradient.test.ts`
- `packages/shared/tests/figma/style-resolver.test.ts`
- `packages/extension/mcp/tools/code/styles/background.ts`
- `packages/extension/tests/mcp/tools/code/styles/background.test.ts`

Files that should not need contract changes:

- `packages/shared/src/figma/types.ts`
- `packages/extension/mcp/tools/code/cache/types.ts`
- MCP tool schemas in `packages/shared/src/mcp/tools.ts`

## Test Plan

Add regression coverage for both shared and extension paths.

### Shared resolver tests

Add cases for:

- two visible solid fills emit layered `background`
- two visible identical solid fills still emit layered `background`
- solid + gradient emits layered `background`
- hidden or zero-opacity fills are excluded
- `url(...) lightgray` is removed before any fill stack is built
- unsupported mixed stacks fall back to current behavior

### Extension MCP tests

Add cases for:

- missing background channels with multi-fill stacks
- style-backed fill stacks resolved through cached paints
- MCP fallback path preserving layered output
- removed gray fallback is not reintroduced as a synthetic layer
- existing single-fill cases remaining unchanged

### Manual verification

Before merging implementation:

1. Create a live Figma fixture with ordered fills.
2. Confirm the order of `node.fills` against Figma's visible stacking order.
3. Lock that order in regression tests.
4. Validate a fixture where `getCSSAsync()` emits `url(...) lightgray ...` and confirm the gray token never appears in final layered output.

This verification is required because CSS multi-background order is well-defined, but the repository should not rely on an unverified assumption about Figma fill-array ordering.

## Risks

### 1. Order mismatch

If Figma's fill array order is interpreted incorrectly, layered output will invert foreground and background paints.

Mitigation:

- verify once with a live fixture
- document the chosen order in tests

### 2. Output inflation

Always preserving multi-fill stacks will produce more verbose CSS for redundant cases.

Mitigation:

- accept this as the explicit tradeoff for preserving author intent
- keep `background-color` for single-fill nodes

### 3. Shared/extension drift

If the shared resolver and the extension cleanup path adopt different multi-fill rules, UI codegen and MCP output will diverge.

Mitigation:

- document shared decision rules in tests
- keep the extension helper behaviorally aligned even if the string formatters differ

### 4. Gray fallback regression

If the implementation treats `getCSSAsync()` fallback gray as a real fill layer, output will contain spurious backgrounds that were never authored in Figma.

Mitigation:

- keep gray cleanup as a normalization step ahead of stack preservation
- add explicit regression tests for image shorthand plus fill stacks

## Open Questions

1. Should the product preserve redundant fill-list structure even when rendered output is unchanged?

Recommended answer: yes, for same-node multi-fill stacks.

2. Do we want a second-phase design for image + translucent solid fill stacks?

Recommended answer: yes, but only after the solid/gradient-only path is stable.

3. Should non-`NORMAL` blend modes eventually map to `background-blend-mode`?

Recommended answer: yes, but that is a separate feature and should not block the first pass.

## Recommendation

Implement issue `#101` as "same-node multi-fill stacks become multiple CSS layers whenever they are representable as CSS full-box background layers".

That means:

- the fills must be on the same node
- the fills must be representable as supported CSS background layers
- all visible representable fills should be preserved in order

This gives the repository a simple and predictable rule: do not outsmart the document. If the user configured multiple fills on one node, preserve that stack instead of collapsing it based on inferred visual equivalence.

At the same time, do not preserve `getCSSAsync()` fallback artifacts as if they were authored fills. The implementation should be conservative about author intent in the right direction:

- preserve real fill stacks
- normalize away API-generated gray fallback
