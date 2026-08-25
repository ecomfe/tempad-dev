# Deliver visual assets in Figma

Use this reference when the result needs icons, an exact typeface, images,
illustrations, diagrams, or vector art. It governs role, source integrity,
editability, and Canvas-compatible delivery—not product need or final visual
choice. After selection, use the routed font, paint, media, or SVG mechanics.

Start from the composition, not an assumed asset slot or available tools.
Typography, layout, color, negative space, or existing media may already satisfy
the brief. Add a visual only for an evidenced job: depicting content, signaling
action, explaining relationships, establishing identity, or expressing an
intentional visual language. These are cues, not a checklist.

Depiction is a role, not a medium. Choose photo/raster, sourced vector,
agent-authored vector illustration or diagram, or another medium only when the
brief, visual evidence, or a low-consequence assumption supports it. Fulfill an
established raster medium with a supplied, sourced, generated, or current-file
image—not primitives or invented SVG. Author vector work only when evidence
establishes vector illustration, diagram, pattern, or decorative geometry.
Convenience never changes the medium.

Treat a content-bearing visualization—such as a chart, map, waveform, notation,
document or media preview, or domain instrument—as a first-class
representation. Preserve its recognizable structure, information density, and
task role. It is sufficient only when it retains the context needed for the
decisions it supports; labels or decorative marks cannot promote a simplified
proxy into that representation. Element limits or easy primitives do not
justify reduction: split the work or choose an evidence-supported native,
vector, or raster base, keeping changing overlays editable. When only topology
or sequence is intended, name and design it as a diagram.

When recognition depends on the subject's real appearance—such as a person,
product, food, place, room, photograph, cover, or shared-media preview—treat a
real sourced or generated image as the default candidate. Use vector
illustration only when the brief or inspected visual evidence establishes an
illustrated language independently of implementation convenience. Do not call
the medium low-consequence when changing it would alter credibility, identity,
appetite, atmosphere, or content distinctions.

Preserve editability semantics: build changing diagram labels, shapes, and
relationships as native structure; use one opaque SVG only when exact vector
art is the asset. An SVG wrapper with Vector descendants does not make a diagram
model editable. Preserve exact encoded geometry as real decodable content,
never an imitation.

For material assets retain enough evidence for identity/content fidelity,
provenance and applicable rights, source quality, and Canvas-compatible form.
Never silently change subject, style, or medium. Report required sources that
cannot be delivered faithfully. Crops, masks, overlays, and retouching must
preserve the depicted subject; do not hide distinctive branding or features to
make one subject represent another.

## Contents

- [Icons](#icons)
- [Typefaces](#typefaces)
- [Images and illustrations](#images-and-illustrations)

## Icons

Prefer permitted current-file, catalog, project, or user sources; otherwise use
a trustworthy brief-compatible source and record material license constraints.
When inspected evidence establishes an icon family or geometry, use that
permitted source or a compatible source. A general library is a fallback only
when its stroke or fill, optical weight, corners, negative space, and platform
semantics remain coherent. Do not diversify sources by quota.
Import exact SVG geometry. Never redraw a known icon from memory or replace an
icon role with Unicode, emoji, TEXT, or assembled primitives. A character,
shape, or cluster that communicates an affordance, object, or semantic category
is an icon role even when embedded beside a worded label; removing the words
does not erase its directional or action meaning. Before markup, scan literal
text for pictographic Unicode, emoji, and symbols and route each qualifying mark
to a permitted current-file, catalog, project, user, or trustworthy vector
source. Omit an optional icon when no faithful source exists. Simple geometry
remains valid only when it is itself the intended status/data mark, divider,
decoration, or brand shape.

Verify fetched SVG content rather than trusting its URL or filename. This Direct
example demonstrates syntax, not design defaults:

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

The childless `div` supplies wrapper geometry. `color` resolves `currentColor`;
omit it for explicit-color SVGs. Figma may import a Frame with Vector children;
treat that subtree as one opaque asset and never flatten or reconcile it.

For larger exact SVG, declare this Hub asset using a full lowercase SHA-256:

```json
{ "type": "SVG", "assetHash": "<sha256>" }
```

If no faithful source exists, omit an optional icon or report a required gap
instead of inventing one.

## Typefaces

Derive typeface from the brief and evidence. Prefer applicable catalog Text
styles, typography variables, project fonts, or supplied references. Confirm
each exact Figma family/style; never guess.

Use `figma.text.fontName` for exact whole-node fonts and ranges only for
intentional mixed typography. Portable `font-sans|serif|mono` utilities deliver
Inter, Noto Serif, or Noto Sans Mono; they do not satisfy another named family.
For another required family, bind its style, variable, or exact font, or leave
the brief at the supported evidence level.

## Images and illustrations

Treat existing assets, rights-established remote sources, generation, and
purpose-built vectors as acquisition routes only after role, subject, and medium
are settled. Choose the nearest route satisfying content, fidelity, rights,
quality, and import requirements; tools have no global priority. Before
importing a remote asset, establish its applicable usage rights and a
recoverable source; a search result, accessible URL, CDN host, or lack of a
watermark does not establish permission. Confirm Canvas delivery before layout
depends on the asset.

Do not fall back from established raster media to primitives or SVG. Source or
generate it, use an explicit neutral placeholder only when outcome is unchanged,
or disclose the gap. Preserve exact vector art when vector is the real medium.
For several distinct assets, verify the route preserves content distinctions.

Keep only enough trace to recover material choices, the remote source and its
applicable terms, or content distinctions. Combine role, evidence, medium,
source, rights, and import treatment in one short rationale when needed; do not
create a per-asset ceremony. Record exact creator, license, or attribution only
when the applicable terms, policy, or handoff requires it; assets sharing one
route and terms may share a trace.

When medium is unspecified, use nearest visual evidence or ask if the choice is
material; otherwise state a low-consequence assumption.

Use generation when the decided role requires a bespoke subject, identity,
composition, or treatment that a supplied or rights-established source cannot
satisfy. Only a named content, fidelity, rights, or import requirement can show
that sourcing is inadequate; a missing supplied asset, mood/style adjective, or
desire for visual consistency cannot. For an ordinary real-world subject likely
available as reusable stock or CC0 media, inspect a bounded reusable-asset
search—not only visual-reference results—and name the unmet role requirement
before generating. A visual-reference search is not a reusable-asset search.
Do not load or call a generator until the trace maps every planned generated
asset—not merely the batch—to its role, subject, medium, and unmet source
requirement. Skip the source search only when the brief requires an unlikely
combination or sourcing cannot preserve the role. If a source satisfies the
role, use it; do not generate an alternative by default.
Compose generation and Hub import programmatically so image bytes never enter
prose: pass the generator's `data:` URL directly to TemPad's `upload_asset`,
read its returned `assetHash`, then declare that hash as an IMAGE asset in
`apply_canvas`. If generation or `upload_asset` is unavailable, choose a
rights-established public image source only when it preserves the intended
medium; otherwise disclose the required gap. Never generate first and silently
switch medium because import failed.

Use `imageUrl` for a rights-established public IMAGE paint or same-file
`imageHash` for an existing image. For generated or other local Hub content,
declare the returned full lowercase SHA-256, then use its alias in a basic fill:

```json
{
  "assets": { "photo": { "type": "IMAGE", "assetHash": "<sha256>" } },
  "native": {
    "photo-node": {
      "figma": { "fills": [{ "type": "IMAGE", "assetKey": "photo", "scaleMode": "FILL" }] }
    }
  }
}
```

Inline bytes and local paths are unsupported; remote URLs must resolve directly
to accessible images, not pages or thumbnails.

When the medium must remain a real image, verify with `get_structure` and
`options.native: true`; `native.imageFills` must contain the expected non-null
Figma hash. Input URLs, successful mutation, and visually similar screenshots
are not native read-back.

The main agent owns placement, crop, and final verification. Before markup, map
each content-bearing image consumer to the subject it claims to depict. Reuse
one asset and crop only when consumers represent that same subject; distinct
records require distinct assets or crops that visibly isolate the correct
subject. A composite scene may serve the composition it depicts, but cannot
stand in for several named records. Stop and source or generate missing media
instead of serializing a false mapping.

When a gallery, carousel, or thumbnail set promises several views of one
subject, every retained view must add distinct, truthful visual information.
Repeating one unchanged source and crop does not satisfy that role; unrelated
subjects break identity. Use distinct sourced views, evidence-supported crops,
or generation/editing only for a named same-subject coverage need that sourcing
cannot satisfy. Otherwise reduce the views or disclose the gap.

For repeated depictions of the same subject, keep asset identity and crop stable
unless evidence requires variation. If required media remains unavailable,
report it; omit optional media or use a neutral slot only when the requested
outcome is unchanged. A neutral slot is an explicit fallback, not representative
content or proof of reusable variation.
