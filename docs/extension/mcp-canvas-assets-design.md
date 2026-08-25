# MCP Canvas SVG and image assets

Status: implemented, including programmatic generated-image upload
Date: 2026-07-31

## Decision

Keep `apply_canvas` as the only mutating tool. Add a call-scoped asset manifest, one SVG placement
field, and one content-addressed image source:

```txt
agent or host asset
  -> small inline SVG or Hub asset hash
  -> apply_canvas desired result
  -> deterministic asset resolution
  -> Figma-native SVG import or image fill
  -> normal diff, Undo, rollback, and verification
```

Do not add icon-search, image-search, or SVG-operation tools to TemPad. Expose one narrow
`upload_asset` bridge for PNG, JPEG, or GIF `data:` URLs returned by an image-generation tool. The
agent must compose generation and upload inside one programmatic tool call so bytes do not enter
model-authored prose or later Canvas arguments. The dedicated upload argument carries the image
once; subsequent Canvas calls see only a content hash. Do not put raster bytes or large SVG
documents in `apply_canvas`.

Image generation may run in an isolated subagent when the host supports it and the canvas-authoring
delegation gate passes. The main agent fixes the art brief, remains the only Canvas writer, and owns
placement and final judgment. This is an optional agent-orchestration optimization, not part of the
TemPad protocol.

Asset-medium selection remains an evidence decision. Creative latitude, Canvas editability, and
delivery convenience do not establish a geometric or vector language. When several assets represent
distinct content, the chosen existing, licensed, generated, or vector route must preserve the
distinctions the composition depends on instead of substituting one reusable placeholder motif.

This extends the existing declarative language rather than creating a second asset dialect.

## Figma facts

Figma provides two different vector paths:

- [`figma.createNodeFromSvg(svg)`](https://developers.figma.com/docs/plugins/api/figma/) imports an
  SVG string as editable Figma layers inside a `FrameNode`, equivalent to editor SVG import.
- [`VectorPath.data`](https://developers.figma.com/docs/plugins/api/properties/VectorPath-data/)
  accepts only absolute `M`, `L`, `Q`, `C`, and `Z` commands.

Direct SVG import is therefore the correct path for frontend icon-library SVG. Requiring the agent
to translate arbitrary SVG into `VectorPath` would spend context, invite geometry errors, and lose
supported SVG structure.

The expected layer shape is a managed Frame containing one native imported SVG subtree. TemPad does
not flatten its Vector descendants because that can change strokes, holes, masks, multicolor art,
and exact source replacement.

Figma has no image node. Images are content handles used by
[`ImagePaint`](https://developers.figma.com/docs/plugins/api/Paint/). The Plugin API accepts:

- PNG, JPEG, or GIF bytes through
  [`figma.createImage`](https://developers.figma.com/docs/plugins/api/properties/figma-createimage/);
- a public PNG, JPEG, or GIF URL through
  [`figma.createImageAsync`](https://developers.figma.com/docs/plugins/api/properties/figma-createimageasync/);
- existing current-file image hashes through `figma.getImageByHash`.

Both byte and URL imports are limited to 4096 pixels on each axis. SVG import produces editable
vector layers rather than an image fill.

MCP resources and resource links let a server send large data to a client. The protocol does not
define a general client-to-server binary upload handle. TemPad therefore accepts one bounded image
data URL through a dedicated Hub-only call instead of widening `apply_canvas`, reading local files,
or adding an arbitrary URL fetcher.

## Public desired-result contract

Add one optional top-level field to the compact public schema:

```ts
type ApplyCanvasInput = {
  // existing fields
  assets?: unknown
}
```

As with `styles`, `variableCollections`, and advanced `native` state, the public schema keeps this
field opaque so the always-visible `apply_canvas` schema remains below 8 KiB. The resolver validates
the complete private shape:

```ts
type CanvasAssets = Record<
  CanvasStableKey,
  | {
      type: 'SVG'
      svg: string
    }
  | {
      type: 'SVG'
      assetHash: string
    }
  | {
      type: 'IMAGE'
      assetHash: string
    }
>
```

Asset keys are call-scoped aliases. They deduplicate one source used by several nodes, but do not
create a Figma design-system resource and do not need to remain stable across calls.

The asset manifest is a delivery contract, not a medium selector. Before declaring a material
asset, the agent records which user requirement, inspected evidence, or explicit brief decision
establishes its subject and medium. A content-image role uses a sourced, generated, supplied, or
current-file asset; availability of inline SVG does not justify replacing it with primitives or
newly invented vector artwork. Agent-authored vectors require an independently established
illustration, diagram, pattern, or decorative-geometry role.

Allow at most 32 declarations and 64 KiB of inline SVG across one call. Every declaration must be
referenced, every reference must exist and match the required type, and `markup: null` cannot carry
assets. These rules prevent an asset manifest from becoming hidden general-purpose payload storage.

### SVG placement

A childless `div` may carry:

```ts
type CanvasSvgPlacement = {
  assetKey: string
  color?: string // exactly #RRGGBB or #RRGGBBAA
}
```

under `native[key].figma.svg`.

Example:

```jsx
<div data-key="search-icon" class="w-[20px] h-[20px]"></div>
```

```json
{
  "assets": {
    "search": {
      "type": "SVG",
      "svg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\">...</svg>"
    }
  },
  "native": {
    "search-icon": {
      "figma": {
        "svg": {
          "assetKey": "search",
          "color": "#334155"
        }
      }
    }
  }
}
```

`color` resolves CSS `currentColor` before import. It is a literal in the first version:

- it makes common frontend icon SVG deterministic;
- it does not pretend a paint variable can be reliably propagated through importer-generated
  descendants;
- catalog icon components remain the correct choice when native token linkage matters.

Reject unresolved `currentColor`. Do not silently import it as black. Omit `color` for SVGs with
complete explicit colors.

The SVG placement:

- compiles to a managed `FRAME` wrapper;
- must be childless in Canvas HTML;
- cannot combine with a component binding, native shape, group, Boolean operation, section,
  authored component, or Slot;
- may use normal layout, size, position, visibility, opacity, blend, and rotation on the wrapper;
- preserves the SVG aspect ratio, centers it, and contains it inside the declared width and height;
- does not reinterpret wrapper fills, strokes, or variables as descendant SVG colors.

Only contain-and-center is supported initially. Cover, stretch, arbitrary SVG viewport alignment,
and descendant paint remapping need real use cases before becoming protocol concepts.

### Image paint source

Keep the existing `IMAGE` paint model and add `assetKey` as a third source:

```ts
type CanvasImageSource = { imageHash: string | null } | { imageUrl: string } | { assetKey: string }
```

Exactly one source remains required. All existing `FILL`, `FIT`, `CROP`, and `TILE` placement,
transform, rotation, filter, visibility, opacity, and blend fields remain unchanged.

```json
{
  "assets": {
    "hero": {
      "type": "IMAGE",
      "assetHash": "full-sha256"
    }
  },
  "native": {
    "hero-frame": {
      "figma": {
        "fills": [
          {
            "type": "IMAGE",
            "assetKey": "hero",
            "scaleMode": "FILL"
          }
        ]
      }
    }
  }
}
```

Use:

- `imageHash` to reuse exact bytes already present in the current Figma file;
- `imageUrl` for a public HTTP(S) PNG, JPEG, or GIF;
- `assetKey` for content already stored in the local Hub, including host-uploaded generated images.

Do not infer node geometry from image dimensions. Canvas HTML remains the source of layout size;
the paint scale mode controls placement within that geometry.

## Asset transport

### Existing paths

The current pipeline already supports:

- Figma-to-Hub asset upload for `get_code` and `get_screenshot`;
- content-addressed storage behind a random loopback capability URL;
- linked output instead of binary model context;
- public image URL import through Figma.

Reuse that store for authoring assets.

### Hub-to-Figma bytes

Add a narrow reverse path:

```txt
Figma page requests assetHash
  -> content bridge
  -> extension service worker
  -> authenticated loopback GET
  -> MIME, size, and SHA-256 verification
  -> bounded internal base64 message
  -> page Uint8Array
  -> createImage(bytes) or createNodeFromSvg(text)
```

The page never uses the Hub capability URL for inbound fetches. The broker accepts only an exact
content hash, builds the URL from its validated Hub state, and cannot be used as an arbitrary URL
proxy. Binary encoding exists only inside the extension bridge; it never enters an MCP tool call or
result. The page still receives the existing capability URL solely to describe outbound assets
already uploaded by `get_code` and `get_screenshot`.

Cache resolved bytes and imported Figma image hashes by content hash for the active session.

### Agent-generated images

When custom focal imagery is appropriate and a generation capability is
available, generation runs before layout instead of substituting hand-built
Canvas geometry.

Support three factual routes:

1. A rights-established public HTTPS PNG/JPEG/GIF URL: use `imageUrl`.
2. The generator returns a PNG/JPEG/GIF `data:` URL: compose its result directly into
   `upload_asset`, then use the returned `assetHash`.
3. Neither path exists: omit optional imagery or disclose the required gap; never synthesize an
   image-role illustration from Figma primitives.

`upload_asset` is Hub-only, content-addressed, idempotent, and bounded by the existing per-asset and
aggregate quotas. It accepts no local path, remote URL, headers, credentials, SVG, or arbitrary MIME
type. It validates base64 canonically, recomputes SHA-256, and stores through the existing loopback
asset server. Its response contains only `assetHash`, MIME type, and size.

When the host supports subagents and generation is separable, importable, verifiable, and worth its
coordination cost, delegate nontrivial image generation:

1. The main design agent sends a compact brief: layout role, subject, aspect ratio, palette/style,
   important empty space, and negative constraints.
2. The image subagent generates and iterates independently. The main agent programmatically uploads
   its selected `data:` URL through `upload_asset`; a rights-established public result URL remains a
   valid direct route.
3. It returns only an importable `assetHash` or `imageUrl` plus MIME type, dimensions, and a short
   description. It does not return bytes, candidate history, or its generation transcript.
4. The main agent owns placement and crop, and verifies the final composition when pixels can
   change the decision. It does not need to inspect intermediate candidates.

Do not delegate exact project assets, icon-library SVGs, existing Figma images, direct URL imports,
crop/placement decisions, or final acceptance. Do not spawn an image subagent when it cannot return
an importable reference. Clients without subagents follow the same asset contract directly; TemPad
neither exposes a subagent tool nor assumes one exists.

Do not accept:

- base64 or data URLs in `apply_canvas`, prose, or a copied/manual tool argument;
- arbitrary local file paths;
- credentials, headers, cookies, or signed-request recipes;
- a server-side “fetch any URL” endpoint.

These alternatives respectively consume model context, expose local files, leak secrets, or create
an SSRF surface.

### Content identity

All asset descriptors and store paths use the complete lowercase SHA-256 digest. The extension and
Hub validate the digest again after every upload and download. There is no parallel short
model-facing asset ID.

The additional characters are negligible beside the bytes they replace.

## SVG validation

SVG is code-like input even when Figma turns it into design layers. Validate before mutation:

- UTF-8 only;
- `<svg>` document root;
- inline SVG at most 32 KiB;
- Hub-backed SVG at most 1 MiB;
- at most 500 XML elements and depth 32;
- a finite positive `viewBox`, or finite positive intrinsic width and height;
- no `DOCTYPE`, entity declarations, scripts, event-handler attributes, `foreignObject`, embedded
  HTML, audio, video, or iframe content;
- no embedded raster `<image>`;
- no external `href`, `src`, CSS import, font URL, or `url(...)`; local `#id` references remain
  valid for gradients, masks, clipping, and `<use>`;
- no `<style>` element or `style` attribute in the first version; presentation attributes cover
  frontend icon libraries without requiring a CSS parser;
- no unresolved `currentColor`.

Use the extension's existing XML parser (`svgson`) for structural checks and deterministic
serialization. Do not build an SVG renderer or path parser. Figma remains the rendering and import
authority.

After `createNodeFromSvg`, reject and roll back if Figma produces:

- zero or non-finite geometry;
- more than 500 imported descendants;
- a node outside the expected managed wrapper;
- an import error.

Error messages identify the asset key and violated rule but never echo SVG source.

## Reconciliation and ownership

### SVG

The stable Canvas node is a managed wrapper frame. It contains exactly one plugin-owned imported
SVG root. Store only bounded metadata on the wrapper:

- source SHA-256;
- resolved `currentColor`, if any;
- import-policy version;
- imported-child ownership marker.

The source itself is not stored in plugin data.

Reconcile as follows:

1. Resolve and validate every referenced asset before creating document nodes.
2. Hash the sanitized SVG plus color and import-policy version.
3. If the wrapper has the same digest and its owned child still exists, preserve the child.
4. If only wrapper geometry changed, uniformly rescale and center the existing child.
5. If the digest changed, import and validate a replacement child first, then remove the previous
   owned child.
6. If unexpected manual children exist in the wrapper, fail rather than delete them.

This preserves the wrapper node ID, Auto Layout participation, hyperlinks, component-property
references, and external references when the source changes.

Importer-generated descendants are an opaque owned subtree. TemPad does not assign Canvas keys,
diff individual SVG layers, or promise stable descendant IDs. Manual edits inside that subtree are
preserved while the declared source digest is unchanged and replaced only when the caller supplies
different SVG content or color.

Removal treats the marked imported root and all of its descendants as one owned unit when its
managed wrapper, or an owned ancestor containing that wrapper, is explicitly removed. Unmarked
siblings remain manual content and still block deletion.

### Images

Resolve `assetKey` bytes with `figma.createImage(bytes)`, then replace it with the resulting native
`imageHash` before normal paint comparison. Figma's content handle and the existing ordered paint
diff provide no-op convergence.

`imageUrl` remains open-world and may resolve to different bytes over time. It is a convenience
source, not content identity. Prefer a Hub asset for generated or otherwise exact imagery. Because
`apply_canvas` may fetch a remote image URL, its MCP `openWorldHint` should be `true`.

### Undo and rollback

SVG import and image creation run inside the existing single Undo boundary after non-mutating
validation. A failed import, placement, later reconciliation step, or final verification triggers
the existing rollback.

Any temporary SVG import frame must be removed before success. Tests must confirm whether Figma Undo
also removes otherwise-unreferenced newly created image handles; if it does not, document that
orphan handles may remain but no canvas node or paint may survive a failed apply.

## Verification

Extend mandatory structural verification:

- an SVG wrapper has the expected stable key and `FRAME` type;
- it has exactly one owned imported root plus no unexpected children;
- stored source digest, color, and import-policy version match the desired placement;
- imported geometry is finite and contained within the wrapper;
- an asset-backed image paint contains the resolved Figma `imageHash`;
- all existing paint fields still match.

Do not export SVG or image bytes into the result. Return only normal mutation counts and bounded
warnings. A composition containing a consequential visual asset checks one representative usage
before propagation, then checks the final board and any materially distinct crop or treatment where
a defect could hide. Mechanical text, token, prop, and hierarchy updates skip screenshots;
corrections recheck only affected compositions.

## Context budget

The feature adds almost no always-on context:

- no new exposed tool;
- one opaque `assets` field in the public tool schema;
- one sentence in the tool description only if needed;
- exact syntax stays in the canvas-authoring skill's progressive visual-assets reference;
- asset bytes move through the local binary bridge;
- optional image generation and iteration can stay in an isolated task, with only a compact brief
  and final asset descriptor reaching the main design context;
- full validation errors are bounded and source-free;
- apply results never repeat sources or previews.

Subagents reduce generation-specific reasoning and visual exploration in the main task. The asset
server separately keeps binary transport out of every model context. Neither mechanism eliminates
the main agent's responsibility to specify the image's role or judge the final composition.

Inline SVG is reserved for small frontend icons. A 32 KiB schema ceiling is a safety limit, not a
recommended prompt budget; the skill should recommend Hub assets for anything beyond a compact icon
or logo.

## Provenance and privacy

TemPad imports exact caller-provided content; it does not search for assets, determine copyright
status, or grant usage rights. The authoring workflow preserves enough source and rights evidence
for the intended use. It requires item-level attribution or license records only when source terms,
user or project policy, or the requested handoff makes them material. The skill should prefer
project-approved, user-supplied, or permissively licensed sources and keep one icon family
coherent. In a clean context it derives an
icon profile from the product and composition, inspects fitting candidates from official sources,
and compares materially distinct options only when the decision is consequential or the first fit
rests on familiarity. It intentionally ships no named fallback list.

Do not log SVG source, raster bytes, remote URL queries, capability URLs, or upload tokens. Logs may
contain only asset key, content hash, MIME type, byte count, dimensions, and bounded failure code.
The existing local-store TTL applies to inbound assets, and a content hash is identity rather than
authorization.

`imageUrl` causes an external fetch and can disclose ordinary request metadata to the remote host.
Use it only for public assets; private/generated bytes should use the local content-addressed path.

## Errors

Use stable, actionable codes:

| Code                       | Meaning                                                   |
| -------------------------- | --------------------------------------------------------- |
| `ASSET_NOT_FOUND`          | Hub content hash is absent or expired                     |
| `ASSET_HASH_MISMATCH`      | downloaded or uploaded bytes do not match the digest      |
| `ASSET_TOO_LARGE`          | source exceeds its byte limit                             |
| `ASSET_MIME_UNSUPPORTED`   | MIME type does not match SVG or PNG/JPEG/GIF expectations |
| `ASSET_BRIDGE_UNAVAILABLE` | local reverse asset path is disconnected                  |
| `SVG_INVALID`              | XML or required SVG geometry is invalid                   |
| `SVG_EXTERNAL_REFERENCE`   | source depends on external content                        |
| `SVG_TOO_COMPLEX`          | source/import exceeds element, depth, or node limits      |
| `SVG_IMPORT_FAILED`        | Figma rejected the sanitized SVG                          |
| `SVG_WRAPPER_DIRTY`        | replacement would remove unexpected manual children       |
| `IMAGE_IMPORT_FAILED`      | Figma rejected URL or bytes                               |

Errors report one asset key and one next action. They never include inline binary, full SVG, stack
traces, capability URLs, or signed URLs. A failed public image URL instead identifies the exact
Canvas key and paint index that referenced it, without echoing the URL or its query.

## Implementation boundary

The shared contract, full SHA-256 store identity, hash-only reverse bridge, byte/hash cache, SVG
sanitizer, image MIME sniffing, stable SVG wrapper lifecycle, image-paint resolution, rollback,
verification, tests, and progressive skill guidance are implemented.

TemPad does not itself expose generated-image upload to the model. A host may provide the optional
private upload capability described above; otherwise generated imagery must arrive through a public
supported image URL. This is a client integration boundary, not a missing model-visible TemPad tool.

## Acceptance tests

At minimum cover:

- inline and Hub-backed SVG creation;
- multiple uses of one SVG asset;
- `currentColor` replacement and unresolved-color rejection;
- exact no-op retry;
- wrapper resize without reimport;
- source replacement with stable wrapper ID;
- manual sibling protection;
- masks, gradients, clipping, multiple paths, and multicolor SVG;
- malformed XML, active content, external refs, excessive depth/elements, and importer failure;
- current-file image hash, public URL, and Hub asset image creation;
- all image scale modes and filters through `assetKey`;
- missing, expired, wrong-MIME, oversized, and hash-mismatched assets;
- broker disconnect during download;
- failure after asset import rolls back canvas changes;
- apply output and error messages stay within the inline budget;
- material SVG/image compositions use bounded linked screenshots rather than binary responses.

Client integrations that provide generated-image upload separately verify that only the final hash
or public URL—not bytes, candidate history, or generation transcripts—enters model-visible
payloads. This is outside the TemPad extension and MCP server test boundary.

## Non-goals

- asset search or stock-photo selection;
- an icon-library registry inside TemPad;
- arbitrary SVG-to-VectorPath conversion;
- model-visible binary upload;
- server-managed subagents or image-generation orchestration;
- arbitrary local file reads or authenticated remote fetch recipes;
- stable identity or declarative editing for SVG importer descendants;
- automatic token binding across imported SVG descendants;
- tracing, vectorizing, or reconstructing raster images;
- using Figma primitives to imitate missing photos or illustrations.
