# Canvas HTML and Tailwind subset

Canvas HTML is a desired-result language, not browser rendering.

Class coverage is not Figma result coverage. Use the routed typed native
bindings for gradients, media, non-shadow effects, masks, transforms, exact
fonts, and rich text. Use primitive layers only when the intended result is
actually layered geometry, not as a substitute for missing browser CSS.

One `apply_canvas` markup tree may contain at most 100 elements and 12 levels.
Split larger work only at meaningful screen or section boundaries.

Prefer the supported native Tailwind utilities below; use arbitrary pixel values
only when the result is off the default scale. Numeric spacing utilities use
Tailwind v4's default `4px` unit. Theme extensions, variants, plugins, and
utilities whose meaning depends on a browser viewport or CSS cascade remain
unsupported.

## Contents

- [Elements and identity](#elements-and-identity)
- [Layout](#layout)
- [Appearance and text](#appearance-and-text)

## Elements and identity

- Use `div`, `span`, or a component tag returned by the active catalog.
- A plain `<br>` or `<br/>` inside `span` text creates a line break. For literal
  source newlines or repeated spaces, add `whitespace-pre-wrap` instead.
- Give every element one unique `data-key` of letters, numbers, `. / : _ -`.
- Use `data-node-id` only in update mode to adopt an exact live node; instance
  sublayers are not authoring targets.
- Use no arbitrary attributes on `div` or `span`. Common catalog links use
  `data-var-<field>="vN"` and `data-style-<field>="sN"`; `"none"` explicitly
  unlinks that field.
- A `span` contains text and optional line breaks only. Add
  `whitespace-pre-wrap` when repeated spaces or literal source newlines are
  intentional. A plain `&` is literal when it does not form
  a semicolon-terminated entity; supported named and numeric entities still
  decode normally.
- A component tag is childless, includes its returned `data-ref`, and accepts
  returned props plus the shared class, identity, variable, and style
  attributes.

Variable attribute names are the native field in kebab case: fill, stroke,
characters, visible, width/height and min/max bounds, gap and grid/counter
gaps, four paddings, corner radius and four corners, stroke weight and four
sides, opacity, and the whole-node font/line-height/letter-spacing/paragraph
fields. Style attributes are `data-style-fill`, `stroke`, `text`, `effect`,
and `grid`. Node-type and fallback requirements still apply.

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

Create and update markup roots require fixed width and height; fill, hug, and
grow are invalid even when the live target has a sized parent.

Use `w-full` only on the cross axis of `flex-col`, `h-full` only on the cross
axis of `flex-row`, and `grow` on the main axis; use `grow-0` to clear growth.
`grow` sets native main-axis growth but does not replace the required width and
height classes: for example, use `grow w-fit h-[3px]` for a horizontal track in
a row. Give growing text in a fixed or otherwise constrained row a meaningful
positive `min-w-*`; `grow w-fit` text can otherwise collapse before Figma
resolves the remaining width. Before applying a fixed Auto Layout frame, budget
its main axis as padding + gaps + fixed/minimum child extents so content cannot
overrun the container. Grid children may fill their cell. Direct width and height variables
require fixed-size fallbacks. Fixed sizes are at least `0.01px`; native lines
use `h-[0px]`.

## Layout

Use Auto Layout for ordinary product UI:

- `flex flex-row` or `flex flex-col`
- `items-start|center|end|baseline`
- `justify-start|center|end|between`
- `flex-wrap`, `flex-nowrap`, `content-between`, `content-normal`
- `gap-N`, `gap-x-N`, `gap-y-N`, or exact `[Npx]`
- `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` with `-N`, `-px`, or `-[Npx]`
- `box-border`, `box-content`

New Auto Layout frames use Figma's CSS-aligned model: inside strokes participate
in layout by default (`box-border`), while `box-content` explicitly excludes
them. Center and outside strokes never affect padding, spacing, or fill math,
even with `box-border`; each nested frame owns its own stroke setting. Fixed
create sizes must be large enough for opposing padding and any explicitly
included inside stroke. Figma owns the final geometry of `FILL` children,
including border-box distribution between multiple fill siblings.
Derive an exact in-flow descendant or instance size from that rendered inner
box, not from the parent's nominal size; when it should track the inner box,
prefer valid cross-axis fill. Let it exceed the inner box only as an intentional
bleed or overlap.

`justify-between` uses native Auto gap: its effective gap never becomes negative
and a single child stays at the start. Use an explicit negative native
`figma.autoLayout.itemSpacing` only when overlap is intentional. On update,
omitting `box-border` and `box-content` preserves the live frame's setting.

`hidden` and BOOLEAN component-property visibility remove an in-flow child from
Auto Layout, so gaps, sibling positions, and hug dimensions can change. For a
purely visual state that must preserve geometry, keep a fixed outer slot in the
flow and toggle only its inner child. `absolute left-[Npx] top-[Npx]` maps to
Figma's Ignore Auto Layout behavior and is appropriate for a true overlay; it
must have fixed offsets, cannot fill or grow, and surrounding content will
ignore it. Text and Auto Layout frames may still hug their own content.

For grid use:

- `grid grid-cols-N`
- optional `grid-rows-N`
- custom tracks: `grid-cols-[1fr_240px_fit-content(100%)]`
- optional `grid-flow-row` or `grid-flow-none`
- child placement: `col-start-N`, `row-start-N`, `col-span-N`, `row-span-N`
- child alignment: `justify-self-auto|start|center|end`,
  `self-auto|start|center|end`

Give a manual grid child both row and column starts or neither. Auto-flow
children use source order and cannot set explicit starts.

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

For deliberate freeform composition, omit layout classes and give every described child
`absolute left-N top-N`, the negative forms `-left-N -top-N`, exact `[Npx]` values, or a native
relative transform. A plain `div` without `flex` or `grid` is freeform even when it has only one
child; opt into `flex-row`, `flex-col`, or grid for any in-flow child, including a partial-width
fill inside a track.
An absolute child cannot grow or fill an axis. Use `static` to return an existing absolute child to
Auto Layout during an update.

## Appearance and text

Frame appearance:

- `bg-transparent|white|black`, or an exact CSS hex value
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

A new border needs both a weight and a paint source, supplied literally or by a
native binding. During update, either side may change independently; omitting
the other preserves its live value or binding.

A newly created frame is transparent when its background is omitted, including
when the frame is introduced by an update. Use an explicit background class
when the frame should render a fill.

Shared appearance:

- `opacity-N` (`N%`) or `opacity-[0..1]`, `hidden`, `visible`
- `rotate-N`, `-rotate-N`, `rotate-none`, or `rotate-[Ndeg]`
- `mix-blend-` with `pass-through`, `normal`, `darken`, `multiply`,
  `plus-darker`, `color-burn`, `lighten`, `screen`, `plus-lighter`,
  `color-dodge`, `overlay`, `soft-light`, `hard-light`, `difference`,
  `exclusion`, `hue`, `saturation`, `color`, or `luminosity`

Text:

- `font-sans`, `font-thin|extralight|light|normal|medium|semibold|bold|extrabold|black`
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

Shadow classes compile to the node's native Figma effect stack. Do not combine
them with a direct `figma.effects` binding or an Effect style on the same node;
use one source for that stack.

Unknown elements, attributes, classes, CSS, responsive/state prefixes, custom theme names, margins,
percentage sizing, and plugins fail closed instead of being ignored.
