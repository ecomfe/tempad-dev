# Author local variables

Use this reference only when the user explicitly requests a local variable or
design-system extension that needs one. Do not extract tokens from an ordinary
screen. New local resources do not require a catalog; use `catalogId` only when
a nested `{ "ref": "…" }` deliberately reuses an existing catalog resource.

Copy this complete recipe and change its design facts. Stable object keys
connect same-call resources; they are not Figma names or IDs.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"card\" class=\"flex flex-col w-[320px] h-[200px] gap-[16px] p-[24px] bg-[#FFFFFF]\"><span data-key=\"card/title\" class=\"w-fit h-fit text-[20px] font-semibold\">Account</span></div>",
  "variableCollections": {
    "theme": {
      "name": "Theme",
      "modes": {
        "light": { "name": "Light" },
        "dark": { "name": "Dark" }
      },
      "variables": {
        "surface": {
          "name": "Color/Surface",
          "type": "COLOR",
          "scopes": ["ALL_FILLS"],
          "values": {
            "light": { "r": 1, "g": 1, "b": 1 },
            "dark": { "r": 0.08, "g": 0.09, "b": 0.11 }
          }
        },
        "space-md": {
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
        "fill": { "variableKey": "surface" },
        "gap": { "variableKey": "space-md" }
      },
      "variableModes": {
        "theme": "dark"
      }
    }
  }
}
```

A new collection needs `name` and at least one named mode. A variable needs
`name`, `type`, and a value for every mode. Types are `BOOLEAN`, `COLOR`,
`FLOAT`, or `STRING`. Values may alias another variable with
`{ "variable": { "variableKey": "…" } }`.

`native[key].variables` binds same-call variables. Use the exact supported
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
