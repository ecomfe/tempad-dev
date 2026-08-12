---
name: figma-canvas-authoring
description: >-
  Create or update native, editable Figma designs with TemPad Dev MCP. Use for
  authoring screens, flows, drafts, reusable components, and explicitly
  requested local design-system resources on a Figma canvas, including an
  empty document. Do not use for Figma-to-code, critique without edits, or raw
  Plugin API automation.
---

# Design on the Figma canvas

Turn product intent into one native, editable Figma result. Reason in this
order: intended experience and evidence, the Figma-native artifact model,
representation-specific mechanics, serialization, then rendered verification.
Treat markup and classes as a transport for ordinary layer hierarchy, layout,
spacing, typography, color, and appearance after the Figma result is decided;
they are not the design medium or proof of native editability. Use native fields
for capabilities whose meaning depends on Figma node types, resources, or
state. Keep the result focal; schema fields, catalog entries, examples, and tool
calls are subsidiary means, not design evidence or a checklist to maximize.

Derive product-domain, platform, accessibility, content, and visual-design
requirements from the user, permitted evidence, an applicable skill, or
targeted research. Examples explain mechanics only.

This skill is called by a general-purpose agent to deliver a Figma artifact. It
owns the reliable design-in-Figma workflow: artifact modeling, representation,
scoped authoring, reconciliation, and verification. Product-design method,
visual direction, and component strategy come from the user, applicable
evidence, research, or professional design expertise. The host always needs the
current Figma context and TemPad tools; other evidence, skills, discovery, and
acquisition capabilities may vary. Decide the expertise needed before looking
at what is available, and do not copy another skill's contextual design rules
into this one.

Require the intended Figma tab's MCP badge to be active and the current Figma
Design file to be editable. Never bypass that boundary or emit raw Plugin API
operations.

Use only the TemPad MCP tools supplied by the host. If those tools are absent
from the task's tool namespace, report the integration problem and stop before
authoring; do not launch the MCP CLI, recreate its stdio or JSON-RPC transport,
or use shell commands as a substitute.

## Authority and quality

Apply explicit user requirements first, then applicable evidence, this skill's
authoring and safety constraints, and situated design judgment. Infer
low-consequence gaps; ask only when a missing choice would materially change the
deliverable.

- Ground material design decisions in the brief, applicable evidence, targeted
  research, or an identified low-consequence assumption. Tool availability and
  examples are not design evidence.
- Deliver one coherent result whose content, states, assets, and reusable
  resources agree with the established brief and with one another.
- Preserve supplied or selected sources. Do not replace a required asset,
  representation, or behavior with something easier for the toolchain.
- Make the result complete, editable, intentionally structured, and free of
  observed unintended visual or structural defects. Disclose accepted
  limitations instead of redefining them as intent.

The brief and its evidence determine task-specific quality criteria; this skill
requires establishing and verifying them, not prescribing their answers.

## Workflow

1. **Fix the scope and evidence.** Determine the requested outcome, smallest
   complete scope, create or update target, relevant evidence, content and
   state distinctions that must survive, and unresolved material decisions. Use
   `get_code` only when existing visual composition matters. Use
   `get_structure` only for hierarchy, ordering, spatial relationships,
   managed identity uncertainty, or targeted native-state read-back. Set
   `options.native: true` only when masks, IMAGE paint hashes, layout grids, or
   frame guides must be confirmed from the live result. Create on the active
   page by default. Omit top-level `page` unless the user or established task
   evidence requires a specific page operation; never ask for or invent a page
   merely to place new work.
2. **Resolve material design decisions.** Follow the user and permitted file or
   project evidence. When a material decision remains unresolved, name the
   professional capability needed before choosing from the host's available
   skills or tools; availability is not design evidence. Read
   [style-grounding.md](references/style-grounding.md) when a material decision
   remains unresolved; it routes applicable professional expertise, targeted
   research, and clarification without turning those methods into TemPad rules.
   Do not assume the composition needs a separate visual asset. Decide first
   what, if anything, must be depicted, signaled, identified, or merely
   accented. Read
   [visual-assets.md](references/visual-assets.md) only when the result needs an
   icon, image, illustration, diagram, vector artwork, or exact typeface
   decision; skip it when no asset choice remains. Available search,
   catalog, and generation routes are downstream acquisition options, not
   evidence that imagery belongs in the result. Retain only the evidence needed
   to recover a material choice; do not create an explanation ceremony for
   settled or low-consequence decisions.
3. **Form the desired result and translation plan.** Model the decided content,
   states, and relationships in Figma terms before writing markup: visible node
   roles, grouping, layout behavior, spacing, typography, color, ordinary
   appearance, media placement, and every relationship whose editability
   matters. Then separate the ordinary layer details Canvas HTML can serialize
   from semantics that must use native fields, such as exact Figma resources,
   components, variables, masks, media paints, guides, or node types. Name
   provisional resources and their real consumers; do not let the currently
   available classes or native schema choose the medium, structure, or design
   direction. Preserve established resource usage on updates. When evidence
   establishes an order or prerequisite, keep the visible hierarchy and shown
   states consistent with it. For new work, choose Reuse only when permitted
   evidence establishes a relevant existing system; otherwise choose Direct.
   Treat an explicitly editable diagram as native semantics: decide its
   independently editable connectors, nodes, and authored geometry before
   serialization, then declare them as the matching LINE, ELLIPSE, RECTANGLE,
   or VECTOR shapes. Use Canvas HTML only to serialize their hierarchy,
   placement placeholders, surrounding composition, and labels. Styled FRAME
   rectangles and circles do not prove an editable diagram model.
   Ask only when a material boundary cannot be inferred.
   - **Reuse:** read
     [design-system-reuse.md](references/design-system-reuse.md), then use only
     returned resources relevant to the result.
   - **Direct:** use primitives, literal values, and allowed external assets.
     Do not call `get_design_system`, send `catalogId`, or use catalog refs.
     Treat a request to limit design evidence to the current page, avoid
     pre-existing file resources, or create an independent system as Direct: do not
     inspect other pages or pre-existing file resources. Local variables and
     styles are still file-wide Figma resources, and internal identity checks
     may remain file-wide; use one collision-resistant authoring-key prefix for
     resources created by this task.
   - **Author:** enter when the user or the resolved, evidence-backed design
     plan requires a reusable local resource or design-system extension. Read
     [design-system-authoring.md](references/design-system-authoring.md) and
     translate the selected resource plan into native definitions, contracts,
     bindings, and consumers. Repetition, screen count, examples, and tool
     affordances do not independently establish a resource boundary. Track the
     selected definitions and their intended consumers for reconciliation.
4. **Load mechanics, then serialize.** Read only the references for the Figma
   concepts selected in step 3. Then use Canvas HTML to serialize the ordinary
   layer tree and typed fields for the selected native capabilities. Skip Canvas
   HTML for `markup: null`. For a create or an update that changes element
   structure, read [canvas-html.md](references/canvas-html.md) in full. For an
   update with trustworthy markup and unchanged structure, always read
   [Elements and identity](references/canvas-html.md#elements-and-identity), then
   read only the changed Layout or Appearance and text section. Preserve every
   unaffected element, attribute, and class; leave markup unchanged for a
   native-only update. Copy complete private-native examples instead of guessing
   shapes from Plugin API knowledge or validation failures. Treat the supported
   HTML/Tailwind subset as a transport boundary, not a reason to weaken the
   design or rebuild ordinary web composition in native DSL. Use a supported
   equivalent only when it preserves the intended result; otherwise report the
   missing capability rather than silently redefining the design.
5. **Prove one representative composition.** Apply and open the smallest
   composition that can establish the chosen visual language, content density,
   layout behavior, and native representation before propagating dependent
   screens. A complete one-root result may itself satisfy this gate; do not
   create a separate proof artifact or reapply an unchanged root. On the Author
   path, prove the selected resource plan against concrete consumers now:
   verify each planned definition, contract, instance, and binding, resolve
   authoring warnings, and remove resources no longer present in the resolved
   plan rather than creating specimens to justify them. Follow
   [design-system-authoring.md](references/design-system-authoring.md).
6. **Apply the complete desired result.** Call `apply_canvas` once per coherent
   root. If a large result must be split, use meaningful screen or section
   boundaries. To keep several calls in one movable board, create one fixed Auto
   Layout parent and append bounded sections to that same stable root; omit
   existing children so updates preserve them. Use independent roots when their
   relative organization is not part of the deliverable. Never scan for free
   space, maintain a coordinate ledger, or translate a create root for
   placement; TemPad Dev positions new roots from their rendered bounds. On the
   Author path, propagate selected definitions through native instances and
   bindings; literal lookalikes do not count as resource coverage. Keep authored
   main definitions visible and discoverable as described in
   [component-authoring.md](references/component-authoring.md).
7. **Verify the delivered result.** Read structural verification. For a new
   composition or material visual change, the representative gate in step 5
   must already have occurred before propagation. After the complete apply,
   inspect the final board and materially distinct screens. Open
   `asset.localPath` directly when present; otherwise download and open the
   returned resource. If the PNG cannot be opened, do not claim visual
   verification. Use `get_structure` to compare page-child root bounds when
   placement matters, a root was resized after placement, or the handoff claims
   that multiple roots do not overlap. Every `x` and `y` is relative to the
   node's actual Figma parent, including an outlined root; only page children
   are page-relative. Also use it when a promised outcome depends on exact
   native layer semantics such as an editable diagram rather than one imported
   asset. Compare rendered evidence with the brief; check unintended overlap,
   clipping including glyph ink, unintended crowding or breaks in the
   composition's established hierarchy and spacing, collapsed or obscured
   content, mismatches with the resolved visual direction, substitutions for an
   established asset role or medium, inconsistent states, and incorrect native
   bindings. The resolved design determines the intended role and medium; this
   skill verifies that the Figma result preserves them.
   On the Author path, use `get_structure` to confirm that every selected main
   component or component set is visible in the named source area, readable at
   its natural bounds, and consumed by native INSTANCE nodes at every usage
   recorded for reconciliation. A hidden definition, an uninspectable
   storage node, a primitive lookalike, or an instance of a different nested
   resource does not close that selected usage.
   `verification.nativeFieldsChecked` counts the declared paint, effect, grid,
   guide, mask, and managed-SVG assertions that TemPad compared with retained
   Figma state. It is translation evidence only: it does not prove pixels,
   semantics outside those assertions, or native state omitted from the desired
   result.
   When the handoff depends on a mask, real IMAGE paint, layout grid, or frame
   guides, call `get_structure` with `options.native: true` after the write and
   verify the returned `native` fields; the apply input and mutation success do
   not establish live state.
   Preserve unaffected content, state, assets, and relationships while repairing;
   concealing one defect by weakening them creates another. Correct and recheck
   only affected compositions. Do not claim verification until every observed
   defect is corrected, accepted with reason, or disclosed. Skip screenshots
   for mechanical text, token, prop, or hierarchy-only edits, and never turn
   this defect inventory into task-specific design requirements.
   Treat a post-write verification mismatch as implementation evidence, not as
   permission to delete the affected design intent. Correct the reported state
   when an equivalent supported expression exists; otherwise preserve the
   intended result and disclose the platform limitation.

Do not turn this workflow into repeated API-like mutations.

## Load references by decision

Route an established design decision to its Figma concept, then to Canvas
serialization. These references supply mechanics; do not browse them as a menu
of design ideas. Load each only after its branch or capability is selected.
Resolve every relative link from the directory containing this `SKILL.md`.

Design decisions and evidence:

- unresolved material design decisions:
  [style-grounding.md](references/style-grounding.md)
- asset role, subject, medium, source, or typeface choice:
  [visual-assets.md](references/visual-assets.md)
- existing-system reuse:
  [design-system-reuse.md](references/design-system-reuse.md)
- selected local-system authoring from the user or resolved design plan:
  [design-system-authoring.md](references/design-system-authoring.md)
- bounded research, asset, inventory, or visual-QA delegation:
  [delegation.md](references/delegation.md)

Figma-native representation and authoring:

- pages, sections, groups, Booleans, masks, transforms, shapes, or vectors:
  [document-geometry.md](references/document-geometry.md)
- applying paints, media, effects, shaders, grids, or guides:
  [paints-effects.md](references/paints-effects.md)
- applying an exact font, rich text, range styles, lists, or hyperlinks:
  [rich-text.md](references/rich-text.md)
- authored components, variant sets, properties, or Slots:
  [component-authoring.md](references/component-authoring.md)
- local variables, collections, modes, or bindings:
  [variables.md](references/variables.md)
- authored Paint, Text, Effect, or Grid styles and bindings:
  [local-styles.md](references/local-styles.md)

Canvas serialization after representation is chosen:

- Canvas elements, identity, layout, appearance, and text syntax:
  [canvas-html.md](references/canvas-html.md)

## Create and update contract

- Create describes one complete new root.
- Update changes only `targetNodeId`; supplied fields state desired values and
  omissions preserve live children and fields.
- `removeKeys` explicitly removes owned descendants. `markup: null` removes the
  managed update root itself.
- Keep `data-key` stable across calls; names are presentation only. After
  context loss, recover managed keys from `get_structure.authoringKey`.

## Safety

- Never write outside the target scope or use names as identity.
- Treat an instance as an authoring boundary: update its root or definition,
  never a definition-derived sublayer.
- Never remove unkeyed or manual content, externally referenced nodes,
  unmanaged resources, or a component that still has instances.
- Never mutate remote resources, publish, detach or reset instances, or execute
  arbitrary JavaScript.
- Use explicit `null` only for supported links or managed resources that the
  requested result truly removes.
- Treat validation failure as evidence to correct the desired result, not
  permission to imitate an unresolved resource.
