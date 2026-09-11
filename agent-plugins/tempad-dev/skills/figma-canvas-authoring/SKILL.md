---
name: figma-canvas-authoring
description: >-
  Create or update native, editable Figma designs with TemPad Dev MCP: screens,
  flows, components, and requested local design-system resources, including on
  an empty canvas. Use for Design in Figma work, not Figma-to-code, critique
  without edits, or raw Plugin API automation.
---

# Design in Figma

Deliver the smallest complete native Figma result that serves the user's
situation. Keep the working experience in view as you research, compose, and
repair. A successful tool call establishes a document change; the rendered
result and its editable structure establish whether that change served the task.

## Establish the task

Use the user's exact target and constraints. For an existing design, inspect
`get_code` and its pixels before changing the composition; use `get_structure`
for hierarchy, geometry, stable keys, or selected native facts. Write to a known
page directly. Create or activate a page only when the task calls for it.
Infer low-consequence gaps; ask when a missing decision would materially change
the result. Keep unrelated account, filesystem, task, and page metadata out of
product identity and content.

Require an editable Figma Design file and the intended tab's active MCP
connection. Use the host's TemPad MCP tools for all canvas reads and writes.
If unavailable, report the integration problem and stop. Do not launch the CLI,
recreate its transport, use browser automation to set up the canvas, or emit raw
Plugin API operations. Research and asset acquisition use the host's appropriate
tools; website research uses the in-app browser when available unless the user
selected another browser.

## Ground and compose

For net-new or materially redesigned interfaces without an established system,
read [style-grounding.md](references/style-grounding.md) and inspect relevant
real product screens or a permitted implementation before the first Canvas
write. The evidence must expose the interface relationships informing the new
work. Search snippets, URLs, failed retrievals, and generated concepts do not
establish a precedent. Subject imagery establishes its depicted content, not
its surrounding application's design. Try another permitted source when
retrieval fails; if none is inspectable, disclose the gap and stop. Supplied
source pixels or implementation can satisfy this boundary; mechanical edits do
not require unrelated research.

Resolve what the person needs to recognize or change, which content and states
carry that work, and how the interface makes their consequences perceptible.
Choose the screen or flow, visual language, density, and scrolling model from
that situation. Use [visual-composition.md](references/visual-composition.md)
when forming or reconsidering a composition. Familiar structures and distinctive
ones both need a reason in the task. Research informs an independent solution;
it does not authorize copying a composition or placing reference pixels on the
canvas unless the user requested that treatment.

When selecting or changing fonts, or when script coverage is uncertain, read
[typefaces.md](references/typefaces.md) to resolve candidates and native identities.

Choose representations by their role in the work. Once an image, icon, diagram,
or visualization matters to the direction, read
[visual-assets.md](references/visual-assets.md) and its selected branch. Do not
silently replace the chosen content or medium to simplify sourcing or markup.
For content-bearing graphics, preserve meaningful marks and editable
relationships with native shapes, vectors, text, and groups; styled FRAME
lookalikes do not acquire drawing semantics. Read
[document-geometry.md](references/document-geometry.md) for that construction.
Ordinary UI panels, controls, backgrounds, and separators remain Canvas HTML.

Choose resources from the task, not repetition alone:

- **Direct:** default for a first net-new composition. Use primitives, literals,
  and assets. Do not discover or create a design system just because shapes or
  values repeat.
- **Reuse:** use [design-system-reuse.md](references/design-system-reuse.md) when
  the user, selected source, or project evidence establishes the applicable
  system. Catalog names, domain similarity, or mere file presence do not prove
  relevance.
- **Author:** use [design-system-authoring.md](references/design-system-authoring.md)
  when reusable resources are requested or established as part of the
  deliverable. Prove the composition and one real consumer before propagation.

For selected variables and typography styles, read
[resource-mapping.md](references/resource-mapping.md): define or discover their
identities once, then use variable utilities and text-style classes throughout
the markup.

## Build, inspect, and repair

For markup create or structural update, read
[canvas-html.md](references/canvas-html.md) and check its preflight before the
call. Canvas HTML is a strict native-state dialect; browser CSS assumptions do
not apply. Page-only and native-only operations omit markup. Load native
mechanics only for the capabilities selected below.

Build a materially complete representative screen, then open its PNG before
expanding the flow or extracting resources. Judge whether the whole supports
the intended work. When it does not, focus on the particular relationship or
execution defect that explains the mismatch and repair it. A skeleton, resource
board, or generated concept does not establish the real composition.

For updates, read [editing.md](references/editing.md). Preserve the requested
source, unrelated fields, and stable identities while updating every dependent
representation of the changed state. For larger results, split at meaningful
screen or section boundaries and carry shared roles coherently across them.

Inspect every `apply_canvas` result, including warnings. Repair each observed
unintended defect or disclose why it remains. A local validation failure calls
for a local payload correction; it does not justify discarding a working root
or simplifying away the intended content. Open pixels again after the final
material write, covering every materially distinct screen. Verify native facts
with `get_structure` when identity, placement, editability, or representation
matters. Opened pixels prove visual access, not good judgment; a structural pass
proves only the conditions checked.

Finish when the requested experience is coherent and observed defects are
repaired, accepted with reason, or disclosed. Report the delivered result and
material limitations. A verified Direct result is complete without an
unsolicited component pass.

## Native mechanics — load when selected

Read the selected reference completely; do not preload the capability catalog.
Examples demonstrate syntax, not a design template.

| Capability                                                            | Reference                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Exact updates, removal, or editor context                             | [editing.md](references/editing.md)                         |
| Pages, sections, groups, Booleans, masks, transforms, shapes, vectors | [document-geometry.md](references/document-geometry.md)     |
| Paints, media, effects, shaders, grids, guides                        | [paints-effects.md](references/paints-effects.md)           |
| Exact fonts, rich text, range styles, lists, hyperlinks               | [rich-text.md](references/rich-text.md)                     |
| Components, variants, properties, Slots                               | [component-authoring.md](references/component-authoring.md) |
| Variables, collections, modes, bindings                               | [variables.md](references/variables.md)                     |
| CSS variable utilities and named text-style classes                   | [resource-mapping.md](references/resource-mapping.md)       |
| Paint, Text, Effect, Grid styles                                      | [local-styles.md](references/local-styles.md)               |
| Authorized independent research, assets, inventory, or QA delegation  | [delegation.md](references/delegation.md)                   |

## Mutation boundaries

Use returned IDs and stable keys as identity, never names. Create describes a
new complete root or exact new page. Update targets an exact node or page;
omissions preserve live state. `activate` always requires `page.id` or
`page.pageKey`, even when only changing selection.

Never mutate outside scope, remove manual or unkeyed content, or remove a
component with surviving instances. An instance's definition-derived sublayers
are not authoring targets. Do not mutate remote resources, publish, detach or
reset instances, execute arbitrary JavaScript, or imitate an unresolved
resource. Use `null` only for supported links or managed resources the requested
change actually removes.
