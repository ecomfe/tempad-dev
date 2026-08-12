# Document and native geometry

Use `native[key].figma` only for native state that HTML and classes cannot
express honestly. This remains declarative desired state.

## Page and containers

Top-level `page` can set a name, exact zero-based document index, solid RGBA
background, ordered guides, and explicit variable modes. In create mode it may
target an existing `id`, adopt/reuse `pageKey`, or create a named page for a
missing key. Updates stay on the target node's page.

Use:

- `figma.section: { contentsHidden? }` for native canvas organization;
- `figma.group: true` for an intrinsic layer group;
- `figma.booleanOperation: "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE"`
  for non-destructive geometry.

Sections use fixed pixel dimensions and freeform children. Groups and Boolean
operations use `w-fit h-fit`; their direct children are freeform. A new group
needs one child and a new Boolean operation needs two. When supplying children
of an existing intrinsic container, describe every live direct child because
order is semantic.

Sections do not expose frame clipping, so omit `overflow-hidden` and
`overflow-visible` from a section root.

When `targetNodeId` is an existing section, keep `figma.section` on the update
root even when its native section fields are unchanged. Without that desired
root-type declaration, the markup root is a frame and the update is rejected.

## Shapes and vectors

Use a childless `div` with `figma.shape`:

- `{ "type": "RECTANGLE" }`
- `{ "type": "LINE" }`
- `{ "type": "ELLIPSE", "arc": { "startAngle", "endAngle", "innerRadius" } }`
- `{ "type": "POLYGON", "pointCount": 3 }`
- `{ "type": "STAR", "pointCount": 5, "innerRadius": 0.5 }`
- `{ "type": "VECTOR", "paths": [...] }`
- `{ "type": "VECTOR", "network": {...}, "handleMirroring": "..." }`

Use exact vector paths with uppercase `M L Q C Z` for ordinary icons. Use a
vector network only for branching segments, per-vertex state, or
region-specific fills/styles. Do not supply paths and a network together. New
vectors need geometry; omission preserves it on update and an empty
path/network clears it.

Each `paths` item is an object, not a raw path string. `windingRule` is
`"NONE"`, `"NONZERO"`, or `"EVENODD"`; use `"NONE"` for an open stroked path.
Path data uses whitespace-separated uppercase commands and numbers.

Figma normalizes path geometry to the vector node's tight bounds before the
markup dimensions are applied. Treat the childless `div`'s position and size as
the vector's final bounding box, not as a preserved coordinate viewport. When
the path must align with surrounding content, offset the `div` by the path's
minimum x/y and size it to the path's x/y spans; otherwise a partial-range path
is stretched to fill the declared box. Verify the rendered anchors after
authoring because `get_structure` reports node bounds, not path coordinates.

This complete Direct recipe creates one native editable branch curve:

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

## Transform, masks, and native state

- `figma.name` sets the display-layer name; `data-key` remains identity.
- `locked` and `aspectRatioLocked` set native interaction state.
- `relativeTransform` is a complete native 2×3 unit-axis transform. Width and
  height carry scale. Do not combine it with `rotate-*`. On a create root,
  TemPad Dev preserves rotation and skew axes but replaces translation with its
  automatic non-overlapping page placement.
- `stroke` carries weight(s), alignment, caps, joins, miter, and dashes.
- `corners` carries radius/radii and smoothing.
- `mask` is `"ALPHA"`, `"VECTOR"`, `"LUMINANCE"`, or `null`.

Put a mask before the siblings it masks, keep the mask group in one dedicated
frame, and describe every direct sibling during an update. A non-null mask
must have at least one following sibling. Omission preserves mask state; null
disables it.

After a mask, layout grid, or frame-guide change, use `get_structure` with
`options.native: true` on the smallest relevant root. Confirm the mask's
`native.mask` value and following-sibling order, or the root's returned
`native.layoutGrids` and `native.guides`; do not infer those states from the
desired binding alone.

Use `{ "ref": "…" }` for catalog resources nested in advanced native state.
Use `sourceCanvasKey` or `{ "canvasKey": "…" }` for same-result forward node
references. Never insert raw Plugin API calls.
