# Paints, effects, grids, guides, and media

Prefer a matching catalog style. Use direct native arrays only when no style
expresses the required state.

## Catalog links

Keep common refs on the element:

```html
<div
  data-key="card"
  data-style-fill="s1"
  data-style-effect="s2"
  data-var-stroke-weight="v4"
  class="w-[320px] h-[200px] border border-[#000000]"
></div>
```

A style owns its channel. Do not combine a non-null fill/stroke style with a
whole-node variable on the same paint. A styled stroke still needs literal,
typed, or variable-bound geometry. `null` unlinks; omission preserves.

## Native paint and effect stacks

`figma.fills` and `figma.strokes` support ordered native:

- solid paints;
- linear, radial, angular, and diamond gradients;
- image and video paints;
- Pattern paints;
- fill shaders.

`figma.effects` supports ordered shadows, normal/progressive blur, noise,
texture, glass, and effect shaders.

Omission preserves a stack; `[]` clears it. A direct stack cannot share its
channel with a literal class, whole-node variable, or native style.

Use `{ "ref": "v1" }` for nested color/effect variables and
`{ "ref": "h1" }` for a shader ID. Use only returned shader property IDs and
declared value shapes.

For images use exactly one same-file `imageHash`, HTTP(S) `imageUrl`, or
call-scoped `assetKey` declared as a full-SHA-256 Hub IMAGE asset. PNG, JPEG,
and GIF retain Figma's 4096×4096 limit. For videos use exactly one same-file
`videoHash` or HTTP(S) `videoUrl` for MP4, MOV, or WebM up to 100 MB. URLs must
be fetchable without credentials. Reuse `figmaImageHash`,
`figmaImageHashes`, or `figmaVideoHashes` from `get_code` only in the same
Figma file; these identify native media, not preview bytes.

A Pattern uses exactly one existing `sourceNodeId` or same-result
`sourceCanvasKey`.

## Layout aids

Use a catalog Grid style when one matches. Otherwise `figma.layoutGrids`
declares ordered row, column, or square grids on frames, components, component
sets, and instances. Use `"AUTO"` for automatic row/column count. Do not bind
`sectionSize` with `STRETCH` or `offset` with `CENTER`.

`figma.guides` carries the complete ordered X/Y guide list. Omission preserves;
`[]` clears. Page guides live under top-level `page.guides`.

On wrapping linear Auto Layout, `figma.autoLayout` may set signed
`itemSpacing`, positive or synchronized-null `counterAxisSpacing`, and
`itemReverseZIndex`. Do not declare the same physical gap in classes and native
state.
