# Deliver images and illustrations

Use this reference only after the composition selects an image or illustration
role and the common boundaries in [visual-assets.md](visual-assets.md) establish
its subject and medium.

Treat existing assets, rights-established remote sources, generation, and
purpose-built vectors as acquisition routes. Choose the nearest route that
satisfies content, fidelity, rights, quality, and import requirements; tools
have no global priority. Before importing a remote asset, establish its
applicable usage rights and a recoverable source. A search result, accessible
URL, CDN host, or lack of a watermark does not establish permission. Confirm
Canvas delivery before layout depends on the asset.

When depiction is part of a record, keep it. Text, category icons, generic
placeholders, and numbered markers may index the record but cannot replace its
visual content. Source or generate an established raster role, preserve exact
vector art when vector is the real medium, or disclose the gap.

Keep only enough trace to recover material choices, the remote source and its
applicable terms, or content distinctions. Combine role, evidence, medium,
source, rights, and import treatment in one short rationale when needed; do not
create a per-asset ceremony. Record exact creator, license, or attribution only
when the applicable terms, policy, or handoff requires it; assets sharing one
route and terms may share a trace.

When medium is unspecified, use nearest visual evidence or ask if the choice is
material; otherwise state a low-consequence assumption.

Use generation when the decided role needs a bespoke or fictional subject,
identity, composition, or treatment. In a prototype, a coherent generated set
may be the nearest truthful source for distinct fictional records; do not
require stock search merely because each subject is ordinary. For a real named
subject or supplied identity, use the supplied or rights-established source and
do not generate a substitute. Before generation, map each planned asset to the
subject and consumer it serves; skip ceremony that does not protect fidelity,
rights, or import.

Compose generation and Hub import in one programmatic execution so image bytes
never enter prose or expire between calls: pass the generator's `data:` URL
directly to TemPad's `upload_asset`, read its returned `assetHash`, then declare
that hash as an IMAGE asset in `apply_canvas`. Do not regenerate an unchanged
prompt only to recover an importable URL. If generation or `upload_asset` is
unavailable, choose a rights-established public image source only when it
preserves the intended medium; otherwise disclose the required gap. Never
generate first and silently switch medium because import failed.

Use `imageUrl` for a rights-established public IMAGE paint or same-file
`imageHash` for an existing image. For generated or other local Hub content,
declare the returned full lowercase SHA-256, then use its alias in a basic fill:

```json
{
  "assets": { "image": { "type": "IMAGE", "assetHash": "<sha256>" } },
  "native": {
    "image-node": {
      "figma": {
        "fills": [{ "type": "IMAGE", "assetKey": "image", "scaleMode": "FILL" }]
      }
    }
  }
}
```

Inline bytes and local paths are unsupported. Remote URLs must resolve directly
to accessible images, not pages or thumbnails.

When a supplied canvas image is itself a permitted source artifact and an exact
visible subregion must carry into the result, reuse its same-file `imageHash`
instead of redrawing that content. For an axis-aligned source rectangle
`(x, y, width, height)` within an image of size `(imageWidth, imageHeight)`, and
a destination with the same aspect ratio, declare:

```js
{
  type: "IMAGE",
  imageHash: "<same-file hash>",
  scaleMode: "CROP",
  imageTransform: [
    [width / imageWidth, 0, x / imageWidth],
    [0, height / imageHeight, y / imageHeight]
  ]
}
```

Supply the evaluated finite numbers, not expression strings. If the destination
aspect ratio differs, first choose an aspect-correct source rectangle rather
than stretching the subject. Open the rendered crop and verify its native IMAGE
fill; a valid transform does not prove that the intended subject was isolated.

When the medium must remain a real image, verify with `get_structure` and
`options.native: true`; `native.imageFills` must contain the expected non-null
Figma hash. Input URLs, successful mutation, and visually similar screenshots
are not native read-back.

The main agent owns placement, crop, and final verification. In a comparison,
make visual differences represent the subjects rather than their source files:
normalize incidental canvas padding, crop, background, viewpoint, and apparent
scale when they would bias the decision; preserve and explain differences that
are real or cannot be normalized faithfully.

Before markup, map every content-bearing image consumer to the subject it
claims to depict. Reuse one asset and crop only when consumers represent that
same subject; distinct records require distinct assets or crops that visibly
isolate the correct subject. A composite scene may serve the composition it
depicts, but cannot stand in for several named records. Stop and source or
generate missing media instead of serializing a false mapping.

When a gallery, carousel, or thumbnail set promises several views of one
subject, every retained view must add distinct, truthful information. Repeating
one unchanged source and crop does not satisfy that role; unrelated subjects
break identity. Use distinct sourced views, evidence-supported crops, or
generation/editing only for a named same-subject coverage need that sourcing
cannot satisfy. Otherwise reduce the views or disclose the gap.

For repeated depictions of the same subject, keep asset identity and crop
stable unless evidence requires variation. If required media remains
unavailable, report it; omit optional media or use a neutral slot only when the
requested outcome is unchanged. A neutral slot is an explicit fallback, not
representative content or proof of reusable variation.
