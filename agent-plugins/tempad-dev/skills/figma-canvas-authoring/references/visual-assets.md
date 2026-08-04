# Icons, type, and imagery

Use real visual sources; a plausible-looking substitute is not the intended asset.

## Icons

Choose icon sources in this order:

1. a suitable icon component returned by the catalog;
2. the project's established icon library or supplied asset;
3. one established, permissively licensed library whose stroke/fill style,
   corner treatment, and optical weight fit the surrounding design.

When the file has no icon assets, do not fall back to the first familiar
frontend library. Select the source before selecting individual glyphs:

1. Write an icon profile without library names: outline, fill, or duotone;
   optical weight; corner and terminal geometry; base size and UI density;
   required states or variants; and the semantic coverage this composition
   actually needs.
2. If the target product establishes a library, verify and use it. Otherwise
   derive an established, permissively licensed candidate from the profile and
   inspect the actual required glyphs, SVG fidelity, states, coverage, license,
   and platform fit.
3. If the choice materially shapes expression or the first candidate fits only
   because it is familiar, compare one or two candidates that differ on the
   profile's decisive dimension. Skip the comparison for a low-consequence
   choice with a clear fit.
4. Choose by contextual fit and coverage. Do not select an unusual family
   merely to manufacture variety.

A familiar general-purpose library must pass the same comparison as every
other candidate. After committing, use the selected family consistently
without claiming design-system provenance or adding a frontend dependency.

Keep one coherent icon family within a composition. Preserve source geometry
from its installed package or official distribution; do not redraw from memory,
use Unicode UI icons, or assemble icons from frames and text. This complete
Direct call imports one compact trusted SVG:

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

The matching `div` is childless and supplies the wrapper size and layout.
`color` resolves SVG `currentColor`; omit it for complete explicit-color SVGs.
Use a Hub `{ "type": "SVG", "assetHash": "<full lowercase SHA-256>" }`
declaration for larger exact SVG content. If no trustworthy source is
available, omit a nonessential icon instead of inventing one.

## Typefaces

Prefer a catalog Text style or typography variables because they carry the
file's real type system. Otherwise infer type from trusted project evidence.
For an empty file without such evidence, choose a small, coherent type palette
for the product and content rather than defaulting every design to the same
family. For a materially type-led direction, first define the content,
platform, language coverage, tone, and density requirements, then compare two
or three available candidates when no candidate clearly satisfies them. A
familiar family must still satisfy the contextual requirements.

Use one primary family unless the concept clearly benefits from a deliberate
display/body pairing. Confirm that every exact Figma family/style is available;
do not guess style names. Express exact whole-node fonts through
`figma.text.fontName` and use ranges only for intentional mixed typography. To
apply an exact family, also load the exact whole-node font reference routed by
`SKILL.md`. A `font-sans` class does not prove a named family: either apply the
named family through a real Text style, variable, or exact native font, or keep
the brief at the level of typography roles without naming one.

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
