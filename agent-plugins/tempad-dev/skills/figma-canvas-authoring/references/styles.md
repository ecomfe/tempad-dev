# Author local styles

Use this reference only when the user explicitly requests a local style or a
design-system extension that needs one. Do not extract styles from an ordinary
screen. New local resources do not require a catalog; use `catalogId` only when
a nested `{ "ref": "…" }` deliberately reuses an existing catalog resource.

Copy this complete recipe and change its design facts. Stable object keys
connect same-call resources; they are not Figma names or IDs.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"card\" class=\"flex flex-col w-[320px] h-[200px] gap-[12px] p-[24px] bg-[#FFFFFF]\"><span data-key=\"card/title\" class=\"w-fit h-fit text-[20px]\">Account</span></div>",
  "styles": {
    "surface": {
      "type": "PAINT",
      "name": "Color/Surface",
      "paints": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 } }]
    },
    "heading": {
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
        "fill": { "styleKey": "surface" }
      }
    },
    "card/title": {
      "styles": {
        "text": { "styleKey": "heading" }
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
