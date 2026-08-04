# MCP canvas authoring

Status: implemented

## Decision

TemPad Dev gives an agent one declarative authoring language and keeps Figma operations inside the
extension:

```txt
task intent
  -> ground material visual invention in user / project / skill / research evidence
  -> choose reuse or direct resources from the user's constraints
  -> explicit design-system authoring branch only when requested
  -> optional get_design_system() for permitted existing-resource reuse
  -> optional exact skill reference for authored Figma-only resources
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

The model-visible surface remains five tools:

- `get_code` reads visible design as implementation evidence;
- `get_structure` reads hierarchy and geometry when composition is ambiguous and exposes stable
  authoring keys for managed nodes when an update resumes without prior call context;
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

## Style grounding

Canvas correctness does not supply design taste. When a task requires material visual invention,
the agent follows this evidence ladder:

1. explicit user direction;
2. permitted project, product, and Figma evidence;
3. a clearly applicable installed brand, domain, or visual-design skill;
4. bounded current research into the product domain.

An empty file and adjectives such as “clean” or “modern” are not style evidence. If the first three
sources do not establish a direction, the progressive style reference asks the agent to inspect two
or three current sources with different roles: production or official domain guidance for product
behavior, a strong product or editorial reference for art direction, and authoritative
accessibility or regulatory guidance when relevant. It retains only a short working brief and does
not feed page dumps or a mood board into the main task.

References are used as particulars from which the agent forms one domain-appropriate direction,
not as a surface to copy. This distinction matters because examples can either support problem
formulation or cause fixation depending on how they are presented. The workflow therefore assigns
each source a question, extracts principles, rejects unsupported model-default patterns, and checks
the rendered canvas against the brief once. It does not ask the model to produce a persuasive style
rationale: recent generative-UI evaluation shows that stated rationale and implemented UI can
diverge.

This belongs in a skill reference rather than the MCP protocol. Style judgment is contextual,
open-ended knowledge; adding a `style` field, a domain taxonomy, or another tool would turn weak
labels into false precision while increasing always-on context. The protocol continues to carry
only the desired native result.

The decision is supported by several complementary findings:

- Polanyi's account of tacit knowledge explains why practiced judgment cannot be reduced to an
  exhaustive rule set; project evidence, examples, and skills carry subsidiary know-how while the
  agent attends to the whole design ([The Tacit Dimension](https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html)).
- A controlled creativity study found that generative assistance improved individual outputs but
  made outputs more similar in aggregate. It studied writing rather than UI, so it is evidence of a
  general homogenization risk, not a direct UI result
  ([Doshi and Hauser, 2024](https://doi.org/10.1126/sciadv.adn5290)).
- UI-specific work reports generic LLM-generated interfaces and better alignment when task and user
  preferences guide inference ([AlignUI](https://arxiv.org/abs/2601.17614)). A recent generative-UI
  benchmark likewise found visual/layout convergence and gaps between claimed and implemented
  principles ([Design Theater](https://arxiv.org/abs/2607.22928)).
- Controlled research on examples found that contextualized examples supported formulation better
  than list presentation, which was associated with more fixation
  ([Formulating or Fixating](https://arxiv.org/abs/2401.11022)).
- Current Figma practice treats skills as a carrier for team judgment and web/project context as
  inputs that shape the result, matching this separation between capability and point of view
  ([Figma skills](https://www.figma.com/blog/got-skills-make-the-figma-agent-a-better-collaborator/),
  [context and custom tools](https://www.figma.com/blog/agent-custom-tools-context-skills/)).

This follows Polanyi's distinction between focal and subsidiary awareness: the agent attends to the
design outcome while relying on compact protocol exemplars rather than reconstructing every native
operation. It also addresses empirical tool-use failures: API-use research reports wrong arguments
and hallucinated APIs, while multi-turn agent benchmarks show inconsistent rule following even for
frontier models. Exact examples, conditional routing, strict validation, and a bounded visual check
are therefore correctness mechanisms, not optional prompt decoration. See
[The Tacit Dimension](https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html),
[Gorilla](https://arxiv.org/abs/2305.15334),
[$\tau$-bench](https://arxiv.org/abs/2406.12045),
[Design2Code](https://arxiv.org/abs/2403.03163), and the
[MCP tool contract](https://modelcontextprotocol.io/specification/draft/server/tools).

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
therefore attempts the native type-indexed query without calling `PageNode.loadAsync()` and skips
pages Figma refuses to expose. It never walks every node in JavaScript and never resolves canvas
instances merely to infer definitions. Figma's public Plugin API also does not enumerate unused
subscribed-library components or styles; the variables team-library API is not a general component
catalog.

The Figma UI has its own lazy, server-backed Assets index, but its React state and internal stores
are private, mount-dependent, and unstable. They are not a correctness dependency. In particular,
TemPad Dev never calls the UI store's synchronous `getState()` path and never treats names from that
index as sufficient design-system evidence.

`get_design_system` never calls `loadAllPagesAsync()` or `PageNode.loadAsync()`. Page loading remains
a write-only concern when `apply_canvas` explicitly targets a different page or must prove that an
explicit node/variable deletion has no surviving cross-page consumer; ordinary current-page create
and update paths do neither.

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

The parser fails closed on unknown elements, attributes, classes, or contradictory state. Native
Tailwind v4 utilities are accepted when their default value has a deterministic Figma equivalent;
arbitrary pixel/color values remain available off scale. It is not a browser and does not execute
CSS, JavaScript, project theme extensions, Tailwind variants/plugins, or remote page content. The
exact supported subset is documented in the canvas-authoring skill.

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

Create describes one complete new root. Without an explicit root `relativeTransform`, the extension
centers the result near the current viewport and, when occupied, places it in the first available
position to the right. It reads only top-level bounds from that destination page; the model does not
maintain a coordinate ledger. An explicit transform remains authoritative when placement is part
of the requested result.

Update is an incremental declarative patch scoped by `targetNodeId`:

- supplied nodes and fields state desired values;
- omitted live fields and children are preserved;
- `removeKeys` explicitly asserts that owned descendants must be absent;
- `markup: null` is the isolated assertion that the managed update root itself must be absent.

Omission never means deletion. Stable identity comes from `data-key`, not layer names. Repeating an
identical desired result is a no-op. `get_structure` returns that key as `authoringKey` on
TemPad-managed nodes, so a later session can recover identity from the live canvas instead of
guessing or recreating it.

The extension reads the latest canvas immediately before reconciliation, so the diff is between the
new desired result and current live state—not between two model messages. It minimizes mutations
subject to stronger constraints:

1. correct native result;
2. scope and ownership safety;
3. dependency-safe ordering;
4. one Undo boundary and rollback on failure;
5. no-op convergence;
6. only then, fewer Plugin API calls.

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
- declared sizing modes, fixed dimensions, and deterministic cross-axis fill geometry;
- Text auto-resize mode and non-empty intrinsic geometry;
- direct component identity;
- direct variable, style, and mode links;
- mask state.

`apply_canvas` returns counts and factual warnings:

```ts
type Verification = {
  status: 'passed' | 'warning'
  nodesChecked: number
  referencesChecked: number
  warnings: Array<{
    code: string
    message: string
    key?: string
  }>
}
```

`get_screenshot` is a separate read-only validation tool. It returns one bounded PNG as a linked MCP
resource backed by the existing capability URL; structured content contains metadata, not binary
bytes. A new composition or material visual change normally receives one final check. Routine text,
token, prop, and hierarchy-only edits do not need it, and any correction remains bounded to one
evidence-based pass.

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
