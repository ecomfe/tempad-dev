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

Create one native, editable Figma result. Work from intended experience and
evidence to the Figma artifact model, representation mechanics, serialization,
and rendered verification. Markup and classes only transport ordinary layer
hierarchy, layout, spacing, typography, color, and appearance; use native fields
where meaning depends on Figma node types, resources, or state. Tools, schemas,
catalogs, and examples support the result but do not determine the design.

Derive product, platform, accessibility, content, and visual requirements from
the user, permitted evidence, applicable expertise, or targeted research. This
skill provides a portable floor for composition, asset fidelity, reuse,
authoring, and verification; unrelated installed skills may deepen judgment but
must not determine baseline correctness. Identify needed expertise before
inspecting optional capabilities.

Before authoring, require an editable Figma Design file and an active MCP badge
in the intended tab. Use only the host's TemPad MCP tools. If they are absent,
report the integration problem and stop; never bypass the boundary, emit raw
Plugin API operations, launch the MCP CLI, recreate its transport, or substitute
shell commands.

## Authority and quality

Apply explicit user requirements first, then applicable evidence, this skill's
authoring and safety constraints, and situated judgment. Infer low-consequence
gaps; ask only when a missing choice would materially change the result.

- Ground material decisions in the brief, evidence, targeted research, or a
  stated low-consequence assumption. Tool availability and examples are not
  design evidence.
- Deliver one coherent result whose content, states, assets, and reusable
  resources agree with the brief and one another.
- Preserve required sources, assets, representations, and behavior rather than
  replacing them with easier substitutes.
- Make the result complete, editable, intentionally structured, and free of
  observed unintended defects. Disclose accepted limitations.

The brief and its evidence define task-specific quality; establish and verify
those criteria instead of prescribing their answers here.

## Workflow

1. **Fix scope and evidence.** Determine the smallest complete outcome, create
   or update target, relevant evidence, content and state distinctions to
   preserve, and unresolved material decisions. Use `get_code` only when an
   existing visual composition matters. Use `get_structure` only for hierarchy,
   ordering, spatial relationships, managed identity uncertainty, or targeted
   native-state read-back; set `options.native: true` only for masks, IMAGE paint
   hashes, layout grids, or frame guides. Create on the active page by default.
   Omit top-level `page` unless the user or evidence requires a specific page;
   never ask for or invent one merely to place new work.

2. **Resolve material design decisions.** Follow the user and permitted file or
   project evidence. For net-new screens, flows, or significant visual redesigns
   without an established composition, read
   [visual-composition.md](references/visual-composition.md) and
   [style-grounding.md](references/style-grounding.md). Before markup, inspect
   credible evidence for every unresolved initial visual, interaction, and
   detail decision. Search finds candidates; it is not evidence. Open the source
   or a recoverable artifact and inspect the relevant pixels or specification.
   Search-result tiles, snippets, style labels, memory, and optional-skill advice
   do not close the gate. Match source authority to the decision; visual evidence
   cannot establish unseen behavior. A source may cover several decisions only
   when it shows or specifies each one. Inspect named precedents even when
   familiar. Continue bounded research or report the blocked decision rather
   than authoring from memory.

   Form one product-specific visual thesis from the findings. It must determine
   hierarchy, composition and document behavior, type and rhythm,
   surface/edge/shape/depth grammar, interaction vocabulary, and asset
   treatment; mood words, palettes, or familiar motifs are not a thesis. Use a
   fit optional capability only for a decision that remains open after evidence;
   it may deepen, not replace, this gate.

   Before markup, audit each representative screen's material icon candidates.
   For navigation, search, filtering, sorting, save or share, disclosure,
   status or object categories, and compact utilities, choose icon, text, or
   both by recognition, scanning, and compactness. If none are icons, compare
   the result with inspected precedent; an equivalent compact icon role stays
   unresolved unless text is clearer for a screen-specific reason. Do not use
   acquisition effort to justify an all-text vocabulary, and do not add icons
   decoratively or by quota.

   Classify every visual mark, including symbols inside labels, by role,
   subject, medium, source, and Canvas delivery. A character or primitive that
   communicates an affordance, object, category, or direction remains an icon
   role beside words. If the result needs any icon, image, illustration,
   diagram, vector, or exact typeface, read
   [visual-assets.md](references/visual-assets.md) before selecting or loading
   an acquisition skill and before search, generation, upload, or markup.
   Before markup, scan literal text for
   pictographic Unicode, emoji, or symbols; route
   each icon through a permitted vector source or omit it when optional. Do not
   replace an image or icon role with convenient text, primitives, gradients,
   or invented SVG. Medium and visual consistency do not select an acquisition
   route; generation requires a named content, fidelity, rights, or import
   requirement that applicable sourcing cannot satisfy.

   Keep one compact private trace before the first write:

   ```txt
   Evidence: opened source/artifact -> visual/interaction/detail finding -> decision
   Visual thesis: product-specific anchor -> hierarchy/composition/document + type/rhythm + surface/edge/shape/depth + interaction/assets
   Icons: candidate role -> icon/text/both + clarity rationale -> inspected source/rights/visual fit -> delivery
   Assets: role -> subject -> medium -> decision context -> inspected source/rights -> delivery; generation only for a named unmet requirement
   Reuse: rank -> responsibility + consumers -> stable anatomy + differences -> Author or Direct + incompatibility
   Verification: representative pixels and native facts that must hold
   ```

3. **Model the result and choose a resource path.** Define visible node roles,
   grouping, layout, spacing, typography, color, appearance, media, states, and
   editable relationships in Figma terms before writing markup. Separate
   ordinary Canvas HTML details from native semantics such as exact resources,
   components, variables, masks, media paints, guides, or node types. Preserve
   established resource usage on updates, and keep hierarchy and visible states
   consistent with evidenced order or prerequisites. Do not let available
   classes or schema choose the medium, structure, or direction.

   Choose **Reuse** when evidence establishes a relevant existing system. For
   two or more screens or states, or any repeated semantic family, read
   [component-authoring.md](references/component-authoring.md) and run its gate
   before markup contains a second consumer, including siblings in one call.
   Inventory all recurring records and controls, rank them by spread and
   coordination cost, and resolve every qualifying responsibility; ranking sets
   implementation order, not scope. Author the highest-ranked first. Bound it
   at the smallest subtree that owns the complete job and model
   content, media, state, and label differences. A reusable label, icon, or
   button does not resolve its repeated parent row or card. Keep a candidate
   Direct only for a concrete structural, ownership, behavior, or contract
   incompatibility. Do not impose a quota or invent speculative APIs.

   - **Reuse:** read
     [design-system-reuse.md](references/design-system-reuse.md) and use only
     returned resources relevant to the result.
   - **Direct:** use primitives, literals, and allowed external assets only for
     local responsibilities. Do not call `get_design_system`, send `catalogId`,
     or use catalog refs. Excluding existing resources disables Reuse, not
     Author. Use one collision-resistant authoring-key prefix for task-created
     resources.
   - **Author:** when concrete consumers share a responsibility that should
     evolve together, or the user requires a local resource or system extension,
     read
     [design-system-authoring.md](references/design-system-authoring.md). Define
     native resources, contracts, bindings, and consumers, and track them for
     reconciliation.

   Treat an explicitly editable diagram as native semantics. Decide its
   independently editable connectors, nodes, and geometry, then declare matching
   LINE, ELLIPSE, RECTANGLE, or VECTOR shapes. Canvas HTML may serialize their
   hierarchy, placeholders, surrounding composition, and labels; styled FRAME
   rectangles or circles do not prove an editable diagram model.

4. **Load mechanics, then serialize.** Read only references for concepts chosen
   in step 3. Use Canvas HTML for the ordinary layer tree and typed fields for
   selected native capabilities; skip Canvas HTML for `markup: null`. For create
   or structural update, read
   [canvas-html.md](references/canvas-html.md) in full. For an update with
   trustworthy markup and unchanged structure, always read
   [Elements and identity](references/canvas-html.md#elements-and-identity), then
   only the changed Layout, Appearance, or text section. Preserve every
   unaffected element, attribute, and class, and leave markup unchanged for a
   native-only update. Copy complete private-native examples instead of guessing
   from Plugin API knowledge or validation failures. Treat the supported
   HTML/Tailwind subset as a transport boundary: never weaken the design or
   rebuild ordinary web composition in native DSL. Use a supported equivalent
   only when it preserves intent; otherwise report the missing capability.
   Read [paints-effects.md](references/paints-effects.md) before applying any
   nontrivial shadow, blur, glass, texture, noise, layered gradient, or advanced
   image treatment, including effects expressed only through classes.

5. **Prove one representative composition.** Apply and open the smallest
   composition that establishes visual language, content density, layout, and
   native representation before propagation. For net-new multi-screen or flow
   work, use one materially complete requested screen and inspect its PNG before
   serializing dependent screens. Do not write a second screen before opening
   and correcting that PNG; an empty board root or mutation summary does not
   satisfy this gate. A complete one-root result satisfies this gate
   only when permitted existing evidence already established both visual
   language and resource path before serialization. Never create a separate
   proof, mood board, visual-thesis panel, or unchanged duplicate. Inspect the
   representative pixels and correct visual language, hierarchy, density, and
   material treatment before extracting reusable resources or expanding the
   flow.

   Treat the corrected composition as a flow-wide visual contract. Every
   dependent screen must carry its relevant hierarchy, media logic, rhythm,
   material and shape grammar, and interaction or detail treatment. It need not
   repeat the same hero or asset count, but retaining only palette, type, borders,
   or isolated motifs while the rest becomes generic is failed propagation.

   On Author, replace representative usages with native instances or bindings
   and verify their contracts before propagation. Keep definitions in a minimal,
   separate source area. Verify the most demanding real consumer through its
   descendants; INSTANCE type and root dimensions alone do not prove wrapping,
   slot, media, or state content fits. If a real usage disproves a contract,
   revise its boundary or return it to Direct. Follow
   [design-system-authoring.md](references/design-system-authoring.md).

6. **Apply the complete result.** Call `apply_canvas` once per coherent root.
   Split large results at meaningful screen or section boundaries. To keep calls
   in one movable board, create one fixed Auto Layout parent at its final planned
   bounds before separate resource roots, then append bounded sections while
   omitting existing children so updates preserve them. Use independent roots
   when relative organization is not part of the deliverable. Never scan for
   free space, maintain a coordinate ledger, or translate a create root; TemPad
   positions new roots from rendered bounds.
   Immediately before each Canvas HTML create or structural update, inspect the
   final markup once as a whole: require a fixed width and height on the root,
   then trace every `w-full`, `h-full`, and `grow` against its direct parent's
   axis and the element's required dimensions. Give every absolute node exactly
   one edge per axis and fixed parent and child dimensions. Correct every
   violation before calling instead of serializing until the validator reveals
   them one at a time.
   At the same checkpoint, reconcile the final markup with the retained icon
   trace: account for every material candidate as icon, text, or both with its
   clarity rationale, and bind each selected icon to its inspected vector source.
   An untraced candidate or unsourced selected icon blocks the call.
   Reconcile every material content-bearing visualization and asset role with
   the retained trace; an unresolved or mislabeled proxy blocks the call.
   For markup with repeated records or controls, rescan the final content and
   `data-key` families as required by [component-authoring.md](references/component-authoring.md);
   any recurring responsibility omitted from the ranked trace reopens the gate.
   A payload containing an unresolved or Author candidate's second consumer
   must bind every included consumer as native instances or omit the second
   consumer. Planned later conversion and easier sibling or nested components
   do not pass.
   On Author, propagate native instances and bindings—literal lookalikes do not
   count—and keep main definitions visible as described in
   [component-authoring.md](references/component-authoring.md).

7. **Verify the delivered result.** After the complete apply, inspect the final
   board and materially distinct screens. Open `asset.localPath` when present;
   otherwise download and open the returned resource. Without an opened PNG, do
   not claim visual verification. Use `get_structure` to compare page-child root
   bounds when placement matters, a root moved after resizing, or the handoff
   claims multiple roots do not overlap. Coordinates are relative to each
   node's actual Figma parent; only page children are page-relative. Also inspect
   structure when a promise depends on exact native semantics, such as an
   editable diagram.

   Compare rendered evidence with the brief and every task-relevant line in the
   retained decision trace. Confirm that materially distinct screens preserve
   the resolved visual language and asset treatment. Check overlap, clipping
   including glyph ink, crowding or broken hierarchy and spacing, collapsed or
   obscured content, inconsistent states, and incorrect bindings. Inspect all
   visible outer edges and edge-adjacent type or controls in each screenshot
   before claiming no clipping; apply success is not evidence of intact pixels.
   Reapply the step 2 classification to each visible mark so its delivered node
   type cannot redefine the decided representation or asset medium. On Author,
   confirm visible, readable definitions and native INSTANCE or bound consumers
   for every selected usage. Test the most demanding real property values and
   compare instance descendant extents with the root; fix accidental overflow
   by resizing, adding a truthful variant, or narrowing the component boundary.
   Before handoff, re-check only previously named component candidates against
   actual consumers. Author every candidate that now qualifies, or record a
   concrete structural, ownership, behavior, or contract incompatibility;
   verification is not a late speculative-discovery pass.

   `verification.nativeFieldsChecked` proves only that declared paint, effect,
   grid, guide, mask, and managed-SVG fields matched retained Figma state; it does
   not prove pixels, undeclared native state, or other semantics. When the
   handoff depends on a mask, IMAGE paint, layout grid, or frame guides, read
   back `native` fields with `get_structure({ options: { native: true } })`;
   apply input and mutation success do not establish live state.

   Repair and recheck only affected compositions while preserving unaffected
   content, state, assets, and relationships. Do not claim verification until
   every observed defect is corrected, accepted with reason, or disclosed. Skip
   screenshots for mechanical text, token, prop, or hierarchy-only edits, and
   never turn the defect inventory into design requirements. A post-write
   mismatch is implementation evidence, not permission to delete design intent;
   correct it with an equivalent supported expression or disclose the platform
   limitation.

## Load references by decision

Load references only after selecting their branch or capability; they provide
mechanics, not design ideas.

Read each routed reference through EOF at the workflow step that selects it.
Do not batch later-stage references into an earlier read; a truncated combined
read leaves every truncated file unresolved until completed.

| Selected decision or capability                                          | Reference                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Net-new visual composition and anti-generic quality gate                 | [visual-composition.md](references/visual-composition.md)           |
| Unresolved material design decision                                      | [style-grounding.md](references/style-grounding.md)                 |
| Asset role, subject, medium, source, or typeface                         | [visual-assets.md](references/visual-assets.md)                     |
| Existing-system reuse                                                    | [design-system-reuse.md](references/design-system-reuse.md)         |
| Local-system authoring                                                   | [design-system-authoring.md](references/design-system-authoring.md) |
| Bounded research, asset, inventory, or visual-QA delegation              | [delegation.md](references/delegation.md)                           |
| Pages, sections, groups, Booleans, masks, transforms, shapes, or vectors | [document-geometry.md](references/document-geometry.md)             |
| Paints, media, effects, shaders, grids, or guides                        | [paints-effects.md](references/paints-effects.md)                   |
| Exact fonts, rich text, range styles, lists, or hyperlinks               | [rich-text.md](references/rich-text.md)                             |
| Components, variant sets, properties, or Slots                           | [component-authoring.md](references/component-authoring.md)         |
| Variables, collections, modes, or bindings                               | [variables.md](references/variables.md)                             |
| Paint, Text, Effect, or Grid styles and bindings                         | [local-styles.md](references/local-styles.md)                       |
| Canvas elements, identity, layout, appearance, and text syntax           | [canvas-html.md](references/canvas-html.md)                         |

## Create and update contract

Create describes one complete root. Update changes only `targetNodeId`; supplied
fields state desired values and omissions preserve live state. `removeKeys`
removes owned descendants; `markup: null` removes the update root. Keep
`data-key` stable and recover it from `get_structure.authoringKey`, not names.

## Safety

- Never write outside scope or use names as identity.
- Treat an instance as an authoring boundary: update its root or definition,
  never a definition-derived sublayer.
- Never remove manual or unkeyed content, external references, unmanaged
  resources, or a component with surviving instances.
- Never mutate remote resources, publish, detach or reset instances, or execute
  arbitrary JavaScript.
- Use explicit `null` only for supported links or managed resources that the
  requested result truly removes.
- Correct validation failures; never imitate an unresolved resource.
