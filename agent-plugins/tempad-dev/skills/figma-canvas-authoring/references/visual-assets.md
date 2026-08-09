# Deliver visual assets in Figma

Use this reference when the result needs icons, a typeface decision, images, or
illustrations. It governs asset role, source integrity, and an importable form;
it does not define the product need or the final visual choice. After choosing
the asset, use the routed native reference for exact font, paint, media, or SVG
application mechanics.

Classify the role before choosing a medium. When the role is an image—media
whose job is to depict content—fulfill it with a sourced, generated, supplied,
or current-file asset. Do not assemble it from Figma primitives or newly
invented SVG. Use agent-authored vector work only when the user or applicable
visual evidence independently establishes the role as vector illustration,
diagram, pattern, or decorative geometry. Never reclassify an image as one of
those roles because drawing it is easier. Creative latitude, native editability,
delivery speed, and tool availability do not establish the intended medium.

For material assets, preserve enough evidence for the intended use:

- identity and content fidelity;
- provenance and applicable usage rights;
- sufficient source quality;
- a delivery form accepted by Canvas.

Catalog entries and available tools are candidates, not design evidence. Do not
silently change an asset's subject, style, or medium because another route is
easier to import. If a required source cannot be delivered faithfully, report
the limitation instead of disguising a substitute as intent.

## Contents

- [Icons](#icons)
- [Typefaces](#typefaces)
- [Images and illustrations](#images-and-illustrations)

## Icons

Use an applicable current-file, catalog, project, or user-supplied source when
permitted. Otherwise select a trustworthy source that satisfies the established
brief and record any license constraint. Import its exact SVG geometry; do not
redraw a known icon from memory or replace it with a text character.
Before declaring a fetched SVG, verify that the response is SVG content rather
than a redirect, error document, or missing-asset message; a plausible URL or
filename does not establish a valid asset.

This complete Direct call demonstrates SVG import mechanics. Its content,
dimensions, and color are syntax examples, not design defaults:

```json
{
  "mode": "create",
  "markup": "<div data-key=\"search-icon\" class=\"size-[24px]\"></div>",
  "assets": {
    "search": {
      "type": "SVG",
      "svg": "<svg viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"m16 16 5 5\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"2\"/></svg>"
    }
  },
  "native": {
    "search-icon": {
      "figma": { "svg": { "assetKey": "search", "color": "#334155" } }
    }
  }
}
```

The matching `div` is childless and supplies wrapper geometry. `color` resolves
SVG `currentColor`; omit it for complete explicit-color SVGs. Figma may import
one SVG as a Frame with Vector descendants. Treat that editable subtree as one
opaque asset; do not flatten or reconcile it.

Use a Hub `{ "type": "SVG", "assetHash": "<full lowercase SHA-256>" }`
declaration for larger exact SVG content. If no faithful source is available,
omit a nonessential icon or report a required gap rather than inventing one.

## Typefaces

Derive typeface choice from the established brief and evidence. Reuse an
applicable catalog Text style, typography variable, project font, or supplied
reference when available. Confirm that every exact Figma family and style is
available; never guess style names.

Express exact whole-node fonts through `figma.text.fontName` and use ranges only
for intentional mixed typography. Load the exact whole-node font reference
routed by `SKILL.md` when applying one. A generic `font-sans` class does not
prove delivery of a named family: bind the actual style, variable, or exact
native font, or leave the brief at the level the evidence supports.

## Images and illustrations

Choose among an existing asset, a licensed remote source, generation, or
purpose-built vector work from the established design decision. The skill does
not assign a global priority to those routes. Before layout depends on the
asset, confirm that the chosen result satisfies its required content, fidelity,
rights, and import path.

Treat the medium as part of the material decision. A content-image role does not
fall back to agent-authored primitives or SVG when its intended asset is missing;
source or generate the image, use an explicit neutral placeholder when that does
not change the outcome, or disclose the gap. Exact supplied or sourced vector
art remains valid when vector is the asset's actual medium. When several assets
represent distinct content, verify that the selected route preserves the
distinctions the composition depends on.

Keep a compact working trace at the granularity needed to recover each material
asset decision:

```txt
role -> governing evidence or brief decision -> subject and medium -> source/rights -> import/crop
```

Require an exact asset page, creator record, license record, or attribution only
when the source terms, user or project policy, or requested handoff makes that
detail material. Do not turn ordinary draft imagery into a per-asset citation
exercise. Assets that share one recoverable route and the same applicable terms
may share a trace when individual identity is not material.

If no cited evidence or explicit brief decision establishes a material medium,
that decision remains open; do not make the asset first and call its medium
intentional afterward.

When generation is the established route, resolve how its output will reach a
Canvas-accepted form before invoking the image-generation skill or tool. A local
path alone is not importable by Canvas. If the current environment has no bridge,
choose another brief-compatible image source before generating, or disclose the
gap when generation itself is required. Do not generate first and then silently
switch to a different medium or generic source because the result cannot be
uploaded.

Apply a public image as an IMAGE paint using `imageUrl`; an existing current-file
`imageHash` is also valid. For content already in the local Hub, declare
`{ "type": "IMAGE", "assetHash": "<full lowercase SHA-256>" }` and use its
alias as the paint's `assetKey`. Inline bytes and local-only paths are not
supported. Remote URLs must resolve directly to an accessible image rather than
to a webpage or thumbnail.

The main agent owns placement and crop and verifies the delivered asset in the
final composition. Keep identity and crop stable across repeated usages unless
the brief establishes a real variation. If required media remains unavailable,
report the gap; omit optional media or use a neutral slot only when doing so does
not change the requested outcome. A neutral slot is an explicit fallback, not
representative content or proof that a reusable content contract supports real
variation.
