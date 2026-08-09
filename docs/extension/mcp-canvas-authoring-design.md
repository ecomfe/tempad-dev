# MCP canvas authoring

Status: implemented

## Decision

TemPad Dev gives an agent one declarative authoring language and keeps Figma operations inside the
extension:

```txt
task intent
  -> ground unresolved material design decisions in user / project / skill / research evidence
  -> optionally delegate isolated evidence, asset, inventory, or QA work
  -> choose reuse or direct resources from the user's constraints
  -> explicit design-system authoring branch only when requested
  -> optional get_design_system() for permitted existing-resource reuse
  -> optional exact skill reference for authored Figma-only resources
  -> optionally consume exact live component ids returned by earlier canvas work
  -> apply_canvas(desired result)
  -> resolve refs + validate
  -> diff latest canvas
  -> one undoable native patch
  -> structural verification
  -> optional get_screenshot validation
```

The model never emits Plugin API calls or an operation sequence. It describes the result once.
TemPad Dev chooses the safe operations against the latest live document.

User constraints govern routing. A request to avoid the file's design system skips
`get_design_system`, `catalogId`, catalog tags, and catalog refs. Creating new local variables,
styles, or components also does not require a catalog. The agent creates them only when the user
requests that resource or explicitly asks to create or extend a design system. Detailed modeling
guidance and executable resource shapes remain in progressive references rather than the core
skill or server instructions.

A current-page-only evidence constraint also keeps the agent from inspecting other pages or using
pre-existing file resources. It does not redefine Figma's file-wide variable, style, or authoring
identity scopes, and it does not prevent the extension from performing the file-wide identity
checks required for safe reconciliation.

The model-visible surface remains five tools:

- `get_code` reads visible design as implementation evidence;
- `get_structure` reads hierarchy and geometry when composition is ambiguous, exposes stable
  authoring keys for managed nodes when an update resumes without prior call context, and can
  optionally return compact live mask, IMAGE paint, layout-grid, and frame-guide state;
- `get_design_system` conditionally reads deterministic pages of discoverable design-system facts;
- `apply_canvas` is the only mutating tool;
- `get_screenshot` returns bounded visual evidence only when pixels affect the next decision.

## Why this is the right level

UI models have strong priors for HTML, common utility classes, and component props. They have much
weaker priors for large Figma node graphs and long imperative Plugin API traces. The public language
therefore uses:

- `div` for frame-like composition;
- `span` for editable text;
- returned custom tags for real Figma component instances;
- a strict Tailwind utility subset for common layout and appearance, including native default
  spacing, sizing, border, radius, opacity, rotation, and typography scales plus exact arbitrary
  pixel/color values;
- a typed `figma` extension for native state that HTML cannot represent honestly.

This is one dialect, not parallel “simple” and “advanced” languages. The native extension is an
escape hatch inside the same desired-result document. The agent pays for advanced detail only when
the task needs it.

Custom component tags are better than generic TemPad primitives because they are both familiar to
models and specific to the active design system. A returned `<Button>` carries more useful prior
meaning than `<TempadComponent>`, while `data-ref` still binds it to an exact Figma resource.

The same principle does not make a private Figma resource schema familiar. `variableCollections`,
local styles, component properties, and Slots have no broadly trained web syntax. Their mechanics
therefore stay subsidiary to the design task: the always-visible schema exposes the stable outer
shape and routing descriptions, while a matching skill reference supplies a complete executable
example only when the result needs that capability. The extension remains the strict validator and
executor.

## Evidence boundary for design decisions

Canvas correctness does not supply design judgment, but the Canvas skill must not become a product,
platform, accessibility, content, or visual-style handbook. Its responsibility is orthogonal: make
the agent identify material uncertainty, obtain appropriate evidence, translate the resulting
decision into native Figma state, and verify the delivered artifact.

The progressive skill therefore uses a decision-scoped evidence process:

1. inventory explicit user requirements and permitted project and Figma evidence;
2. isolate only unresolved decisions that could materially change the result;
3. inspect the nearest credible source whose authority covers each decision;
4. retain the exact source, applicable finding, authority boundary, and resulting decision;
5. stop when the uncertainty is resolved and verify the rendered result against that trace.

The process prescribes no universal UX checklist, source count, platform value, visual vocabulary,
or preferred design answer. Source types are selected by the open decision, and an applicable
installed domain skill may itself be evidence; a procedural Figma skill, remembered convention,
payload example, or available tool is not. Search snippets are discovery leads rather than inspected
evidence. Exact reproduction, mechanical edits, and decisions already established by sufficient
evidence do not trigger ceremonial research. Evidence must also match the decision's medium:
textual product guidance, including generic guidance from another skill, can establish behavior,
but direction-defining visual choices require an inspected visual artifact or exact visual
specification.

Asset delivery follows the same boundary. The task evidence determines whether an asset is needed,
what it depicts, how it should look, and whether an existing, licensed, generated, or vector source
fits. The authoring workflow requires only source integrity, applicable rights, fidelity, sufficient
quality, and an importable Canvas form. It does not rank those media routes globally or permit a
different subject, style, or medium merely because one tool is more convenient. Creative latitude,
native editability, and delivery speed do not establish a geometric image medium; the brief or
applicable visual evidence must do so. The import route is resolved before invoking asset production;
otherwise a local-only result creates avoidable work and pressure to substitute a different source
after the design decision has already been made. Crops, masks, overlays, and retouching may serve the
composition but do not make one branded or distinctive subject faithfully represent another.

This remains a progressive skill concern rather than a new MCP tool or `style` field because design
requirements and source authority are contextual and open-world. Encoding them as protocol state
would prematurely embed domain conclusions in the authoring contract. The MCP protocol therefore
continues to carry only the desired native result.

## Delegation and tacit integration

Polanyi's observation that “we can know more than we can tell” applies directly to design handoffs:
explicit requirements and evidence cannot exhaust the situated judgment formed from the user,
product, canvas, references, and emerging composition
([University of Chicago Press](https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html)).
Parallel workers add independent search, specialized tools, context isolation, or fresh review, but
handoffs lose context and coupled mutations require one ordered view of the whole.

The invariant is therefore **one writer, bounded scouts**. The main agent remains the only Canvas
writer and delegates only separable work that fits a compact brief, avoids shared mutations, returns
verifiable evidence or an isolated asset, and repays coordination cost. This is the manager pattern:
one agent retains control, synthesis, and final judgment
([OpenAI](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)).

Eligible scouts gather style evidence, produce one importable asset, inventory exact facts, or audit
a screenshot. Each receives one objective, frozen context, permitted tools and sources, exclusions,
an output format, and a stop condition; explicit boundaries prevent duplicated work and gaps
([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)). They return evidence,
not a design verdict. Ambiguous intent, final direction, coupled construction, same-root updates,
and acceptance stay with the main agent. Use one worker by default, at most two non-overlapping
workers, and verify every QA finding against the live canvas.

## Design-system retrieval

`get_design_system` is conditional evidence retrieval, not a canvas-authoring preflight. Use it
only when the user permits existing-resource reuse and that evidence is relevant. When used, it
starts without arguments and returns definitions only. It never inspects instances, applied
resources, text ranges, or other canvas usage, and it does not perform text, semantic, or relevance
retrieval.

A normal call returns an immutable catalog with:

- `catalogId`;
- deterministic, name-ordered component families from pages that are already accessible;
- local variables and variables directly referenced by returned definitions, with default-mode
  values when materialized;
- collections and mode refs;
- Paint, Text, Effect, and Grid style signatures;
- fill/effect shaders;
- omitted counts, `nextCursor`, and factual read warnings when applicable.

The normal result targets 16 KiB. Components, variables, and styles are interleaved first.
Collections/modes and shaders follow as progressive native detail. When more resources remain, the
caller continues the immutable catalog with its `catalogId` and returned cursor. Components are
grouped by family and expose only:

- short `ref`;
- generated tag;
- name, source page, variant count, and optional summary;
- native size;
- supported prop names, types, defaults, variant options, and a semantic label when the generated
  attribute name would otherwise lose the native meaning;
- explicit omission counts when compact props or options are truncated.

Other resources use short refs such as:

```txt
c1       component
v3       variable
k2       collection
m2_1     mode in collection k2
s4       native style
h1       shader
```

The short refs are meaningful only with their `catalogId`. Catalogs are session-local, immutable,
bounded to eight recent catalogs, and rejected if the connected Figma file changes.

When one resource could change the design decision, the caller sends its exact `ref` with the same
`catalogId`. Every detail response remains bounded by the shared 64 KiB limit. Component detail is
a normalized usage contract rather than a raw subtree dump: metadata, property definitions, valid
variant tuples, default-variant Auto Layout, semantic text/instance/slot anatomy, and a
`previewNodeId` for an optional screenshot. Descriptions, options, variants, traversal, and anatomy
are explicitly bounded and report omissions.

This paging-plus-detail retrieval is deliberate. The extension reports facts without pretending to
understand task relevance. The agent reads catalog pages only until it has enough evidence and retrieves
exact detail only when that detail changes the intended result.

### Discovery boundary

The extension discovers:

- local component definitions on pages whose contents Figma already makes accessible, through one
  optimized type-filtered query per page;
- local variables and variable definitions referenced by component defaults, styles, shaders,
  aliases, and extended collections;
- local native style definitions;
- shaders returned by Figma's shader API.

Figma does not expose a direct local-component listing API or a loaded-page predicate. TemPad Dev
therefore attempts the native type-indexed query without proactively loading pages and skips pages
Figma refuses to expose. It never walks every node in JavaScript and never resolves canvas instances
merely to infer definitions. Figma's public Plugin API also does not enumerate unused subscribed-
library components or styles; the variables team-library API is not a general component catalog.

The Figma UI has its own lazy, server-backed Assets index, but its React state and internal stores
are private, mount-dependent, and unstable. They are not a correctness dependency. In particular,
TemPad Dev never calls the UI store's synchronous `getState()` path and never treats names from that
index as sufficient design-system evidence.

`get_design_system` never calls `loadAllPagesAsync()` or proactively loads a page for discovery.
When the rewritten runtime reports its exact transient Figma-connection timeout, local resource and
font reads load only `currentPage` and retry the same idempotent operation once. Other page loading
remains a write concern when `apply_canvas` explicitly targets a different page or must prove that
an explicit node/variable deletion has no surviving cross-page consumer.

This boundary is intentional. Component names are explicit knowledge, but their practical design
meaning is carried by valid variants, exposed properties, layout, nested instances, slots, and
visual form. The compact catalog preserves attention for the task; exact component detail exposes
that actionable structure only after the agent has selected a plausible resource. Optional
`get_screenshot(previewNodeId)` supplies the remaining visual evidence without placing an image in
every discovery response.

## Empty documents

The agent follows this order:

1. obey the user's chosen resource strategy;
2. use discoverable file resources only when reuse is allowed;
3. use trusted user or project evidence;
4. if a draft is acceptable, create a small coherent primitive result and disclose that it is not
   design-system-backed;
5. stop only when the user requires a named design system and no evidence for it exists.

TemPad Dev does not generate a token library or component system merely to make a single screen.
When the user does request a design system, definitions are not sufficient: authored variables and
styles must be bound to representative final consumers, while component definitions must appear as
native instances. Repeated semantic spacing, sizing, radius, color, and typography roles are valid
token candidates; one-off geometry is not. A binding is representative only when the consumer
performs the resource's named semantic role. Equal raw literals, semantically mismatched bindings,
and definition specimens remain non-evidence. One representative binding proves connectivity but
does not close an intended shared role while concrete consumers meant to evolve with it remain
literal. The skill therefore works from concrete usage toward
reuse when the scope spans several usages: it may use a private working map when the scope warrants
one, validates a representative composition, completes the concrete usages, and then revisits the
resource plan before final QA. Responsibilities merit components when expected reuse, coordinated change, state
consistency, or variation makes a shared definition valuable after weighing divergence, contract
clarity, and abstraction cost. Repetition and structural similarity are evidence, never a threshold
or classification obligation; the first convenient component does not establish coverage. An
expressible state difference strengthens a shared contract when stable anatomy should evolve
together; it is not by itself a reason to preserve local copies. A decision to remain local must
instead rest on divergence or contract cost that outweighs coordinated change for the strongest
candidate actually reviewed, not a different group that is easier to keep local. Components already
authored are reconciled with the concrete usages that justified them before new candidates are
reviewed; replacing a representative instance with a same-responsibility local copy reopens that
contract decision. Authored semantic resources are likewise reconciled with their intended
consumers, and typography, layout, and appearance roles are compared independently when materially
part of the requested system; representative coverage in one role does not close another.
These are outcome constraints, not a fixed resource count, inventory, or required tool sequence;
the agent uses the cheapest sufficient evidence and leaves one-off or independently owned values
literal.
Selected component contracts must express real usage differences and appear as native instances.
A request to create a design system does not by itself require a canvas specimen. MCP
verifies objective identities and bindings; it does not infer semantic responsibility from equal
geometry or numeric values.

## Public `apply_canvas` contract

```ts
type ApplyCanvasInput = {
  mode: 'create' | 'update'
  targetNodeId?: string
  catalogId?: string
  markup: string | null
  native?: Record<
    string,
    {
      component?: { id: string }
      componentProperties?: Record<
        string,
        string | boolean | { variable: { id?: string; key?: string; variableKey?: string } }
      >
      variables?: Record<string, { variableKey: string } | null>
      variableModes?: Record<string, string | null>
      styles?: {
        fill?: { styleKey: string } | null
        stroke?: { styleKey: string } | null
        text?: { styleKey: string } | null
        effect?: { styleKey: string } | null
        grid?: { styleKey: string } | null
      }
      figma?: Record<string, unknown>
    }
  >
  variableCollections?: Record<string, unknown>
  styles?: Record<string, unknown>
  assets?: Record<string, unknown>
  removeKeys?: string[]
  page?: Record<string, unknown>
}
```

The public schema stays below 8 KiB; expanding the complete native schema would be roughly 190 KiB
before other instructions or task evidence. Common catalog variable/style refs live beside their
element as `data-var-*` and `data-style-*` attributes. The `native` sidecar is reserved for local
authored resources, mode overrides, and Figma-only state. Advanced fields expose object boundaries
and precise routing descriptions at the MCP layer, while their exact shapes and complete examples
load progressively from the canvas-authoring skill. The extension validates them against the
complete private native schema after short refs are expanded.

One markup tree is bounded to 100 elements and 12 levels. These limits are part of the public tool
description and the Canvas HTML reference so an agent can split a large composition before calling
the tool; the parser still rejects an oversized tree before any mutation.

Local collection, variable, and style authoring keys persist as file-wide identities. They must be
rooted in one collision-resistant prefix for the independent system rather than a generic product
name or collection-local shorthand. An intentional update recovers the existing keys instead.
Variable mode keys remain scoped to their collection. Same-result bindings use these identities
immediately, while later results use them to recover and update the same managed resources.

Resolved variable input rejects Figma-invalid scope combinations before mutation: `ALL_SCOPES` is
exclusive, and `ALL_FILLS` cannot be combined with `FRAME_FILL`, `SHAPE_FILL`, or `TEXT_FILL`.
`ALL_FILLS` may coexist with non-fill color scopes such as `STROKE_COLOR`.

An exact live component ID returned by prior `apply_canvas` work can be bound directly without
creating or refreshing a catalog. This keeps component authoring order flexible: the agent may
author definitions before composing, or compose first and later replace managed primitive usages
with instances. For TemPad-authored definitions, direct `componentProperties` may use the stable
property keys recorded during authoring. Catalog tags remain the normalized path for discovered
components and library reuse.

Authored-component publishable metadata is part of the component definition:
`descriptionMarkdown` and `documentationLink` live inside `figma.component`, beside `type` and
`properties`, rather than beside `figma.component`. The progressive component reference shows the
complete nesting so the compact public `figma` record does not invite shape inference.

The model can use exact `{ ref: "…" }` objects inside advanced state. The resolver expands them to
the correct component, variable, collection, mode, style, or shader identity and rejects:

- a ref without its catalog;
- an unknown or expired ref;
- a resource of the wrong kind;
- a mode paired with the wrong collection;
- a catalog from another Figma file;
- a `{ ref }` object containing additional fields.

## Canvas HTML

Every element has one stable `data-key`. `data-node-id` may adopt an exact live node during update.

```jsx
<div
  data-key="settings"
  data-var-fill="v1"
  data-var-gap="v4"
  class="flex flex-col w-[960px] h-[720px] gap-[24px] p-[32px]"
>
  <span
    data-key="settings/title"
    data-style-text="s2"
    class="w-fit h-fit text-[24px] font-semibold"
  >
    Team settings
  </span>
  <TextField data-key="settings/name" data-ref="c3" label="Team name" value="Platform" />
  <Button data-key="settings/save" data-ref="c1" variant="Primary" label="Save" />
</div>
```

```json
{
  "catalogId": "ds_…",
  "native": {
    "settings": {
      "variableModes": { "k1": "m1_2" }
    }
  }
}
```

Primitive tags are case-insensitive. Catalog tags preserve case, are childless, require their
returned `data-ref`, accept only returned props, and default to the component's native width and
height when sizing classes are omitted.

The markup root in create and update mode must resolve to fixed width and height. Fill, hug, and
grow sizing depend on a parent layout context and are therefore invalid at that declarative root,
even when an update target has a sized live parent.

The parser fails closed on unknown elements, attributes, classes, or contradictory state. Native
Tailwind v4 utilities are accepted when their default value has a deterministic Figma equivalent;
arbitrary pixel/color values remain available off scale. It is not a browser and does not execute
CSS, JavaScript, project theme extensions, Tailwind variants/plugins, or remote page content. The
exact supported subset is documented in the canvas-authoring skill. A plain ampersand remains text
when it does not begin a semicolon-terminated entity; supported named and numeric entities decode.

Create-mode uses Figma's CSS-aligned Auto Layout model. Inside strokes participate by default;
`box-content` explicitly excludes them, while center and outside strokes never affect layout. Each
frame owns its stroke setting. Fixed create geometry is rejected when it cannot contain its literal
padding and explicitly included inside stroke. Native Auto gap owns its zero minimum and
single-child start alignment, and Figma owns border-box distribution among `FILL` children. On
update, omission preserves the live stroke-layout setting; the Plugin API exposes no layout-version
setter.

Figma also treats a hidden in-flow child as absent from Auto Layout. A BOOLEAN component-property
reference on such a child is therefore a layout decision, not merely a paint change: it may remove
gap, move siblings, or resize a hugging ancestor. TemPad Dev returns
`layout-affecting-visibility-property` when the referenced child has another in-flow sibling or a
hugging Auto Layout parent. Fixed single-child slots and absolute children preserve geometry;
intentional optional-content reflow remains valid after both states are verified.

## Native extension

`native[data-key].figma` covers persistent Figma Design state with no honest HTML equivalent,
including:

- sections, intrinsic groups, and non-destructive Boolean operations;
- rectangles, lines, ellipses, polygons, stars, vector paths, and vector networks;
- native transforms, masks, corners, stroke geometry, blends, and aspect-ratio state;
- Paint, Effect, and Grid stacks, media, Pattern paints, and shaders;
- guides and wrapping/grid-specific layout state;
- rich-text ranges, lists, decorations, and node/URL hyperlinks;
- authored components, component sets, properties, sublayer references, Slots, and instance state;
- explicit variable modes and same-result node/resource references.

Top-level `variableCollections`, `styles`, and `page` support the corresponding native resources and
document state. These are advanced result fields, not additional mutation tools.

The private schema remains the source of truth for the exact shapes and contradictions. Full
capability boundaries are recorded in
[Canvas authoring coverage](./mcp-canvas-authoring-coverage.md).

Small inline or Hub-backed SVG documents and Hub-backed PNG/JPEG/GIF paints use the same
declarative result. The extension resolves them before mutation, imports them through Figma's native
SVG/image APIs, and keeps bytes out of model-visible payloads. Exact limits, ownership, and transport
rules are recorded in [Canvas SVG and image assets](./mcp-canvas-assets-design.md).

## Create and update semantics

Create describes one complete new root. The extension starts near the current viewport center,
checks the new root's rendered bounds against top-level bounds on the destination page, and when
occupied moves the whole result to the first available position to the right. A root
`relativeTransform` may supply rotation or skew axes, but its translation never controls create
placement. Placement verification uses the translated rendered bounds computed for that move rather
than immediately rereading Figma's eventually refreshed render bounds. The model does not inspect
the canvas for free space or maintain a coordinate ledger.

Update is an incremental declarative patch scoped by `targetNodeId`:

- supplied nodes and fields state desired values;
- omitted live fields and children are preserved;
- `removeKeys` explicitly asserts that owned descendants must be absent;
- `markup: null` is the isolated assertion that the managed update root itself must be absent.

This applies within a stroke as well: update may supply paint or weight alone
while the omitted counterpart preserves its live literal, style, or variable
state. Create still requires a complete visible-stroke contract.

An update targeted at an existing authored component or component set preserves that root's native
type when the root binding omits a redundant `figma.component` declaration. Supplying component
metadata still updates the authored contract explicitly. Existing keyed component and component-set
descendants likewise preserve their native types during a markup-only layout repair; newly introduced
component nodes continue to require an explicit declaration.

An update to an existing keyed native shape likewise preserves its node type when the binding omits
the redundant `figma.shape` declaration. Supplied geometry and shape fields still validate against
that live type. Creating a native shape continues to require an explicit shape declaration.

Omission never means deletion. Stable identity comes from `data-key`, not layer names. Repeating an
identical desired result is a no-op. `get_structure` returns that key as `authoringKey` on
TemPad-managed nodes, so a later session can recover identity from the live canvas instead of
guessing or recreating it. A node first introduced by either create or update starts with its key as
the layer name unless the desired result provides another name; omitting the name on an existing
node preserves its live name.

The extension reads the latest canvas immediately before reconciliation, so the diff is between the
new desired result and current live state—not between two model messages. It minimizes mutations
subject to stronger constraints:

1. correct native result;
2. scope and ownership safety;
3. dependency-safe ordering;
4. one Undo boundary and rollback on failure;
5. no-op convergence;
6. only then, fewer Plugin API calls.

Supplied child order is reconciled without replacing stable identities. Same-parent moves interpret
the insertion index against Figma's pre-move sibling list, including when an earlier child crosses
a later one; omitted siblings remain present and only move when the declared relative order
requires it.

Exact update targets, adopted `data-node-id` descendants, and direct component IDs are resolved
through Figma's asynchronous lookup API before reconciliation. Instance sublayers are not exact
authoring targets; they remain definition-derived. Resolved nodes stay in request state instead of
depending on later synchronous lookups. The rewritten runtime keeps a current-page synchronous
fallback for the brief state where the async lookup backend is not ready. The same async-first,
current-context fallback covers local variable, style, and collection reads, so native-resource
authoring does not fail merely because that backend is still connecting. Removed nodes are treated
as absent even if the async backend briefly returns a stale object after deletion. Root-removal
verification therefore uses the mutated node's removal state and its live parent's child list
instead of re-querying that eventually consistent lookup path.

## Reconciliation

The local deterministic pipeline is:

1. parse and validate the public input;
2. load the catalog and expand short/deep refs;
3. validate the resolved input with the complete native schema;
4. normalize component tags into native instance bindings;
5. parse Canvas HTML and utility classes into a typed tree;
6. preflight identity, scope, resources, fonts, media, dependencies, and deletion safety;
7. create or adopt nodes and resources;
8. apply layout, content, appearance, links, bindings, and supplied child order in dependency order;
9. apply late references and stabilize deterministic geometry after derived-layout setters;
10. remove explicitly absent owned state;
11. verify the live result;
12. commit one Undo boundary, or undo the whole attempt on failure.

Figma may expose a component definition's shared plugin data on its instance and descendants, so a
key value alone is not ownership proof. An instance root therefore records usage ownership
separately; an unmarked key is accepted only when distinct from its definition and is then claimed.
Ambiguous keys and all definition-derived descendants stay outside authoring identity, exact
adoption, and removal. Physical traversal still includes descendants for safety checks.

Existing nodes still reject ownership reassignment. Newly created Frames and Components normalize
an omitted fill to transparent and omitted overflow to Canvas HTML's visible default even during
update; explicit paint, style, variable, or `overflow-hidden` state then overrides that baseline.
This keeps Figma's creation defaults from changing the meaning of markup first introduced by an
incremental update. Main-axis `grow` is validated by its effective `FILL` sizing mode, so a
primitive track may use `grow w-fit` inside a row without being misclassified as a freeform
hug-sized Frame. Growing Text that transiently collapses to zero width is reflowed through a bounded
fixed-to-fill transition before verification. Figma owns nonzero cross-axis `FILL` geometry. The
reconciler estimates available space only to seed newly created or collapsed fills, subtracting
literal padding and only visible, included inside strokes. Verification checks that the declared
mode resolves to nonzero geometry instead of reimplementing Figma's final border-box distribution.
Figma sizing-mode setters run only for Auto Layout containers and Auto Layout children. Fixed
geometry in a freeform subtree is applied with `resize` without touching unavailable Auto Layout
fields; intrinsic Text sizing there is expressed through text auto-resize instead.

Component-property definitions are read only from component sets and non-variant components. The
same capability predicate governs rollback snapshots, reference checks, and document-wide variable
removal scans. Variant definitions resolve through their parent set, including while protecting
exact component references for rollback. This keeps both exact variant IDs and component-set IDs safe to
instantiate. A component-set reference creates its default variant; applying a VARIANT property may
then select another component in that set. Verification accepts that selected sibling only when it
belongs to the same set and the requested variant property values or bindings remain applied.

Figma may normalize Text auto-resize while truncation and maximum-line state changes. Reconciliation
therefore applies truncation state before the declared auto-resize mode, so fixed text boxes remain
fixed while still supporting native ending truncation.

After a failed mutation, reconciliation commits the partial attempt as the newest history entry
before triggering Undo. This keeps rollback scoped to that attempt in a long-lived plugin session
instead of consuming the preceding successful apply. Rollback verifies that the update root remains
resolvable. Exact pre-existing node/component references and unrelated top-level roots on the result
page also retain their type, parent, canvas key, geometry, and direct child identities; losing or
changing one is reported as rollback failure instead of masking partial corruption with the original
validation error.

The agent is not involved in any of these Plugin API steps.

Resolved native-schema failures return a bounded list of field paths and messages rather than the
complete validator diagnostic. This preserves enough evidence to repair advanced state without
consuming the next turn with repetitive union errors.

## Verification

Structural verification is mandatory. It checks:

- native node type and stable key;
- identity map;
- parent and child order;
- finite geometry;
- declared sizing modes, fixed dimensions, and resolved nonzero cross-axis fill geometry;
- Text auto-resize mode, non-empty intrinsic geometry, and non-collapsed growing text;
- direct component identity, including a requested variant selected within the referenced set;
- direct variable, style, and mode links;
- direct fill, stroke, and effect stacks, including resolved IMAGE hashes and paint fields;
- direct layout grids and frame guides;
- mask and managed SVG state.

`apply_canvas` returns counts and factual warnings:

```ts
type Verification = {
  status: 'passed' | 'warning'
  nodesChecked: number
  referencesChecked: number
  nativeFieldsChecked?: number
  warnings: Array<{
    code: string
    message: string
    key?: string
  }>
}
```

A variable or style newly created by the call but not referenced by the same desired result produces
an `unbound-created-variable` or `unbound-created-style` warning. This is intentionally non-fatal
because a multi-call design-system workflow may stage definitions, but the authoring skill requires
the final composition to bind or remove every warned resource. A same-result reference proves
connectivity only; it does not prove that a specimen or semantically unrelated property is a
representative consumer.

A same-call authored variable binding whose literal fallback matches none of the variable's direct
mode values produces `variable-fallback-mismatch`. Local aliases are followed until a direct value
is reached; unresolved external aliases are skipped. This warning catches contradictory desired
state without rejecting legitimate multi-mode fallbacks, because matching any authored mode is
sufficient.

A visible component-property reference that can alter Auto Layout flow produces
`layout-affecting-visibility-property`. It is also non-fatal because optional content may be
designed to reflow. The authoring workflow must either preserve geometry with a fixed slot,
absolute child, or geometry-equivalent variants, or explicitly accept the verified state change.

A managed Text or component instance that extends outside its direct Frame or Component parent
produces `managed-content-overflow`, including the affected edges and whether native clipping is
enabled. It remains non-fatal because deliberate overflow and crop are valid composition tools; the
warning makes accidental content cropping or overlap inspectable without prohibiting either.

Its structured result also returns `rootNodeId` and the bounded `nodeIdsByKey` identity map so a
later Author call can consume an exact component created by the preceding result.

`get_screenshot` is a separate read-only validation tool. It returns one bounded PNG as a linked MCP
resource backed by the existing capability URL; structured content contains metadata, not binary
bytes. The client must download and display the actual PNG before claiming pixel-level verification;
receiving or copying the link is not inspection. When it is the representative-screen gate, that
inspection precedes any dependent canvas write. For material
design changes, a representative composition is checked before its decisions propagate, then the
final board and materially distinct screens are checked for defects that a board overview may hide.
Routine text, token, prop, and hierarchy-only edits do not need screenshots; corrections recheck
only the affected composition. When page-level placement matters, a root was resized after placement, or the
final report claims that multiple roots do not overlap, spatial QA compares their page-space bounds
with `get_structure` because isolated screenshots cannot establish that relationship. Native-state
QA sets `options.native: true`; the returned per-node `native` block contains mask type, IMAGE fill
hashes and scale modes, ordered layout grids, and ordered frame guides when present. This makes
mask order plus state, real image delivery, and grid/guide authoring independently readable instead
of treating the apply request as proof that Figma retained the desired native properties.

## Safety boundaries

- MCP access is disabled by default. While it is enabled, authoring is available in editable Figma
  Design files; Dev Mode and native read-only rejections fail with stable errors.
- The extension requires `window.INITIAL_OPTIONS.editor_type === "design"` before parsing and
  normalizes any remaining native read-only mutation rejection to `CANVAS_READ_ONLY`.
- Only one apply may run per connected session.
- Update cannot write outside `targetNodeId` or its explicitly declared resource/page scope.
- Remote resources are imported or referenced, never edited or deleted.
- Managed resources are removed only after every live consumer is cleared or removed.
- Manual or unkeyed content is never deleted by omission.
- Components with surviving instances, dependency targets, masks, intrinsic-container operands, and
  other live references block unsafe removal.
- Unsupported, ambiguous, or internally contradictory inputs fail before mutation.
- Any mutation-stage failure rolls back the entire apply.
- MCP annotations mark all reads as read-only and `apply_canvas` as potentially destructive and
  non-idempotent because its create mode can add another root. These hints improve client routing;
  deterministic scope, ownership, validation, and rollback remain the actual safety boundary.

## Deliberate non-goals

- no tool per Plugin API method;
- no imperative patch language;
- no agent-side diff planning;
- no browser-grade HTML/CSS renderer;
- no automatic design-system invention;
- no routine screenshot loop;
- no Dev Mode metadata, Dev Resources, exports, prototypes, FigJam, Slides, Widgets, Draw, Motion,
  or Make authoring.

The core product remains a small bridge: retrieve the right design facts, describe one result, and
let deterministic local code make it native and safe.
