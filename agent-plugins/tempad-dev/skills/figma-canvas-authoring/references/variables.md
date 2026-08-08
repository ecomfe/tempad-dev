# Author local variables

Use this reference only when the user explicitly requests a local variable or
design-system extension that needs one. Do not extract tokens from an ordinary
screen. New local resources do not require a catalog; use `catalogId` only when
a nested `{ "ref": "…" }` deliberately reuses an existing catalog resource.

## Contents

- [Author variables](#author-variables)
- [Bind and verify](#bind-and-verify)
- [Update and remove](#update-and-remove)

## Author variables

Copy this complete recipe and change its design facts. Collection and variable
authoring keys persist file-wide so later calls can recover the same resources;
they are not Figma names or IDs. Before the first write, choose one
collision-resistant prefix for this independent system and reuse it across
calls. A generic product prefix may already belong to another system in the
file; when intentionally updating one, recover its exact keys instead. Mode
keys are scoped to their collection.

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

A new collection needs `name` and at least one named mode. A variable needs
`name`, `type`, and a value for every mode. Types are `BOOLEAN`, `COLOR`,
`FLOAT`, or `STRING`. Values may alias another variable with
`{ "variable": { "variableKey": "…" } }`.

Variable scopes use only these exact values:

- general: `ALL_SCOPES`, `TEXT_CONTENT`, `CORNER_RADIUS`, `WIDTH_HEIGHT`, `GAP`, `OPACITY`;
- color: `ALL_FILLS`, `FRAME_FILL`, `SHAPE_FILL`, `TEXT_FILL`, `STROKE_COLOR`, `EFFECT_COLOR`;
- numeric effects and strokes: `STROKE_FLOAT`, `EFFECT_FLOAT`;
- typography: `FONT_FAMILY`, `FONT_STYLE`, `FONT_WEIGHT`, `FONT_SIZE`, `LINE_HEIGHT`,
  `LETTER_SPACING`, `PARAGRAPH_SPACING`, `PARAGRAPH_INDENT`.

Use `STROKE_COLOR` for a stroke color; `ALL_STROKES` is not a valid scope.
`ALL_SCOPES` cannot be combined with another scope. `ALL_FILLS` cannot be
combined with `FRAME_FILL`, `SHAPE_FILL`, or `TEXT_FILL`; it may coexist with a
non-fill color scope such as `STROKE_COLOR`.

## Bind and verify

`native[key].variables` binds variables by their file-wide authoring key. Use the exact supported
field name, such as `fill`, `stroke`, `gap`, `paddingTop`, `width`, `visible`,
`fontSize`, or `characters`. Keep the matching literal class when Figma needs
an initial paint or numeric fallback.

When a design system is requested, authoring the definition is only half of the
contract. Bind each variable to the representative component or screen fields
that express its semantic role. Prefer `GAP` variables for recurring gaps and
padding, `WIDTH_HEIGHT` for repeated semantic control or icon sizes, and
`CORNER_RADIUS` for repeated radius roles. Do not turn viewport dimensions,
one-off media crops, content-derived geometry, or isolated optical corrections
into global tokens merely because their numbers repeat.

A representative binding proves that the variable is usable, but does not
finish an intended shared role by itself. Once the role is chosen, bind the
concrete consumers meant to change with it; leave a peer literal only when its
similar value is incidental or the peer intentionally owns a different role.

`apply_canvas` warns when a variable created by that call has no reference in
the same desired result. Treat `unbound-created-variable` as unfinished
design-system work: bind the variable to a real consumer or remove it. A staged
definition may temporarily warn, but the final delivered composition must close
the warning and demonstrate the native binding; an equal literal is not enough.

It also reports `variable-fallback-mismatch` when a literal property bound to a
variable authored in the same call matches none of that variable's direct mode
values, including values reached through same-call aliases. Align the literal
fallback with a real mode or bind the variable that actually owns the value;
otherwise the native binding silently changes the declared markup result.

## Update and remove

Omitted fields preserve managed resource state. A top-level `null` removes a
managed variable, mode, or collection only when the user explicitly requires
absence and every live consumer is cleared or removed in the same result.
Never mutate remote resources, invent a parent collection or library key, or
create a broad token system for a one-off screen. Extended collections must
inherit from a real local or catalog collection and remain subject to plan
limits.
