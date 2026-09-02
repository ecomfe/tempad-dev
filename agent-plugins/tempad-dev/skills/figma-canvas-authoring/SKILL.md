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

Create one native, editable Figma result. Keep the intended product experience
focal. The brief, inspected artifacts, professional knowledge, tools, schemas,
and rendered checks are clues to think from, not separate targets to optimize.

Use exact rules for scope, permission, identity, source fidelity, native
representation, serialization, and observed defects because errors there are
concrete. Leave product structure, interaction, visual language, hierarchy,
density, and media treatment to situated design judgment because their right
answer depends on the task. Never turn a past result, benchmark, example, or
tool affordance into a preferred style.

Before authoring, require an editable Figma Design file and an active MCP badge
in the intended tab. Use only the host's TemPad MCP tools. If they are absent,
report the integration problem and stop; never bypass the boundary, emit raw
Plugin API operations, launch the MCP CLI, recreate its transport, or substitute
shell commands.

## Non-negotiables

Apply explicit user requirements first, then applicable evidence, this skill's
authoring and safety constraints, and situated judgment. Infer low-consequence
gaps; ask only when a missing choice would materially change the result.

- Use the exact target established by the user or current context. Write to a
  known page directly; create or activate a page only when the task calls for
  it. Never use browser automation, a disposable proof node, or an invented page
  to set up the canvas.
- Ground material decisions in the brief, inspected evidence, applicable
  expertise, or a stated low-consequence assumption. Model recall, search
  snippets, tool availability, and skill examples are not product evidence.
- Preserve required sources, content, behavior, states, and representations.
  Do not replace a hard-to-source image, icon, visualization, or native semantic
  with easier text or plausible geometry.
- Keep unrelated account, filesystem, task, page, and tool metadata out of the
  product. When the brief supplies no person or product identity, keep it
  neutral rather than inventing personalization or branding from context.
- Keep research artifacts outside the authored result unless the user explicitly
  asks to reproduce, place, annotate, or compare them on the canvas.
- Deliver one coherent result that is complete, editable, intentionally
  structured, and free of observed unintended defects. Disclose accepted
  limitations.

The brief and its evidence define task-specific quality. This skill shapes how
to reach and verify a decision; it does not prescribe the visible answer.

## Situated authoring loop

1. **Frame the experience.** Determine the smallest complete outcome, exact
   target, person and situation, consequential content and states, and the way
   the application behaves beyond one captured frame. Choose natural document
   flow, a fixed shell with owned scrolling regions, or a hybrid from the
   product's work—never from a preferred screenshot size. Use `get_code` when an
   existing composition matters and `get_structure` only for hierarchy,
   geometry, managed identity, or routed native read-back.

2. **Encounter relevant reality.** For a net-new or materially redesigned
   interface without an established system, read
   [visual-composition.md](references/visual-composition.md) and
   [style-grounding.md](references/style-grounding.md), then open real product
   screens or a permitted implementation at useful scale before the first
   Canvas write. The evidence must expose the product or interface relationships
   informing the design: subject or content imagery grounds only what it depicts,
   not the surrounding interaction, composition, or visual system. Search
   results, prose descriptions, URLs, thumbnails, generated images, and failed
   retrievals do not satisfy this boundary. Try another permitted route when
   retrieval fails; if no inspectable source can be obtained, disclose the gap
   and stop rather than claim grounded design.

   Research is grounded only when what was encountered bears on a material
   decision in the new whole. Independence means re-solving the brief, not
   silently discarding an applicable behavior, interaction economy, or
   representation; depart for a reason in the new product, not because another
   answer is easier to source or serialize. Do not copy the source or place its
   pixels on the canvas. For other work, read style-grounding only when the user
   asks for research or a consequential decision remains open.

3. **Synthesize one direction.** Integrate the brief, evidence, and professional
   judgment into a product-specific relationship among content, state, and
   action. Let structure, hierarchy, interaction, visual language, and media
   arise together from that relationship. Keep only enough private rationale to
   remain coherent; do not produce a fixed design report, axis inventory, or
   style checklist.

   Choose text, icons, images, illustration, data visualization, diagrams, and
   native controls by what people need to recognize, compare, manipulate, or
   feel—not by quota or serialization convenience. Treat a character or
   primitive doing an icon's job as an icon role. Before representing any
   chosen icon or other visual asset—or using an exact typeface—read
   [visual-assets.md](references/visual-assets.md).

   Model visible roles, grouping, layout, type, color, media, states, and
   editable relationships in Figma terms. Separate ordinary Canvas HTML from
   exact resources, components, variables, masks, media paints, guides, and
   native node types. Choose one resource path:

   - **Reuse:** only when the user, selected source, or applicable project
     evidence establishes a relevant existing system. A catalog name, source
     page, domain match, or mere presence in the file is insufficient. Read
     [design-system-reuse.md](references/design-system-reuse.md).
   - **Direct:** the default for the first complete net-new design. Use
     primitives, literals, and permitted assets; do not call
     `get_design_system`, use catalog refs, or author resources merely because
     values or shapes repeat.
   - **Author:** only when the user requested reusable resources, project
     evidence makes them part of the deliverable, or the user accepts a separate
     pass. Read
     [design-system-authoring.md](references/design-system-authoring.md) and
     select only responsibilities whose real consumers justify the contract.

   Treat an explicitly editable diagram as native semantics with independently
   editable nodes and connectors, not styled FRAME lookalikes.

4. **Build a representative composition.** Read only the mechanical references
   selected by the design. For Canvas HTML create or structural update, read
   [canvas-html.md](references/canvas-html.md) through EOF and run its preflight
   immediately before the call. Page-only and native-only operations omit
   markup. On update, trace the requested change through every visible
   representation that depends on it, then preserve every unrelated field and
   keyed element; preservation never protects stale evidence of the prior state.
   Use a supported equivalent only when it preserves intent; otherwise report
   the capability gap.

   Apply the smallest materially complete real screen that establishes the
   product relationship, visual language, density, layout, and representation.
   Open its PNG before expanding the flow or extracting resources. A skeleton,
   mood board, generated concept, resource area, mutation summary, or unchanged
   duplicate does not count.

   Experience the rendered whole before diagnosing parts. Correct the
   composition while it is local. Keep possible components and tokens Direct
   until the result is visibly usable and shaped by its context. After that
   check, read [variables.md](references/variables.md) only when shared semantic
   roles should evolve together. On Author, read
   [component-authoring.md](references/component-authoring.md), prove one native
   usage, and reconcile real consumers before propagation.

5. **Complete, experience, and repair.** Call `apply_canvas` once per coherent
   root and split large work only at meaningful screen or section boundaries.
   Reconcile every selected representation and asset with its role and source
   before sending it. Carry the representative composition's relevant product
   relationship, hierarchy, media logic, interaction vocabulary, rhythm, and
   visual language into dependent screens without forcing identical layouts.

   Open the final PNG and every materially distinct screen. Without opened
   pixels, do not claim visual verification. First judge whether the whole is
   useful, coherent, product-specific, and faithful to the intended experience;
   then focus on any particular hierarchy, attention, density, spacing, edge,
   clipping, crowding, content, state, or asset issue needed to explain and
   repair a mismatch. Use `get_structure` only where placement, identity,
   editability, or native semantics matter.

   Inspect the complete result of every `apply_canvas` call. Correct failures;
   repair each warning or state why its geometry is intentional. Repair only the
   affected composition while preserving unaffected content and relationships.
   A failed local repair is evidence to fix that payload, not to discard a
   working root. Validation repair may change transport syntax or geometry, not
   discard the decided content, hierarchy, representation, or interaction.
   Replace a root only when an observed structural defect requires it and the
   complete intent can be preserved. Finish only when each observed defect is
   corrected, accepted with reason, or disclosed.

   Deliver a verified Direct result when Author was not selected. If a plausible
   reusable responsibility remains, ask a genuine optional question about a
   separate component pass; do not imply that the design is incomplete.

## Load references by decision

Read each routed reference through EOF when its decision or capability is
selected. References provide mechanics or decision support, not design ideas.

| Selected decision or capability                                          | Reference                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Net-new visual composition                                               | [visual-composition.md](references/visual-composition.md)           |
| Product research or unresolved material design decision                  | [style-grounding.md](references/style-grounding.md)                 |
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

## Mutation contract

Create describes one complete root or one exact new page. Update changes an
exact `targetNodeId` or page; supplied fields state desired values and omissions
preserve live state. With no structural change, target the managed root and send
only `native` for existing stable keys. `removeKeys` removes owned descendants;
top-level `mode: "remove"` removes an exact managed root or page. `mode:
"activate"` always identifies the page by `page.id` or `page.pageKey`, including
when only changing its optional selection, and makes no document mutation. Keep
`data-key` and `pageKey` stable and recover them from structured tool results,
not names.

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
