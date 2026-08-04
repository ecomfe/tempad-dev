# Icons, type, and imagery

Use real visual sources; a plausible-looking substitute is not the intended asset.

## Icons

Choose icon sources in this order:

1. a suitable icon component returned by the catalog;
2. the project's established icon library or supplied asset;
3. one established, permissively licensed library whose stroke/fill style,
   corner treatment, and optical weight fit the surrounding design.

When the file has no icon assets, use a frontend icon library as the fallback.
Prefer one established by the target product. Otherwise infer outline, fill, or
duotone; weight; geometry; size/density; and states. Choose by fit and coverage.

Use these families as reference points, not a preferred set or allowlist:

- Lucide: neutral rounded outlines with adjustable stroke;
- Phosphor: expressive geometry; thin, light, regular, bold, fill, and duotone;
- Material Symbols: systematic outlined, rounded, and sharp styles; fill and weight variation;
- Radix Icons: compact, crisp 15x15 interface icons for dense controls;
- Iconoir: light, airy outlines with a characteristic 1.5 stroke.

If none fits or lacks required semantics or variants, inspect two or three
different libraries in official documentation. Other trustworthy, permissively
licensed sources remain valid; never force a listed family or treat
“general-purpose” as a visual direction. Use the selected family consistently
without claiming design-system provenance or adding a frontend dependency.

Keep one coherent icon family within a composition. Preserve source geometry
from its installed package or official distribution; do not redraw from memory,
use Unicode UI icons, or assemble icons from frames and text. Import a compact
trusted SVG directly:

```json
{
  "assets": {
    "search": { "type": "SVG", "svg": "<svg viewBox=\"0 0 24 24\">...</svg>" }
  },
  "native": {
    "search-icon": {
      "figma": { "svg": { "assetKey": "search", "color": "#334155" } }
    }
  }
}
```

The matching `div` must be childless and supplies the wrapper size and layout.
`color` resolves SVG `currentColor`; omit it for complete explicit-color SVGs.
Use a Hub `{ "type": "SVG", "assetHash": "<full lowercase SHA-256>" }`
declaration for larger exact SVG content. If no trustworthy source is
available, omit a nonessential icon instead of inventing one.

## Typefaces

Prefer a catalog Text style or typography variables because they carry the
file's real type system. Otherwise infer type from trusted project evidence.
For an empty file without such evidence, choose a small, coherent type palette
for the product and content rather than defaulting every design to the same
family.

Use one primary family unless the concept clearly benefits from a deliberate
display/body pairing. Confirm that every exact Figma family/style is available;
do not guess style names. Express exact whole-node fonts through
`figma.text.fontName` and use ranges only for intentional mixed typography.

## Images and illustrations

Choose imagery in this order:

1. a real project, user-supplied, or current-file asset;
2. an appropriate licensed source;
3. generated imagery when the agent can return a source accepted by the
   connected Canvas tool.

For generation, specify the subject, role in the layout, aspect ratio, palette,
lighting or rendering style, and important empty space. Match the surrounding
art direction instead of generating a generic stock image.

When subagents are available and generation needs real visual exploration,
delegate it with that compact brief. Ask for one selected importable reference,
its MIME type and dimensions, and a short description—not bytes, discarded
candidates, or the generation transcript. Keep exact asset reuse, icon SVGs,
and direct URL imports in the main task. Do not delegate when the subagent
cannot return a source the Canvas tool can import.

Apply a public generated result as an IMAGE paint using `imageUrl`; an existing
current-file `imageHash` is also valid. For content already in the local Hub,
declare `{ "type": "IMAGE", "assetHash": "<full lowercase SHA-256>" }` and use
its alias as the paint's `assetKey`. Inline bytes and local-only paths are not
supported. The main agent still owns placement and crop and should judge the
result in the final composition rather than loading intermediate candidates
into its context.

If no usable asset can be imported, never fake a photo or illustration with
DOM-like frames, gradients, emoji, or primitive mosaics. Omit optional imagery.
When the layout must reserve media space, use one honest neutral asset frame
and report that it remains an unfilled slot.
