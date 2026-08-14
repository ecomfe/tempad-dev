# Deliver visual assets in Figma

Use this reference when the result needs icons, an exact typeface decision,
images, illustrations, diagrams, or vector artwork. It governs asset role,
source integrity, native editability, and an importable form; it does not define
the product need or the final visual choice. After choosing the asset, use the
routed native reference for exact font, paint, media, or SVG application
mechanics.

Start with the composition, not an assumed asset slot or a comparison of
available tools. Typography, layout, color, negative space, or existing media
may already fulfill the brief. Add a distinct visual only when it performs a
job established by the brief or applicable evidence, such as depicting
content, signaling an action, explaining a relationship, establishing identity,
or contributing an intentional visual language. These are recognition cues,
not a taxonomy to complete. If no distinct job exists, do not add an asset to
make the result feel more designed.

Depiction is a visual job, not a medium. Choose photographic or raster imagery,
sourced vector artwork, an authored vector illustration or diagram, or another
medium only after the brief, applicable visual evidence, or an identified
low-consequence assumption supports it. When the established medium is
photographic or raster imagery, fulfill it with a sourced, generated, supplied,
or current-file asset; do not assemble it from Figma primitives or newly
invented SVG. Use agent-authored vector work only when the user or applicable
visual evidence independently establishes vector illustration, diagram,
pattern, or decorative geometry as the medium. Never reclassify imagery as one
of those media because drawing it is easier. Implementation convenience does
not establish the intended medium.

Preserve the semantics that earn native editability. Build an authored diagram
whose labels, shapes, or relationships are expected to change as native Figma
structure. Import one opaque SVG only when exact vector artwork is itself the
asset; an SVG wrapper with Vector descendants does not preserve an editable
diagram model.

When a visual's function depends on exact encoded geometry, preserve real
decodable content in a Canvas-accepted asset form; never imitate it with
decorative primitives or invented vectors.

For material assets, preserve enough evidence for the intended use:

- identity and content fidelity;
- provenance and applicable usage rights;
- sufficient source quality;
- a delivery form accepted by Canvas.

Do not silently change an asset's subject, style, or medium because another
route is easier to import. If a required source cannot be delivered faithfully,
report the limitation instead of disguising a substitute as intent.

A crop, mask, overlay, or retouch may support the composition only while it
preserves what the asset depicts. Do not conceal distinctive branding or
features to make one subject represent another; choose a neutral, matching, or
generated source instead.

## Contents

- [Icons](#icons)
- [Typefaces](#typefaces)
- [Images and illustrations](#images-and-illustrations)

## Icons

Use an applicable current-file, catalog, project, or user-supplied source when
permitted. Otherwise select a trustworthy source that satisfies the established
brief and record any license constraint. Import its exact SVG geometry; do not
redraw a known icon from memory or replace an established icon-asset role with a
text character, including a Unicode symbol or emoji.
Treat a text character or primitive shape or cluster as an icon role when its
form communicates an affordance, object, or semantic category; use the selected
icon asset or component rather than TEXT or newly assembled primitives. Simple
geometry remains valid when the mark itself is intended, such as a status or
data mark, divider, or decorative or brand shape, not when it substitutes for
an icon.
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

Treat an existing asset, licensed remote source, generation, or purpose-built
vector work as acquisition routes after the visual role, subject, and medium
are established. Search and image-generation tools are not competing defaults,
and the skill assigns no global priority to them. Use situated judgment to take
the nearest route that satisfies the relevant content, fidelity, rights,
quality, and import requirements; do not perform an option-ranking ceremony
when the evidence already makes one route suitable. Before layout depends on
the asset, confirm that the chosen result is deliverable through Canvas.

Treat the medium as part of the material decision. An established photographic
or raster medium does not fall back to agent-authored primitives or SVG when its
intended asset is missing; source or generate the image, use an explicit neutral
placeholder when that does not change the outcome, or disclose the gap. Exact
supplied or sourced vector art remains valid when vector is the asset's actual
medium. When several assets represent distinct content, verify that the
selected route preserves the distinctions the composition depends on.

Keep only enough working evidence to recover a material choice or verify a
distinction the composition depends on. A short rationale may combine the
visual job, governing evidence, medium, source, and import treatment; this is
not a mandatory field sequence or a per-asset reporting ceremony.

Require an exact asset page, creator record, license record, or attribution only
when the source terms, user or project policy, or requested handoff makes that
detail material. Do not turn ordinary draft imagery into a per-asset citation
exercise. Assets that share one recoverable route and the same applicable terms
may share a trace when individual identity is not material.

If no evidence or explicit brief decision establishes a medium, judge whether
the choice would materially change the result. Resolve a material choice from
the nearest relevant visual evidence or ask the user; make a low-consequence
choice as an identified assumption.

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

When the delivered medium must remain a real image, verify the live image node
with `get_structure` and `options.native: true`. Its `native.imageFills` must
contain the expected non-null Figma image hash; the supplied `imageUrl`, a
successful apply summary, or a screenshot that merely resembles the source is
not native-state read-back.

The main agent owns placement and crop and verifies the delivered asset in the
final composition. Keep identity and crop stable across repeated usages unless
the brief establishes a real variation. If required media remains unavailable,
report the gap; omit optional media or use a neutral slot only when doing so does
not change the requested outcome. A neutral slot is an explicit fallback, not
representative content or proof that a reusable content contract supports real
variation.
