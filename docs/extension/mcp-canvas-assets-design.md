# MCP Canvas SVG and image assets

Status: implemented, including programmatic generated-image upload
Date: 2026-07-31

## Decision

Keep `apply_canvas` as the only canvas-mutating tool. Add a call-scoped asset manifest, one SVG placement
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

This document owns asset transport, validation, and native ownership. The
[Design in Figma skill](../../agent-plugin/src/skills/design-in-figma/SKILL.md) owns asset selection,
provenance, delegation, and visual acceptance through its conditional references. Keep those
task policies in the skill rather than duplicating them in the protocol design.

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
  assets?: Record<CanvasStableKey, unknown>
}
```

As with `styles`, `variableCollections`, and advanced `native` state, the public schema exposes the
outer record while keeping each asset definition opaque. The resolver validates the complete
private shape:

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

Allow at most 32 declarations and 64 KiB of inline SVG across one call. Every declaration must be
referenced, every reference must exist and match the required type, and page-only or remove
operations cannot carry assets. These rules prevent an asset manifest from becoming hidden
general-purpose payload storage.

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
proxy. On this reverse path, binary encoding stays inside the extension bridge; `apply_canvas`
carries only the manifest's hash. The dedicated `upload_asset` call is the bounded client-to-Hub
data-URL path described below. The page still receives the existing capability URL solely to
describe outbound assets already uploaded by `get_code` and `get_screenshot`.

The page caches downloaded bytes by content hash until its bridge disconnects or is disabled;
failed downloads are evicted. Imported Figma image hashes use a separate bounded cache and are
checked with `getImageByHash` before reuse. A bridge reconnect does not invalidate native file
handles. See [asset transport](../../packages/extension/mcp/assets.ts) and
[media preparation](../../packages/extension/mcp/tools/canvas/media.ts) for cache ownership.

### Agent-generated images

`upload_asset` is Hub-only, content-addressed, idempotent, and bounded by the existing per-asset and
aggregate quotas. It accepts no local path, remote URL, headers, credentials, SVG, or arbitrary MIME
type. It validates base64 canonically, recomputes SHA-256, and stores through the existing loopback
asset server. Its response contains only `assetHash`, MIME type, and size.

Hosts compose generation and upload programmatically, passing the generated `data:` URL directly
to `upload_asset` and using its returned hash in later Canvas calls. Hosts without that composition
path can use a public image URL. Acquisition decisions and recovery belong to the skill's
[images reference](../../agent-plugin/src/skills/design-in-figma/references/images.md).
Optional delegation follows its
[delegation reference](../../agent-plugin/src/skills/design-in-figma/references/delegation.md);
TemPad does not expose or orchestrate subagents.

Do not accept:

- base64 or data URLs in `apply_canvas`;
- arbitrary local file paths;
- credentials, headers, cookies, or signed-request recipes;
- a server-side “fetch any URL” endpoint.

These alternatives respectively consume model context, expose local files, leak secrets, or create
an SSRF surface.

### Content identity

New asset descriptors and store paths use the complete lowercase SHA-256 digest. The extension and
Hub validate the digest again after every upload and download. The current asset capability retains
download-only support for legacy 8-character identifiers. Unversioned extensions receive a separate
compatibility capability that also accepts their short-hash uploads, validates the SHA-256 prefix,
and compares complete contents before reusing an existing short hash. Collisions fail without
overwriting bytes. Both capabilities share quotas and concurrency limits. Modern exports and
`upload_asset` always return full digests; see the [legacy gateway](mcp-browser-gateway-design.md#released-unversioned-extensions).

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

Use the [XML wrapper](../../packages/extension/mcp/tools/canvas/svg-xml.ts) around `svgson`
to preserve entity, CDATA, whitespace, and attribute semantics through parsing and serialization.
The sanitizer resolves namespaces and checks decoded CSS escapes for external references.
Changing the import policy invalidates previous SVG digests. Do not build an SVG renderer or path
parser. Figma remains the rendering and import authority.

After `createNodeFromSvg`, reject and roll back if Figma produces:

- zero or non-finite geometry;
- more than 500 imported nodes, including the root;
- a node outside the expected managed wrapper;
- an import error.

Error messages identify the asset key and violated rule but never echo SVG source.

## Reconciliation and ownership

### SVG

The stable Canvas node is a managed wrapper frame. It contains exactly one plugin-owned imported
SVG root. Store only bounded metadata on the wrapper:

- source SHA-256;
- resolved `currentColor`, if any;
- import-policy version.

The imported root carries its own ownership marker. The source itself is not stored in plugin data.

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

Media downloads and image/video handle creation run before the first Undo boundary so network waits
do not extend the canvas mutation window. SVG node import, paint assignment, placement, and later
reconciliation run inside that boundary; failures there trigger the existing rollback.

Any temporary SVG import frame must be removed before success. Unreferenced media handles created
during preparation are outside the canvas rollback guarantee. Native Undo reclamation of those
handles remains unverified; handle identity alone does not establish that an image renders.

## Verification

Extend mandatory structural verification:

- an SVG wrapper has the expected stable key and `FRAME` type;
- it has exactly one owned imported root plus no unexpected children;
- stored source digest, color, and import-policy version match the desired placement;
- imported geometry is finite and contained within the wrapper;
- an asset-backed image paint contains the resolved Figma `imageHash`;
- all existing paint fields still match.

Do not export SVG or image bytes into the result. Return only normal mutation counts and bounded
warnings. These structural checks do not prove visual fidelity; the authoring skill owns the
required native and screenshot observations for the requested change.

## Context budget

The feature adds almost no always-on context:

- one narrow Hub-only `upload_asset` tool for programmatically composed image data URLs;
- one `assets` record with opaque definitions in the public canvas schema;
- one sentence in the tool description only if needed;
- exact syntax stays in the Design in Figma skill's progressive visual-assets reference;
- asset bytes move through the local binary bridge;
- full validation errors are bounded and source-free;
- apply results never repeat sources or previews.

The 32 KiB inline SVG ceiling is a safety limit, not a recommended prompt budget. Larger sources
use Hub-backed assets; the authoring skill owns medium and source selection.

## Provenance and privacy

TemPad imports exact caller-provided content; it does not search for assets, determine copyright
status, or grant usage rights. The authoring skill owns source and rights evidence under the
applicable user and project policy.

Do not log SVG source, raster bytes, remote URL queries, capability URLs, or upload tokens. Logs may
contain only asset key, content hash, MIME type, byte count, dimensions, and bounded failure code.
The existing local-store TTL applies to inbound assets, and a content hash is identity rather than
authorization.

`imageUrl` causes an external fetch and can disclose ordinary request metadata to the remote host.
Use it only for public assets; private/generated bytes should use the local content-addressed path.

Video downloads use page-context Fetch with HTTPS, omitted credentials, and rejected redirects.
The shared resolved-input schema and runtime use the same URL check, so blocked URLs are rejected
before any sibling media is imported. These checks reject common local address literals and names,
but do not verify the destination IP
after DNS resolution. CORS does not prevent every outgoing request. Remote media must come from
trusted public sources; these checks are not a general private-network access barrier.

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

TemPad exposes the Hub-only `upload_asset` tool for generated-image data URLs. The host must compose
generation and upload programmatically so encoded bytes never need to be copied through model
context. Hosts without that composition path can use a supported public image URL.

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

MCP server tests cover upload decoding, MIME validation, quotas, hashing, and response shape.
Client integrations separately verify that generation and upload are composed without exposing
encoded bytes, candidate history, or generation transcripts to the model; later canvas calls carry
only the final hash or public URL.

## Non-goals

- asset search or stock-photo selection;
- an icon-library registry inside TemPad;
- arbitrary SVG-to-VectorPath conversion;
- model-authored or model-visible encoded image bytes;
- server-managed subagents or image-generation orchestration;
- arbitrary local file reads or authenticated remote fetch recipes;
- stable identity or declarative editing for SVG importer descendants;
- automatic token binding across imported SVG descendants;
- tracing, vectorizing, or reconstructing raster images;
- using Figma primitives to imitate missing photos or illustrations.
