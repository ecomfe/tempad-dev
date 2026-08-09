# Author local styles

Use this reference only when the user explicitly requests a local style or a
design-system extension that needs one. Do not extract styles from an ordinary
screen. New local resources do not require a catalog; use `catalogId` only when
a nested `{ "ref": "…" }` deliberately reuses an existing catalog resource.

Copy this complete recipe and change its design facts. Style authoring keys
persist file-wide so later calls can recover the same resources; they are not
Figma names or IDs. Namespace them by product and role.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"card\" class=\"flex flex-col w-[320px] h-[200px] gap-[12px] p-[24px] bg-[#FFFFFF]\"><span data-key=\"card/title\" class=\"w-fit h-fit text-[20px]\">Account</span></div>",
  "styles": {
    "product/style/surface": {
      "type": "PAINT",
      "name": "Color/Surface",
      "paints": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 } }]
    },
    "product/style/heading": {
      "type": "TEXT",
      "name": "Typography/Heading",
      "fontName": { "family": "Inter", "style": "Semi Bold" },
      "fontSize": 20,
      "lineHeight": { "unit": "PIXELS", "value": 28 }
    }
  },
  "native": {
    "card": {
      "styles": {
        "fill": { "styleKey": "product/style/surface" }
      }
    },
    "card/title": {
      "styles": {
        "text": { "styleKey": "product/style/heading" }
      }
    }
  }
}
```

Style types are `PAINT`, `TEXT`, `EFFECT`, and `GRID`. Use the matching native
definition: `paints`, text fields, `effects`, or `layoutGrids`. Exact Paint,
Effect, and Grid shapes live in [paints-effects.md](paints-effects.md); read it
when the requested definition goes beyond the simple recipe above.

Omitted fields preserve managed resource state. A top-level `null` removes a
managed style only when the user explicitly requires absence and every live
consumer is cleared or removed in the same result. Never mutate or delete a
remote resource, invent a library key, or create a broad style library for a
one-off screen.

A style created without a same-result `styleKey` reference returns
`unbound-created-style`. Treat it as unfinished authoring: bind the style to a
representative consumer whose property performs its named role, or remove the
speculative definition. A swatch or unrelated binding does not close coverage.
