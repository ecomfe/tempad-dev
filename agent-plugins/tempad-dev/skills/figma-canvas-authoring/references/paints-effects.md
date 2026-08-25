# Paints, effects, grids, guides, and media

Use this reference whenever the result uses a nontrivial shadow, blur, glass,
texture, noise, image paint, layered gradient material, or layout aid, including
effects expressed as Canvas HTML classes. Resolve an image or illustration's
role, subject, medium, and source through [visual-assets.md](visual-assets.md)
first. Prefer a matching catalog style; otherwise use direct native arrays.

## Catalog links

```html
<div
  data-key="card"
  data-style-fill="s1"
  data-style-effect="s2"
  data-var-stroke-weight="v4"
  class="w-[320px] h-[200px] border border-[#000000]"
></div>
```

A style owns its channel. Do not combine a non-null fill or stroke style with a
whole-node variable on the same paint. Styled strokes still need literal,
typed, or variable-bound geometry. `null` unlinks; omission preserves.

## Resolve shadow references

Named scales such as `shadow-md` are theme references, not portable geometry:

- Reuse: bind the matching catalog Effect style.
- Author: create and bind a local Effect style only when the system plan requires
  it.
- Direct: use an exact `shadow-[...]` class or typed `figma.effects` value.

Never assume Tailwind defaults or create a token only to resolve a named class.
`shadow-none`, `inset-shadow-none`, and `text-shadow-none` explicitly clear.

Treat an outer shadow's rendered halo as part of the composition. Inspect the
final PNG beyond the root edges; visible granular or noisy fringe, or a halo
that dominates the captured bounds, is a defect even when the frame itself is
intact. Preserve intended depth by tightening blur, spread, or opacity or using
smaller layered shadows, then recheck. Do not flatten established material
treatment merely to hide the defect.

## Native paint and effect stacks

`figma.fills` and `figma.strokes` support ordered solid, linear/radial/angular/
diamond gradient, image/video, Pattern, and fill-shader paints.
`figma.effects` supports ordered shadows, normal/progressive blur, noise,
texture, glass, and effect shaders.

A `SOLID` paint uses RGB `color` and optional paint-level `opacity`; only
gradient stops use RGBA colors. Keep stroke geometry, including `dashPattern`,
in `figma.stroke`, not the stroke paint.

Use the exact gradient enum and normalized RGBA stop shape; do not translate
from CSS or Plugin API names:

```json
{
  "figma": {
    "fills": [
      {
        "type": "GRADIENT_LINEAR",
        "gradientTransform": [
          [1, 0, 0],
          [0, 1, 0]
        ],
        "gradientStops": [
          { "position": 0, "color": { "r": 1, "g": 0.43, "b": 0.29, "a": 1 } },
          { "position": 1, "color": { "r": 0.16, "g": 0.09, "b": 0.24, "a": 1 } }
        ]
      }
    ]
  }
}
```

Other gradient enums are `GRADIENT_RADIAL`, `GRADIENT_ANGULAR`, and
`GRADIENT_DIAMOND`.

Omission preserves a stack; `[]` clears it. Direct stacks cannot share their
channel with a literal class, whole-node variable, or style. Use variable refs
such as `{ "ref": "v1" }` and shader refs such as `{ "ref": "h1" }`; use only
returned shader property IDs and declared value shapes.

For images, provide exactly one same-file `imageHash`, public HTTP(S) `imageUrl`,
or call-scoped `assetKey` for a full-SHA-256 Hub IMAGE asset. PNG, JPEG, and GIF
are limited to 4096×4096. For video, provide exactly one same-file `videoHash` or
public `videoUrl` for MP4, MOV, or WebM up to 100 MB. URLs must need no
credentials. Reuse `figmaImageHash`, `figmaImageHashes`, or `figmaVideoHashes`
from `get_code` only in the same file; they identify native media, not preview
bytes.

A Pattern uses exactly one existing `sourceNodeId` or same-result
`sourceCanvasKey`.

## Layout aids

Prefer a matching Grid style. Otherwise `figma.layoutGrids` declares ordered
row, column, or square grids on frames, components, sets, and instances. Use
`"AUTO"` for automatic row or column count. Do not bind `sectionSize` with
`STRETCH` or `offset` with `CENTER`.

`figma.guides` is the complete ordered X/Y guide list: omission preserves and
`[]` clears. Page guides live under `page.guides`.

For wrapping linear Auto Layout, `figma.autoLayout` may set signed
`itemSpacing`, positive or synchronized-null `counterAxisSpacing`, and
`itemReverseZIndex`. Never declare one physical gap in both classes and native
state.
