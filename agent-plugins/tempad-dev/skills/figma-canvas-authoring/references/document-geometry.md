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

## Transform, masks, and native state

- `figma.name` sets the display-layer name; `data-key` remains identity.
- `locked` and `aspectRatioLocked` set native interaction state.
- `relativeTransform` is a complete native 2×3 unit-axis transform. Width and
  height carry scale. Do not combine it with `rotate-*`.
- `stroke` carries weight(s), alignment, caps, joins, miter, and dashes.
- `corners` carries radius/radii and smoothing.
- `mask` is `"ALPHA"`, `"VECTOR"`, `"LUMINANCE"`, or `null`.

Put a mask before the siblings it masks, keep the mask group in one dedicated
frame, and describe every direct sibling during an update. A non-null mask
must have at least one following sibling. Omission preserves mask state; null
disables it.

Use `{ "ref": "…" }` for catalog resources nested in advanced native state.
Use `sourceCanvasKey` or `{ "canvasKey": "…" }` for same-result forward node
references. Never insert raw Plugin API calls.
