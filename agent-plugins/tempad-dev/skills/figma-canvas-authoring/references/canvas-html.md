# Canvas HTML and Tailwind subset

Canvas HTML is a desired-result language, not browser rendering.

Prefer the supported native Tailwind utilities below; use arbitrary pixel values only when the
result is off the default scale. Numeric spacing utilities use Tailwind v4's default `4px` unit. Theme
extensions, variants, plugins, and utilities whose meaning depends on a browser viewport or CSS
cascade remain unsupported.

This complete Direct call creates one primitive result without catalog state:

```json
{
  "mode": "create",
  "markup": "<div data-key=\"notice\" class=\"flex flex-col w-[320px] h-[112px] gap-[8px] p-[16px] bg-[#FFFFFF] rounded-[12px]\"><span data-key=\"notice/title\" class=\"w-fit h-fit text-[18px] font-semibold\">Update available</span><span data-key=\"notice/body\" class=\"w-full h-fit text-[14px] leading-[20px] text-[#4B5563]\">Restart when you are ready.</span></div>"
}
```

## Elements and identity

- Use `div`, `span`, or a component tag returned by the active catalog.
- Give every element one unique `data-key` of letters, numbers, `. / : _ -`.
- Use `data-node-id` only in update mode to adopt an exact live node.
- Use no arbitrary attributes on `div` or `span`. Common catalog links use
  `data-var-<field>="vN"` and `data-style-<field>="sN"`; `"none"` explicitly
  unlinks that field.
- A `span` contains text only. Add `whitespace-pre-wrap` when repeated spaces
  or line breaks are intentional.
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

Use `w-full` only on the cross axis of `flex-col`, `h-full` only on the cross
axis of `flex-row`, and `grow` on the main axis; use `grow-0` to clear growth. Grid children may
fill their cell. Direct width and height variables require fixed-size fallbacks. Fixed
sizes are at least `0.01px`; native lines use `h-[0px]`.

## Layout

Use Auto Layout for ordinary product UI:

- `flex flex-row` or `flex flex-col`
- `items-start|center|end|baseline`
- `justify-start|center|end|between`
- `flex-wrap`, `flex-nowrap`, `content-between`, `content-normal`
- `gap-N`, `gap-x-N`, `gap-y-N`, or exact `[Npx]`
- `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl` with `-N`, `-px`, or `-[Npx]`
- `box-border`, `box-content`

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

For deliberate freeform composition, omit layout classes and give every described child
`absolute left-N top-N`, the negative forms `-left-N -top-N`, exact `[Npx]` values, or a native
relative transform.
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

Unknown elements, attributes, classes, CSS, responsive/state prefixes, custom theme names, margins,
percentage sizing, and plugins fail closed instead of being ignored.
