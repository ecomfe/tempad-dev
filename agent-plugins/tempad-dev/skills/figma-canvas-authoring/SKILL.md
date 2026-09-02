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
the user, permitted evidence, applicable expertise, or targeted research.
Suitable product or interface-design expertise may contribute scoped constraints
and judgment; the product-specific direction must still come from the brief and
evidence. This skill remains responsible for Figma execution, representation
integrity, verification, and a portable quality floor.

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
- Do not derive product content or personalization from unrelated account,
  filesystem, task, page, or tool metadata. When the brief supplies no identity,
  keep it neutral rather than inventing one from context.
- Deliver one coherent result whose content, states, assets, and reusable
  resources agree with the brief and one another.
- Preserve required sources, assets, representations, and behavior rather than
  replacing them with easier substitutes.
- Make the result complete, editable, intentionally structured, and free of
  observed unintended defects. Disclose accepted limitations.

The brief and its evidence define task-specific quality; establish and verify
those criteria instead of prescribing their answers here.

## Workflow

1. **Fix scope and evidence.** Determine the smallest complete outcome, target,
   relevant evidence, content and state distinctions, and unresolved material
   decisions. Use `get_code` only when existing composition matters or for the
   post-representative resource decision in step 5. Use `get_structure` only for
   hierarchy, geometry, identity uncertainty, or routed native read-back.
   Use the exact target established by the user or current context. When the
   request names the current or selected page, write there and do not create or
   activate another page. Only when a fresh page is part of the task, use
   page-only `apply_canvas` create with a stable `pageKey`, then activate it when
   current-page context matters. An exact known page can receive a root directly
   without activation. Never use browser automation, a disposable proof node,
   or an invented page for setup.

2. **Resolve material design decisions.** Follow the user and permitted file or
   project evidence. For net-new or materially redesigned product interfaces,
   read [visual-composition.md](references/visual-composition.md) and
   [style-grounding.md](references/style-grounding.md). For other work, use
   style-grounding when the user asks for design research or a material choice
   remains unresolved. Research must inspect actual product artifacts, not stop
   at prose descriptions, and must translate principles rather than motifs.

   Use applicable design expertise to turn the brief and evidence into one
   product-specific thesis: identify the working object and relationship that
   organize the experience, then let document behavior, type, material,
   interaction, and assets reinforce them. A mood or style label is not enough.

   Before markup, resolve how to represent the central working object and
   interactions. Choose text, icon, image, data visualization, diagram, or
   another medium by what the product needs people to recognize and do—never by
   quota or implementation convenience. Primitives may encode layout, state,
   data, or an explicitly schematic diagram, but may not impersonate meaningful
   content. When an icon role—including a character or primitive used as an
   affordance—another visual asset, or an exact typeface is selected, read
   [visual-assets.md](references/visual-assets.md) before acquisition or markup.
   Retain only enough private rationale to keep evidence, decisions, and later
   verification coherent; do not turn it into a fixed design report.

3. **Model the result and choose a resource path.** Define visible roles,
   grouping, layout, type, color, media, states, and editable relationships in
   Figma terms. Separate ordinary Canvas HTML from exact resources, components,
   variables, masks, media paints, guides, or native node types.

   - **Reuse:** only when the user, selected source, or applicable project
     evidence establishes the identity of a relevant existing system. A catalog
     name, source page, domain match, or mere presence in the file is not such
     evidence. Then read [design-system-reuse.md](references/design-system-reuse.md)
     and use only resources relevant to the result.
   - **Direct:** the default for a first complete net-new design. Use primitives,
     literals, and permitted assets; do not call `get_design_system`, use catalog
     refs, or author resources merely because values or shapes repeat.
   - **Author:** only when the user requested reusable resources, project evidence
     makes them part of the deliverable, or the user accepts a separate pass.
     Read [design-system-authoring.md](references/design-system-authoring.md) and
     select only responsibilities whose real consumers justify the contract.

   Treat an explicitly editable diagram as native semantics with independently
   editable nodes and connectors, not styled FRAME lookalikes.

4. **Load mechanics, then serialize.** Read only references selected by step 3.
   For Canvas HTML create or structural update, read
   [canvas-html.md](references/canvas-html.md) in full. For a trustworthy
   unchanged structure, read its identity section plus only the changed layout,
   appearance, or text section. Page-only operations omit markup. A native-only
   update also omits markup, targets one exact managed root, and addresses only
   existing stable keys inside it, preserving topology. Preserve every
   unaffected field and keyed element. Use supported
   equivalents only when they preserve intent; otherwise report the missing
   capability. Read [paints-effects.md](references/paints-effects.md) before any
   nontrivial shadow, blur, glass, texture, noise, layered gradient, or advanced
   media treatment.

5. **Prove one representative composition.** Apply the smallest materially
   complete real screen that establishes visual language, density, layout, and
   representation, then stop and open its PNG. A skeleton, mood board, resource
   area, generated concept image, mutation summary, or unchanged duplicate does
   not count. Keep possible components and tokens Direct until this screen is
   visibly usable and shaped by its product context.

   After that check, read [variables.md](references/variables.md) only when
   repeated colors plausibly represent shared semantic roles that should evolve
   together. On Author, read
   [component-authoring.md](references/component-authoring.md), reconcile real
   consumers, and verify one native usage before propagation. Carry the corrected
   visual contract across dependent screens as described in
   [visual-composition.md](references/visual-composition.md); preserving only
   palette, type, or isolated motifs is not propagation.

6. **Apply the complete result.** Call `apply_canvas` once per coherent root and
   split large work at meaningful screen or section boundaries. For one movable
   board, create a fixed final-bounds parent before appending bounded sections;
   omitted existing children remain. Never scan for free space, keep a coordinate
   ledger, or translate a create root.

   Immediately before each Canvas HTML call, run the preflight in
   [canvas-html.md](references/canvas-html.md). Reconcile selected icons,
   visualizations, and assets with their decided roles and sources; do not send
   invented or unsourced content. On Author, included consumers must already be
   native instances or bindings—literal lookalikes and planned later conversion
   do not count.

7. **Verify the delivered result.** Open the final PNG and materially distinct
   screens; without opened pixels, do not claim visual verification. Compare the
   result with the brief and decided direction, including hierarchy, density,
   outer edges, glyph clipping, crowding, content loss, interaction and state
   contradictions, and asset treatment. Use `get_structure` only where
   placement, identity, editability, or routed native semantics matter. Mutation
   success and `nativeFieldsChecked` do not prove pixels or undeclared state.

   Inspect—not summarize away—the full result of every `apply_canvas` call.
   Correct failures; repair each verification warning or state why the reported
   geometry is intentional before finalizing.

   Repair and recheck only affected compositions while preserving unaffected
   content, state, assets, and relationships. Keep the last opened usable
   composition as the recovery point: a failed local repair is evidence to fix
   that payload or boundary, not to remove or wholesale recreate the working
   root. Validation repair may change transport syntax or geometry, not discard
   the decided hierarchy, controls, icon roles, or assets. Replace the root only
   when an observed structural defect requires replacement and the complete
   intent can be preserved. Finish only when each observed defect is corrected,
   accepted with reason, or disclosed.

   Deliver a verified Direct result when Author was not selected. If a plausible
   reusable responsibility remains, ask an actual optional yes-or-no question
   about a separate component pass; do not delay delivery or imply incompleteness.

## Load references by decision

Load references only after selecting their branch or capability; they provide
mechanics, not design ideas.

Read each routed reference through EOF at the workflow step that selects it.
Do not batch later-stage references into an earlier read; a truncated combined
read leaves every truncated file unresolved until completed.

| Selected decision or capability                                          | Reference                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Net-new visual composition                                               | [visual-composition.md](references/visual-composition.md)           |
| Product-interface research or unresolved material design decision        | [style-grounding.md](references/style-grounding.md)                 |
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

Create describes one complete root or one exact new page. Update changes an exact
`targetNodeId` or page; supplied fields state desired values and omissions
preserve live state. With no structural change, target the managed root and send
only `native` for its existing stable keys. `removeKeys` removes owned
descendants inside an update; top-level `mode: "remove"` removes an exact managed
root or page. `mode: "activate"` changes exact page context and optional selection
without requiring a document mutation. Keep `data-key` and `pageKey` stable and
recover them from structured tool results, not names.

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
