# Document and native geometry

Use `native[key].figma` only for state HTML and classes cannot express honestly;
it remains declarative desired state.

## Contents

- [Pages and containers](#pages-and-containers)
- [Shapes and vectors](#shapes-and-vectors)
- [Transforms, masks, and native state](#transforms-masks-and-native-state)

## Pages and containers

Top-level `page` can set a name, exact zero-based document index, solid RGBA
background, ordered guides, and explicit variable modes. In create mode it may
target an existing `id`, adopt or reuse `pageKey`, or create a named page for a
missing key. Updates stay on the target node's page.

Use:

- `figma.section: { contentsHidden? }` for canvas organization;
- `figma.group: true` for an intrinsic group;
- `figma.booleanOperation: "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE"`
  for non-destructive geometry.

Sections can be canvas roots or direct children of sections; a frame cannot
contain a section. Sections require fixed pixel dimensions and freeform
children. Groups and Booleans use `w-fit h-fit` with freeform children. A new
group needs one child and a Boolean needs two. When updating an intrinsic
container's children,
describe every live direct child because order is semantic.

Sections have no frame clipping, so omit `overflow-hidden` and
`overflow-visible`. When `targetNodeId` is an existing section, retain
`figma.section` on the root or the frame-typed markup root is rejected.

## Shapes and vectors

Use a childless `div` with `figma.shape`:

- `{ "type": "RECTANGLE" }`
- `{ "type": "LINE" }`
- `{ "type": "ELLIPSE", "arc": { "startAngle", "endAngle", "innerRadius" } }`
- `{ "type": "POLYGON", "pointCount": 3 }`
- `{ "type": "STAR", "pointCount": 5, "innerRadius": 0.5 }`
- `{ "type": "VECTOR", "paths": [...] }`
- `{ "type": "VECTOR", "network": {...}, "handleMirroring": "..." }`

Use exact uppercase `M L Q C Z` paths for ordinary icons; use a vector network
only for branching segments, per-vertex state, or region-specific fills or
styles. Never provide both. New vectors need geometry; omission preserves it on
update and an empty path or network clears it.

Each path item is an object. `windingRule` is `"NONE"`, `"NONZERO"`, or
`"EVENODD"`; use `"NONE"` for an open stroked path. Path data uses
whitespace-separated uppercase commands and numbers.

Figma normalizes path geometry to tight bounds before applying markup size. The
childless `div` defines final bounds, not a preserved viewport. For alignment,
offset it by the path's minimum x/y and size it to the x/y spans; otherwise a
partial-range path stretches to the box. Verify rendered anchors because
`get_structure` returns node bounds, not path coordinates.

This Direct recipe creates an editable branch curve:

```json
{
  "mode": "create",
  "markup": "<div data-key=\"branch-frame\" class=\"w-[120px] h-[320px]\"><div data-key=\"branch\" class=\"absolute left-[14px] top-[20px] w-[90px] h-[280px]\"></div></div>",
  "native": {
    "branch": {
      "figma": {
        "name": "Branch",
        "shape": {
          "type": "VECTOR",
          "paths": [
            {
              "windingRule": "NONE",
              "data": "M 14 300 C 30 252 52 188 104 20"
            }
          ]
        },
        "fills": [],
        "strokes": [{ "type": "SOLID", "color": { "r": 0.447, "g": 0.314, "b": 0.231 } }],
        "stroke": { "weight": 2, "cap": "ROUND", "join": "ROUND" }
      }
    }
  }
}
```

## Transforms, masks, and native state

- `figma.name` sets the display name; `data-key` remains identity.
- `locked` and `aspectRatioLocked` set interaction state.
- `relativeTransform` is a complete native 2×3 unit-axis transform; width and
  height carry scale. Do not combine it with `rotate-*`. On create roots, TemPad
  preserves rotation and skew but replaces translation with automatic placement.
- `stroke` carries weights, alignment, caps, joins, miter, and `dashPattern`.
- `corners` carries radii and smoothing.
- `mask` is `"ALPHA"`, `"VECTOR"`, `"LUMINANCE"`, or `null`.

Place a mask before masked siblings inside one dedicated frame and describe all
direct siblings on update. A non-null mask needs a following sibling. Omission
preserves mask state; `null` disables it.

After changing a mask, layout grid, or frame guide, call `get_structure` with
`options.native: true` on the smallest relevant root. Verify `native.mask` and
sibling order, or returned `native.layoutGrids` and `native.guides`; desired
bindings alone are insufficient.

Use `{ "ref": "…" }` for catalog resources nested in native state and
`sourceCanvasKey` or `{ "canvasKey": "…" }` for same-result forward node
references. Never insert raw Plugin API calls.
