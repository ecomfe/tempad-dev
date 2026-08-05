# Author local variables

Use this reference only when the user explicitly requests a local variable or
design-system extension that needs one. Do not extract tokens from an ordinary
screen. New local resources do not require a catalog; use `catalogId` only when
a nested `{ "ref": "…" }` deliberately reuses an existing catalog resource.

Copy this complete recipe and change its design facts. Collection and variable
authoring keys persist file-wide so later calls can recover the same resources;
they are not Figma names or IDs. Namespace them by product and role. Mode keys
are scoped to their collection.

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

`native[key].variables` binds variables by their file-wide authoring key. Use the exact supported
field name, such as `fill`, `stroke`, `gap`, `paddingTop`, `width`, `visible`,
`fontSize`, or `characters`. Keep the matching literal class when Figma needs
an initial paint or numeric fallback.

Omitted fields preserve managed resource state. A top-level `null` removes a
managed variable, mode, or collection only when the user explicitly requires
absence and every live consumer is cleared or removed in the same result.
Never mutate remote resources, invent a parent collection or library key, or
create a broad token system for a one-off screen. Extended collections must
inherit from a real local or catalog collection and remain subject to plan
limits.
