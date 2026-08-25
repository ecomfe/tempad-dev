# Canvas HTML and Tailwind subset

Canvas HTML describes desired state, not browser rendering. Classes do not
cover every Figma result: use routed native bindings for gradients, media,
non-shadow effects, masks, transforms, exact fonts, and rich text. Use primitive
layers only for intended layered geometry, never as a CSS substitute.

One `apply_canvas` markup tree may contain at most 160 elements and 12 levels.
This is a safety ceiling, not a target. Before calling, count the tree, include
only assets referenced by that call, and split larger work at meaningful screen
or section boundaries.

Prefer supported Tailwind utilities; use arbitrary pixels only off the default
scale. Numeric spacing follows Tailwind v4's `4px` unit. Theme extensions,
variants, plugins, viewport-dependent utilities, and CSS cascade are unsupported.

## Contents

- [Elements and identity](#elements-and-identity)
- [Layout](#layout)
- [Appearance and text](#appearance-and-text)

## Elements and identity

- Use `div`, `span`, or a component tag returned by the active catalog.
- Give every element one unique `data-key` of letters, numbers, `. / : _ -`.
- Use `data-node-id` only in update mode to adopt an exact live node; instance
  sublayers are not authoring targets.
- Use no arbitrary attributes on `div` or `span`. Common catalog links use
  `data-var-<field>="vN"` and `data-style-<field>="sN"`; `"none"` explicitly
  unlinks that field.
- A `span` contains only text and `<br>` or `<br/>` line breaks. Use
  `whitespace-pre-wrap` for literal newlines or repeated spaces. A plain `&` is
  literal unless it forms a semicolon-terminated entity; supported entities
  decode. Put flex/grid, gaps, padding, borders, corners, and box shadows on a
  parent `div`, leaving dimensions, shared appearance, and text utilities on
  the text node.
- A component tag is childless, includes its returned `data-ref`, and accepts
  returned props plus the shared class, identity, variable, and style
  attributes.

Variable attributes use kebab-case native field names: fill, stroke, characters,
visible, dimensions/bounds, gaps, four paddings/corners/stroke sides, radius,
stroke weight, opacity, and whole-node font/line-height/letter-spacing/paragraph
fields. Style attributes are `data-style-fill`, `data-style-stroke`,
`data-style-text`, `data-style-effect`, and `data-style-grid`. Node-type and
fallback rules still apply.

Every primitive needs one width and one height. Supported fixed forms are:

- default spacing: `w-N`, `h-N`, `size-N` (`N * 4px`), plus `w-px`, `h-px`, `size-px`
- default width containers: `w-3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl`
- exact: `w-[Npx]`, `h-[Npx]`, `size-[Npx]`
- hug: `w-fit`, `h-fit`
- hug both axes: `size-fit`
- fill: `w-full`, `h-full`, or `size-full` for both axes
- bounds: numeric, `px`, or arbitrary-pixel values with `min-w`, `max-w`, `min-h`, or `max-h`;
  width bounds also accept the default container names; use `min-w-none`, `max-w-none`,
  `min-h-none`, or `max-h-none` to clear a bound in an update

Text using `w-fit` also needs `h-fit`; prefer `size-fit`. Fixed-width `h-fit`
remains valid for wrapping text.

Create and update markup roots require fixed width and height; fill, hug, and
grow are invalid even when the live target has a sized parent.

Use `w-full` only on a `flex-col` cross axis, `h-full` only on a `flex-row`
cross axis, and `grow` on the main axis; `grow-0` clears growth. `grow` does not
replace required dimensions—for a row track use `grow w-fit h-[3px]`. Give
growing text in constrained rows a positive `min-w-*` to prevent collapse.
Budget fixed Auto Layout main axes as padding + gaps + fixed/minimum child
extents. Grid children may fill cells. Direct dimension variables require fixed
fallbacks. Fixed sizes must be at least `0.01px`; native lines use `h-[0px]`.

## Layout

Use Auto Layout for ordinary product UI. `flex` follows CSS's horizontal default;
use `flex-row` when that direction should be explicit and `flex-col` for a
vertical stack:

- `flex`, `flex flex-row`, or `flex flex-col`
- `items-start|center|end|baseline`
- `justify-start|center|end|between`
- `flex-wrap`, `flex-nowrap`, `content-between`, `content-normal`
- `gap-N`, `gap-x-N`, `gap-y-N`, or exact `[Npx]`
- `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` with `-N`, `-px`, or `-[Npx]`
- `box-border`, `box-content`

New Auto Layout frames include inside strokes by default (`box-border`);
`box-content` excludes them. Center/outside strokes never affect layout, and
each nested frame owns its setting. Fixed create sizes must cover opposing
padding plus included inside strokes. Figma determines `FILL` geometry and
border-box distribution. Derive exact descendant or instance sizes from the
rendered inner box, not nominal parent size; prefer valid cross-axis fill and
exceed the box only for intentional bleed or overlap.

`managed-content-overflow` means managed Text or INSTANCE exceeds its direct
managed Frame or Component, or a native INSTANCE contains descendant content
beyond its own fixed root. Inspect edges, clipping, rendering, and instance
bounds; resize or realign accidental overflow and retain only intentional bleed,
crop, or overlap. Property-driven content outside an INSTANCE root is a broken
component contract rather than intentional consumer overflow.

`justify-between` uses nonnegative native Auto gap and keeps one child at the
start. Use negative `figma.autoLayout.itemSpacing` only for intentional overlap.
Omitting box-sizing on update preserves the live setting.

`hidden` and BOOLEAN visibility remove in-flow children, changing gaps,
positions, and hug bounds. To preserve geometry, keep a fixed slot and toggle
its inner child. `absolute left-[Npx] top-[Npx]` maps to Ignore Auto Layout for
true overlays; it needs fixed offsets, cannot fill/grow, and leaves surrounding
flow unchanged. Its text and Auto Layout descendants may still hug.

For grid use:

- `grid grid-cols-N`
- optional `grid-rows-N`
- custom tracks: `grid-cols-[1fr_240px_fit-content(100%)]`
- optional `grid-flow-row` or `grid-flow-none`
- child placement: `col-start-N`, `row-start-N`, `col-span-N`, `row-span-N`
- child alignment: `justify-self-auto|start|center|end`,
  `self-auto|start|center|end`

Give manual grid children both row and column starts or neither. Auto-flow uses
source order without explicit starts. A height-hugging grid cannot use flexible
or automatic rows; fix either its height or row tracks. Omitting `grid-rows-*`
creates native automatic content-sized rows. On a fixed-height grid, declare
row tracks when children should share or fill the available height; increasing
only the container height does not enlarge automatic rows.

For a coherent board larger than one call, first create one fixed parent:

```json
{
  "mode": "create",
  "markup": "<div data-key=\"app/board\" class=\"flex flex-row items-start w-[1280px] h-[844px] gap-[24px]\"></div>"
}
```

Then append one bounded screen per update. Keep the root key and classes stable,
target its returned ID, and omit previously added children so they remain in
place:

```json
{
  "mode": "update",
  "targetNodeId": "FrameID:app-board",
  "markup": "<div data-key=\"app/board\" class=\"flex flex-row items-start w-[1280px] h-[844px] gap-[24px]\"><div data-key=\"app/home\" class=\"flex flex-col w-[390px] h-full\"></div></div>"
}
```

For freeform composition, omit layout classes and give each child `absolute`
with exactly one horizontal edge (`left-*` or `right-*`) and one vertical edge
(`top-*` or `bottom-*`), including negative or exact values, or use a native
relative transform. Edge placement needs fixed parent and child bounds. A plain
non-flex/grid `div` is freeform even with one child; opt into layout for every
in-flow child. Absolute children cannot grow or fill; use `static` to return one
to Auto Layout on update.

## Appearance and text

Frame appearance:

- `bg-transparent|white|black`, or an exact CSS hex value
- Linear backgrounds use `bg-linear-to-t|tr|r|br|b|bl|l|tl` with exact
  `from-white|black|[#hex]`, optional `via-white|black|[#hex]`, and required
  `to-white|black|[#hex]` stops. Stops are fixed at 0, optional 0.5, and 1;
  `bg-gradient-to-*` is accepted as a legacy alias. Do not combine a gradient
  with a solid background, direct fill paints, or a fill style/variable.
- `border`, `border-N`, `border-[Npx]`; use `border-x|y|t|r|b|l` with the same widths
- `border-white|black`, or an exact CSS hex value
- `rounded`, `rounded-none|xs|sm|md|lg|xl|2xl|3xl|4xl|full`, or `rounded-[Npx]`;
  prefix the value with `t`, `r`, `b`, `l`, `tl`, `tr`, `br`, or `bl` for individual sides/corners
- `overflow-hidden`, `overflow-visible`
- Exact pixel shadow lists through `shadow-[...]` or `inset-shadow-[...]`.
  Each layer needs an explicit hex, `rgb()`, or `rgba()` color and two to four
  pixel lengths; use underscores for spaces, for example
  `shadow-[0_8px_24px_rgba(0,0,0,0.16)]`.
- `shadow-none` and `inset-shadow-none` clear their class-owned effect stack.
  Theme-dependent named scales such as `shadow-md` are unsupported: use an
  explicit native style or typed effect/variable binding for a reusable token,
  or resolve the governing theme before applying and provide the exact value.

Figma accepts shadow spread only on rectangles and ellipses, or on frames,
components, and instances with a visible fill and clipping enabled.

A new border needs weight and paint, literal or bound. Updates may change either
independently; omission preserves the other.

New frames are transparent when background is omitted, including frames added
during update. On an existing frame, omission preserves its live background;
use `bg-transparent` to clear it. Set an explicit background when fill is
intended.

Shared appearance:

- `opacity-N` (`N%`) or `opacity-[0..1]`, `hidden`, `visible`
- `rotate-N`, `-rotate-N`, `rotate-none`, or `rotate-[Ndeg]`
- `mix-blend-` with `pass-through`, `normal`, `darken`, `multiply`,
  `plus-darker`, `color-burn`, `lighten`, `screen`, `plus-lighter`,
  `color-dodge`, `overlay`, `soft-light`, `hard-light`, `difference`,
  `exclusion`, `hue`, `saturation`, `color`, or `luminosity`

Text:

- `font-sans|serif|mono` resolve to an editor-available family in that category,
  preferring Inter, Noto Serif, and Noto Sans Mono
- `font-thin|extralight|light|normal|medium|semibold|bold|extrabold|black`
- `text-xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl` with their default line
  heights, `text-SIZE/N`, or `text-[Npx]`
- `leading-none|tight|snug|normal|relaxed|loose`, `leading-N`, `leading-[Npx]`,
  `leading-[N%]`, or a unitless arbitrary ratio
- `tracking-tighter|tight|normal|wide|wider|widest`, `tracking-[Npx]`,
  `tracking-[N%]`, or `tracking-[Nem]`
- `text-left|center|right|justify`
- `normal-case`, `uppercase`, `lowercase`, `capitalize`
- `no-underline`, `underline`, `line-through`
- `truncate`, `line-clamp-N`, `line-clamp-none`
- `text-white|black`, an exact CSS hex value, `whitespace-pre-wrap`
- `text-shadow-[...]` for an exact pixel text-shadow list with a color and two
  or three pixel lengths; `text-shadow-none` clears it

A `span` is one TEXT node, so `bg-*` and `text-*` share its fill channel. Put
background on a parent `div` and color on its child `span`.

Shadow classes compile to the native effect stack; never combine them with
`figma.effects` or an Effect style on that node.

Unknown elements, attributes, classes, CSS, responsive/state prefixes, custom
themes, margins, percentages, and plugins fail closed.
