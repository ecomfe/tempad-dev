# Author local styles

Use this reference only when the user or resolved system plan requires a local
style. Do not extract styles from an ordinary screen. New local resources need
no catalog; send `catalogId` only when a nested `{ "ref": "…" }` deliberately
reuses an existing resource.

Copy this recipe and change its design facts. Style authoring keys persist
file-wide and are neither names nor IDs. Namespace keys by product and role. In
shared drafts, also prefix generic visible names that could collide; retain
established project naming when already clear.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"card\" class=\"flex flex-col w-[320px] h-[200px] gap-[12px] p-[24px] bg-[#FFFFFF]\"><span data-key=\"card/title\" class=\"w-fit h-fit text-[20px]\">Account</span></div>",
  "styles": {
    "product/style/surface": {
      "type": "PAINT",
      "name": "Product/Color/Surface",
      "paints": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 } }]
    },
    "product/style/heading": {
      "type": "TEXT",
      "name": "Product/Typography/Heading",
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

Types are `PAINT`, `TEXT`, `EFFECT`, and `GRID`, using `paints`, text fields,
`effects`, or `layoutGrids` respectively. For exact Paint, Effect, and Grid
shapes beyond this recipe, read [paints-effects.md](paints-effects.md).

Omission preserves managed state. Top-level `null` removes a managed style only
when absence is required and all live consumers are cleared or removed in the
same result. Never mutate remote resources, invent library keys, or create a
broad style library for one screen.

`unbound-created-style` means a same-call style lacks a `styleKey` consumer.
Bind it to a representative property performing its named role or remove it. A
swatch or unrelated binding is not coverage.
