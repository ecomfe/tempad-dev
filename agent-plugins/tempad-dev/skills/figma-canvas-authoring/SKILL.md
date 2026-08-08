---
name: figma-canvas-authoring
description: >-
  Create or update native Figma designs with TemPad Dev MCP, following the
  user's explicit resource constraints. Reuse accessible components, variables,
  and styles only when allowed; create or extend a local design system only
  when the user explicitly requests it. Use for screens, drafts, and reusable
  components on the Figma canvas, including an empty document. Do not use for
  Figma-to-code, critique without edits, raw Plugin API automation, or
  unapproved design-system invention.
---

# Design on the Figma canvas

Turn product intent into one native, editable Figma result. Keep that result
focal; treat evidence, references, catalog entries, syntax, and tool calls as
subsidiary support rather than design direction or a checklist to maximize.

Use this skill for Figma authoring and delivery. Derive product-domain,
platform, accessibility, content, and visual-design requirements from the user,
permitted evidence, an applicable skill, or targeted research. Examples explain
mechanics only.

Require the intended Figma tab to have MCP access and the current Figma Design
file to be editable. Never bypass that boundary or emit raw Plugin API
operations.

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
   complete scope, create or update target, relevant evidence, unresolved
   material decisions, resource path, and required native capabilities. Use
   `get_code` only when existing visual composition matters. Use
   `get_structure` only for hierarchy, ordering, spatial relationships, or
   managed identity uncertainty. Create on the active page by default. Omit
   top-level `page` unless the user or established task evidence requires a
   specific page operation; never ask for or invent a page merely to place new
   work.
2. **Resolve material design decisions.** Follow the user, permitted file and
   project evidence, and applicable installed skills. For net-new or materially
   redesigned work, read
   [style-grounding.md](references/style-grounding.md) only when a material
   decision remains unresolved; broad adjectives and creative latitude do not
   settle a direction-defining visual language. Treat a pictographic control or
   content-bearing or salient image as an asset decision before choosing its
   representation, and read [visual-assets.md](references/visual-assets.md).
   Retain the compact decision trace and inspect one representative composition
   before propagating its language.
3. **Choose one resource path.** Preserve established resource usage on updates.
   For new work, choose Reuse only when permitted evidence establishes a
   relevant existing system; otherwise choose Direct. Ask only when a material
   boundary cannot be inferred.
   - **Reuse:** read
     [design-system-reuse.md](references/design-system-reuse.md), then use only
     returned resources relevant to the result.
   - **Direct:** use primitives, literal values, and allowed external assets.
     Do not call `get_design_system`, send `catalogId`, or use catalog refs.
   - **Author:** enter only when the user explicitly requests a reusable local
     resource or design-system extension. Read
     [design-system-authoring.md](references/design-system-authoring.md) and
     select resources from concrete consumers, meaningful differences, expected
     shared evolution, and abstraction cost. Repetition alone is not a trigger.
4. **Select native representation, then load syntax.** Decide which Figma
   capabilities express the result before reading their payload syntax. Load
   only the selected capability references in the routing section below. Skip
   Canvas HTML for `markup: null`. For a create or an update that changes element
   structure, read [canvas-html.md](references/canvas-html.md) in full. For an
   update with trustworthy markup and unchanged structure, always read
   [Elements and identity](references/canvas-html.md#elements-and-identity), then
   read only the changed Layout or Appearance and text section. Preserve every
   unaffected element, attribute, and class; leave markup unchanged for a
   native-only update. Copy complete private-native examples instead of guessing
   shapes from Plugin API knowledge or validation failures.
5. **Apply one desired result.** Call `apply_canvas` once per coherent root. If a
   large result must be split, use meaningful screen or section boundaries. To
   keep several calls in one movable board, create one fixed Auto Layout parent
   and append bounded sections to that same stable root; omit existing children
   so updates preserve them. Use independent roots when their relative
   organization is not part of the deliverable. Never scan for free space,
   maintain a coordinate ledger, or translate a create root for placement;
   TemPad Dev positions new roots from their rendered bounds.
6. **Close authored-system scope.** On the Author path, follow the closure in
   [design-system-authoring.md](references/design-system-authoring.md) after
   concrete consumers exist. Use authored components through native instances,
   bind variables and styles to consumers performing their semantic role,
   resolve authoring warnings, and inspect materially distinct states. Remove
   speculative resources rather than manufacturing specimens to justify them.
7. **Verify the delivered result.** Read structural verification. For a new
   composition or material visual change, open the representative screenshot
   before propagation, then inspect the final board and materially distinct
   screens. Open `asset.localPath` directly when present; otherwise download and
   open the returned resource. If the PNG cannot be opened, do not claim visual
   verification. Use `get_structure` to compare page-space bounds when relative
   placement matters, a root was resized after placement, or the handoff claims
   that multiple roots do not overlap. Compare rendered evidence with the brief;
   check unintended overlap, clipping including glyph ink, collapsed or obscured
   content, inconsistent states, asset substitutions, and incorrect native
   bindings. Preserve unaffected content, state, assets, and relationships while
   repairing; concealing one defect by weakening them creates another. Correct
   and recheck only affected compositions. Do not claim verification until every
   observed defect is corrected, accepted with reason, or disclosed. Skip
   screenshots for mechanical text, token, prop, or hierarchy-only edits, and
   never turn this defect inventory into task-specific design requirements.

Do not turn this workflow into repeated API-like mutations.

## Reference routing

Load each reference only after its branch or capability is selected.

Decision and evidence:

- unresolved material design decisions:
  [style-grounding.md](references/style-grounding.md)
- icons, exact fonts, images, or illustrations:
  [visual-assets.md](references/visual-assets.md)
- existing-system reuse:
  [design-system-reuse.md](references/design-system-reuse.md)
- explicitly requested local system authoring:
  [design-system-authoring.md](references/design-system-authoring.md)
- bounded research, asset, inventory, or visual-QA delegation:
  [delegation.md](references/delegation.md)

Native representation:

- pages, sections, groups, Booleans, masks, transforms, shapes, or vectors:
  [document-geometry.md](references/document-geometry.md)
- paints, media, effects, shaders, grids, or guides:
  [paints-effects.md](references/paints-effects.md)
- exact fonts, rich text, range styles, lists, or hyperlinks:
  [rich-text.md](references/rich-text.md)
- authored components, variant sets, properties, or Slots:
  [component-authoring.md](references/component-authoring.md)
- local variables, collections, modes, or bindings:
  [variables.md](references/variables.md)
- local Paint, Text, Effect, or Grid styles and bindings:
  [styles.md](references/styles.md)

Serialization:

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
