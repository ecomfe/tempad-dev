# Document and native geometry

Use `native[key].figma` only for state HTML and classes cannot express honestly;
it remains declarative desired state.

## Contents

- [Pages and containers](#pages-and-containers)
- [Shapes and vectors](#shapes-and-vectors)
- [Transforms, masks, and native state](#transforms-masks-and-native-state)

## Pages and containers

Top-level `page` can set a name, exact zero-based document index, solid RGBA
background, ordered guides, and explicit variable modes. Page-only create uses
a new `pageKey` plus name. Page-only update uses
an exact `id` or `pageKey` and omits markup. A create root may target an existing
or new page directly; creating pages and writing nodes preserve the user's current
page and viewport. Do not activate a page merely to write there.
Markup updates stay on the target node's page.

Use top-level `mode: "activate"` with exact page identity when editor context or
selection matters; `selection: []` clears selection. Use top-level `mode:
"remove"` with an owned `pageKey` to delete a page. Page deletion rejects the
last page, manual or unowned content, and surviving external dependencies.

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

Use exact uppercase `M L Q C Z` paths for already-decided custom vector
geometry. Selected icon roles use sourced SVG through [icons.md](icons.md), not
remembered paths. Use a vector network only for branching segments, per-vertex
state, or region-specific fills or styles. Never provide both. New vectors need
geometry; omission preserves it on update and an empty path or network clears
it.

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
- Beta 3D properties require extension 1.1.0 or later. MCP 1.0.3 already supports
  their transport; MCP 1.0.4 adds sparse readback tool guidance.
  `transform3d` is independent of layout, size, and `relativeTransform`.
  Use `{ "type": "FIXED_ORDER", "translateZ": 40, "rotateX": 0,
  "rotateY": 30, "rotateZ": 0 }`: all four numeric fields are required,
  Z translation is in pixels, and rotations are in degrees, applied in that
  CSS order. Optional `backfaceVisible` and `visible` default to `true`.
  `visible: false` retains disabled settings; `{ "type": "NONE" }` clears them.
  Imported `FREEFORM` transforms can be read but cannot be assigned.
- Beta `transformOrigin` supplies both axes, for example
  `{ "x": { "unit": "PERCENT", "value": 0 },
  "y": { "unit": "PIXELS", "value": 20 } }`.
- Beta `scene3d` on a Frame, Component, or Instance is
  `{ "perspective": 800, "preserve3d": true }`. Negative perspective disables
  perspective; `visible: false` disables perspective while retaining its value
  and leaves Preserve 3D active. `null` clears the scene (or opts an instance
  out of its inherited scene). Omission preserves all three 3D fields.
  A Preserve 3D container ignores its own opacity, blend, effects, and clipping;
  use a flat ancestor when those must apply to the whole scene.
- `stroke` carries weights, alignment, caps, joins, miter, and `dashPattern`.
- `corners` carries radii and smoothing.
- `mask` is `"ALPHA"`, `"VECTOR"`, `"LUMINANCE"`, or `null`.

Place a mask before masked siblings inside one dedicated frame and describe all
direct siblings on update. A non-null mask needs a following sibling. Omission
preserves mask state; `null` disables it.

After changing a mask, layout grid, frame guide, or 3D state, call `get_structure` with
`options.native: true` on the smallest relevant root. Verify `native.mask` and
sibling order, or returned `native.layoutGrids` and `native.guides`; desired
bindings alone are insufficient. For 3D state inspect `native.transform3d`,
`native.transformOrigin`, and `native.scene3d`. Readback is sparse, independently
per field: `NONE`, the default `50% 50%` origin, and null/default scenes
(`perspective: -1`, `preserve3d: false`, visibility omitted or `true`) are omitted.
Configured transforms, including all-zero transforms, and nondefault scenes
remain readable when disabled with `visible: false`. Empty `native` blocks are
omitted too. Missing fields mean no nondefault value was serialized; the field
may be default/cleared or unavailable on that node/runtime. Absence alone proves
neither API support nor a successful clear. For clears, rely on successful
`apply_canvas` native verification, which reads full values. Unlike readback,
omitting a field from an authoring request preserves its live value.

Use `{ "ref": "…" }` for catalog resources nested in native state and
`sourceCanvasKey` or `{ "canvasKey": "…" }` for same-result forward node
references. Never insert raw Plugin API calls.
