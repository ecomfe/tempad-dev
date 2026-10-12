# Author local variables

Use this reference after the representative pixel check when repeated colors
may carry shared semantic roles, or when the user or resolved system plan
requires local variables. Do not extract tokens from an ordinary screen. New
resources need no catalog; send `catalogId` only for deliberate nested
`{ "ref": "…" }` reuse.

## Contents

- [Decide from real roles](#decide-from-real-roles)
- [Author variables](#author-variables)
- [Bind and verify](#bind-and-verify)
- [Update and remove](#update-and-remove)

## Decide from real roles

After any selected representative component reconciliation and before
propagation, call full `get_code` with unresolved tokens only when repeated
colors plausibly represent semantic roles whose coordinated maintenance matters.
Treat `literalClusters` as candidate locations, not a to-do list. Select a role
only when concrete consumers should evolve together; split mixed roles even
when their literal values match. Leave incidental, local, and ambiguous
repetition literal. If the diagnostic is unavailable, do not infer a system
from repetition.

For each selected role, map concrete consumer and field to a semantic variable
key, bind every representative consumer, then re-run once to confirm the role is
exposed through `tokens` and no longer unresolved. A non-empty
`literalClusters` result is acceptable.

Carry only selected mappings into propagation. A later apply that includes a
consumer of a selected role must bind that field in the same call; an inherited
instance binding does not cover sibling literals. Before finalization, scan each
materially distinct dependent root that uses a selected role once, fix missing
bindings for those roles, and recheck only changed roots. Do not create variables
to empty diagnostics, expand the map from literal equality, or repeat scans after
the selected roles are verified.

## Author variables

Copy this recipe and change its design facts. Collection and variable authoring
keys persist file-wide and are neither names nor IDs. Choose one
collision-resistant prefix for the independent system; recover existing exact
keys when intentionally updating it. Mode keys are collection-scoped.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"card\" class=\"flex flex-col w-[320px] h-[200px] gap-[16px] p-[24px] bg-[#FFFFFF]\"><span data-key=\"card/title\" class=\"w-fit h-fit text-[20px] font-semibold\">Account</span></div>",
  "variableCollections": {
    "product/theme": {
      "name": "Theme",
      "modes": {
        "light": { "name": "Light" },
        "dark": { "name": "Dark" }
      },
      "variables": {
        "product/color/surface": {
          "name": "Color/Surface",
          "type": "COLOR",
          "scopes": ["ALL_FILLS"],
          "values": {
            "light": { "r": 1, "g": 1, "b": 1 },
            "dark": { "r": 0.08, "g": 0.09, "b": 0.11 }
          }
        },
        "product/space/md": {
          "name": "Spacing/Medium",
          "type": "FLOAT",
          "scopes": ["GAP"],
          "values": {
            "light": 16,
            "dark": 16
          }
        }
      }
    }
  },
  "native": {
    "card": {
      "variables": {
        "fill": { "variableKey": "product/color/surface" },
        "gap": { "variableKey": "product/space/md" }
      },
      "variableModes": {
        "product/theme": "dark"
      }
    }
  }
}
```

A new collection needs `name` and at least one named mode. Each variable needs
`name`, `type`, and a value for every mode. Types are `BOOLEAN`, `COLOR`,
`FLOAT`, and `STRING`. Values may alias another variable:

```json
{ "variable": { "variableKey": "…" } }
```

Valid scopes:

- general: `ALL_SCOPES`, `TEXT_CONTENT`, `CORNER_RADIUS`, `WIDTH_HEIGHT`, `GAP`,
  `OPACITY`;
- color: `ALL_FILLS`, `FRAME_FILL`, `SHAPE_FILL`, `TEXT_FILL`, `STROKE_COLOR`,
  `EFFECT_COLOR`;
- numeric effect/stroke: `STROKE_FLOAT`, `EFFECT_FLOAT`;
- typography: `FONT_FAMILY`, `FONT_STYLE`, `FONT_WEIGHT`, `FONT_SIZE`,
  `LINE_HEIGHT`, `LETTER_SPACING`, `PARAGRAPH_SPACING`, `PARAGRAPH_INDENT`.

Use `STROKE_COLOR`, not `ALL_STROKES`. Combine neither `ALL_SCOPES` with other
scopes nor `ALL_FILLS` with `FRAME_FILL`, `SHAPE_FILL`, or `TEXT_FILL`;
`ALL_FILLS` may coexist with a non-fill scope such as `STROKE_COLOR`.

## Bind and verify

Bind through `native[key].variables` using the exact supported field, such as
`fill`, `stroke`, `gap`, `paddingTop`, `width`, `visible`, `fontSize`, or
`characters`. Retain a matching literal class when Figma needs an initial paint
or numeric fallback.

Bind each variable to representative fields performing its semantic role.
Prefer `GAP` for shared gaps/padding, `WIDTH_HEIGHT` for semantic control/icon
sizes, and `CORNER_RADIUS` for shared radii. Do not tokenize viewport dimensions,
one-off crops, content-derived geometry, or optical corrections merely because
numbers repeat.

A representative binding proves usability, not complete coverage. Bind every
consumer intended to evolve with the role; keep equal peer literals only when
incidental or independently owned.

`apply_canvas` reports `unbound-created-variable` when a new variable lacks a
same-result consumer. Bind it to a real consumer or remove it. A staged warning
may be temporary, but final delivery must show a native binding; equal literals
do not count.

`variable-fallback-mismatch` means a bound literal matches none of the
same-call variable's direct or aliased mode values. Align the fallback with a
real mode or bind the variable that owns the value, or the binding will silently
change the declared markup.

## Update and remove

After changing a variable value, update and verify every intended consumer that
cannot carry a native binding, such as `figma.svg.color`; omission leaves its
old literal in place.

Omission preserves managed state. Top-level `null` removes a managed variable,
mode, or collection only when absence is required and all consumers are cleared
or removed in the same result. Never mutate remote resources, invent parent
collections or library keys, or build a broad token system for one screen.
Extended collections must inherit a real local or catalog collection and obey
plan limits.
