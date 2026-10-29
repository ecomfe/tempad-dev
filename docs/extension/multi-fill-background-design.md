# Multi-fill background resolution

This document owns the paint-order and fallback rules for converting same-node Figma fills into
CSS backgrounds. The original motivation was issue #101: multiple fills on one node should
survive export when CSS can represent them. This is an export contract, separate from the
[native canvas authoring surface](./mcp-canvas-authoring-coverage.md).

## Representation boundary

Preserve explicit fill layers rather than removing duplicates or guessing that an opaque layer
makes another redundant. Same-node fills cover the node's shape; they do not describe independent
child geometry. Do not infer top/bottom bands or flatten sibling nodes into one background.

CSS paints background images front-to-back. Only the last background layer may include a color;
`background-color` cannot contain a comma-separated list of colors or gradients. A solid paint
inside a layered stack therefore uses `linear-gradient(color, color)`. See
[CSS multiple backgrounds](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_backgrounds_and_borders/Using_multiple_backgrounds)
and [`background-color`](https://developer.mozilla.org/en-US/docs/Web/CSS/background-color).

The implementation preserves solid/gradient stacks and existing image/gradient/color shorthand.
It does not promise a lossless CSS equivalent for every Figma paint:

- Non-`NORMAL` paint blending has no complete `background-blend-mode` mapping here.
- Pattern and shader paints have no general background reconstruction path.
- Gradient synthesis alone cannot reproduce arbitrary rotated/skewed radial geometry or a
  diamond gradient. Preserve matching native CSS geometry when available; the fallback formatter's
  radial/conic approximations are not a claim of pixel equivalence.
- Text color, SVG fill/stroke, and borders are scalar or separate output channels. They do not
  gain full multi-fill support from this background resolver. Gradient-border composition has its
  own CSS constraints and is not a general Figma stroke model.

## Paint source and order

[The style resolver](../../packages/extension/utils/figma-style/style-resolver.ts) selects a
resolvable Paint style before direct node paints. Missing, invalid, or unavailable styles fall
back to the node's paints. Never combine part of a style stack with unrelated direct fills.

[Paint semantics](../../packages/extension/utils/figma-paint.ts) are shared by both codegen paths:

- A paint is renderable when it is visible, has positive paint opacity, and, for gradients, at
  least one stop has positive alpha.
- Native paints are back-to-front; CSS background layers are front-to-back. Reverse once when
  resolving paints, retaining the native index for variable bindings.
- Existing CSS layers are already in CSS order and must not be reversed again.
- A recovered `background-color` must come from the bottom renderable solid paint. A translucent
  or blended paint is not a safe substitute for that base color.

The earlier native probe on page `2772:2` established the order with reversed opaque-blue and
half-opacity-red pairs. The regression preserves that observation; it does not establish unrelated
media or gradient geometry behavior.

## Solid and gradient backgrounds

[The background resolver](../../packages/extension/utils/figma-style/gradient.ts) returns a color,
ordered layers, a request to retain native CSS, or no usable fill-derived value:

- One solid paint stays `background-color`, including its supported alpha representation.
- One gradient uses `background`.
- Multiple solid/gradient paints use ordered `background` layers, with solids represented as
  constant gradients. Duplicate and opaque-over-opaque layers remain separate.
- Hidden and zero-opacity paints do not contribute synthesized layers.

Prefer native gradient geometry over re-deriving it. Complete CSS stacks are paired with native
paints before changing colors. Matching accounts for omitted transparent paints, retained
provably transparent layers, and the four positioned linear-gradient quadrants Figma emits for
a diamond. If ownership is ambiguous, preserve native channels rather than assigning a neighbor's
geometry or clearing a separate base color.

For a matched gradient, replace stop colors while retaining its function, angle/center, stop
positions, and trailing position/size/repeat syntax. Figma's angular-gradient closure stops retain
their native colors; only matching authored stops are replaced. Variable-bound stop alpha already
belongs to the variable, so independent paint opacity is applied once through `color-mix`.
Literal stops combine their own alpha with paint opacity.

Paint-style caches contain raw paints and size-independent facts. Resolve gradient strings using
the current node dimensions, not a string cached for a differently sized consumer.

## Image and mixed backgrounds

Image mixing is implemented by preserving Figma's existing CSS stack, not by synthesizing image
geometry from the solid/gradient resolver. A value containing `url(...)` must not be classified as
a scalar color just because another layer contains `var(...)`.

Normalize Figma's synthetic `lightgray` fallback only as a standalone token in a URL layer. Do not
remove it from a URL, quoted content, or an unrelated color layer, and do not turn it into an
authored fill. Recover a safe bottom paint separately when available. A single cleaned image
shorthand can be split into image, size, repeat and position; a multi-layer shorthand retains
its coupled geometry. Crop positions may be negative, and sizes may contain two values.

The MCP [background cleanup](../../packages/extension/mcp/tools/code/styles/background.ts)
repairs matching gradient opacity within mixed stacks without dropping image layers or changing
their positions. The [media path](../../packages/extension/mcp/tools/code/assets/media.ts) then
replaces URLs with exported assets:

- Retain each visible media paint's slot, including a failed image export, so later images do not
  shift into the wrong layer.
- Match complete media stacks, or complete image-only CSS when Figma omits video URLs. Repeated
  URLs may reuse a single paint. Do not infer the geometry of a partial multi-paint stack.
- A partial stack may reuse an asset only when every candidate identifies the same native image
  and exported bytes. This does not justify reusing a candidate's Tile dimensions.
- Native image bytes retain their Figma hash. Unavailable bytes and videos use a composited node
  preview with the corresponding native identities; failed delivery falls back to a placeholder.
  A preview is not the original video or an isolated copy of each paint.
- Exact Tile periods use native image dimensions multiplied by that paint's scale when ownership
  is known. Optional dimension reads are bounded and cached; unavailable dimensions retain native
  CSS. See the [request budget](./mcp-get-code-design.md) for their lifecycle and the
  [asset strategy](./mcp-get-code-design.md#svg-and-asset-strategy) for identity.

Unexpanded shorthands and their longhand overrides stay together through serialization, preserving
order and quoted URLs. See [Tailwind output](./mcp-get-code-design.md#tailwind-output); CSS-valid
intermediate values alone are insufficient if the emitted utility is invalid or reorders overrides.

## Shared rules and caller policy

UI codegen and MCP share paint source, visibility, ordering and geometry helpers. They deliberately
retain different variable-output contracts; see
[variable output semantics](./mcp-get-code-design.md#variable-output-semantics). A style-name variable
may replace only a safely scalar style, not an entire layered background or size-sensitive gradient.

The UI resolver repairs existing background channels. MCP additionally injects missing representable
backgrounds for non-text nodes through its cleanup path. Neither path should synthesize a partially
merged image stack when CSS does not identify its geometry.

Scalar channels inspect the frontmost renderable paint without looking through a covering paint of
another type. An opaque normal front paint can supply a scalar value; a translucent or blended
multi-paint stack retains the native scalar CSS instead. This rule is separate from preserving all
layers of a background.

## Verification ownership

The owning regressions cover the boundaries above:

- [Gradient helpers](../../packages/extension/tests/utils/figma-style/gradient.test.ts) and
  [style resolution](../../packages/extension/tests/utils/figma-style/style-resolver.test.ts):
  source precedence, native order/binding indices, compact single fills, retained native channels,
  transparent paints and scalar-channel behavior.
- [Background cleanup](../../packages/extension/tests/mcp/tools/code/styles/background.test.ts),
  [variable backgrounds](../../packages/extension/tests/mcp/tools/code/background-variables-pipeline.test.ts)
  and [gradient pipeline](../../packages/extension/tests/mcp/tools/code/gradient-background-pipeline.test.ts):
  fallback-gray removal, variable base/overlay colors, opacity and native gradient geometry through
  final code generation.
- [Media export](../../packages/extension/tests/mcp/tools/code/assets/media.test.ts) and
  [background pipeline](../../packages/extension/tests/mcp/tools/code/background-pipeline.test.ts):
  asset ordering and fallback, Crop/Tile geometry, bounded optional reads and serialized output.

Follow [TESTING.md](../../TESTING.md) for required checks. Browser rendering and utility compilation
prove the fixtures' CSS behavior; they do not prove new native Figma behavior. When a change needs
new native evidence, follow the [authoring runbook](../testing/agent-authoring-evolution.md) rather
than inferring it from the fake model or old paint-order probe.
