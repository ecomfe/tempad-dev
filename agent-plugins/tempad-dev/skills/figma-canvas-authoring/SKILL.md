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

Turn product intent into one native, editable Figma result. Decide what to
design; let TemPad Dev resolve resources, validate native state, diff the latest
canvas, and apply the safe patch.

Keep the requested design outcome focal. Treat file evidence, references,
catalog entries, syntax, and tool calls as subsidiary support for that outcome,
not as a checklist to maximize or a design direction in themselves.

This skill governs Figma authoring and delivery, not product-domain, platform,
accessibility, content, or visual-design requirements. Derive those requirements
from the user, permitted project evidence, or targeted research. Examples in
this skill demonstrate mechanics only; never promote them into requirements.

Require the intended Figma tab to have MCP access and the current Figma Design
file to be editable. Never bypass that boundary or send raw Plugin API
operations.

## Instruction priority

Apply this order:

1. explicit user requirements and prohibitions;
2. applicable requirements established by permitted project and file evidence
   or targeted research;
3. this skill's Figma authoring and safety constraints;
4. situated design judgment consistent with that evidence.

Never let a default workflow override the user. Safety, edit permission, exact
scope, and declarative-only writes remain hard boundaries.

## Establish only the necessary context

Before writing, determine:

- the requested outcome and smallest complete scope;
- whether this is a create or an update, and the exact update target;
- the relevant evidence and any material design decisions it leaves unresolved;
- whether to reuse existing resources, compose directly, or explicitly author
  a requested design-system resource;
- which native capabilities the result actually needs.

Infer low-consequence gaps from evidence. Ask only when a missing choice would
materially change the deliverable. Do not collect broad context merely because
it is available.

## Quality floor

- Ground each material design decision in an explicit requirement, applicable
  evidence, targeted research, or a clearly identified low-consequence
  assumption. Neither tool availability nor a skill example is design evidence.
- Deliver one coherent result whose content, states, assets, and reusable
  resources agree with the established brief and with one another.
- Preserve the identity and fidelity of supplied or selected sources. Do not
  silently replace a required asset, representation, or behavior with something
  easier for the current toolchain.
- Make the Figma result complete, editable, intentionally structured, and free
  of observed unintended visual or structural defects. Disclose any accepted
  limitation instead of redefining it as intent.

The brief and its evidence determine the task-specific quality criteria. This
skill requires that they be established and verified; it does not predefine
their design answers.

## Delegation boundary

When subagents are available for materially independent research, asset work,
read-only inventory, or visual QA, read
[delegation.md](references/delegation.md) after fixing the task scope and brief.
Delegate only when its gate passes; the main agent integrates, decides, and
remains the only Canvas writer.

## Workflow

1. **Fix the scope.** Choose one create or update target. Use `get_code` only
   when existing visual composition matters. Use `get_structure` only when
   hierarchy, ordering, an intentional spatial relationship, or managed
   `data-key` identity is unclear—not merely to find an empty create position.
   Use the active Figma page as the default create destination. Omit top-level
   `page` unless the user explicitly requests another existing or new page, or
   available task evidence clearly requires one. If page context is missing or
   ambiguous, do not ask, infer, create, rename, reorder, or target another
   page; write to the current page.
2. **Ground unresolved design decisions.** Follow the user first, then permitted
   file or project evidence and a clearly applicable installed skill. For
   net-new work without a concrete reference or representative established
   screen or system, treat the overall visual language as a material unresolved
   decision; broad adjectives and permission to be creative do not settle it.
   A domain skill may establish relevant constraints, but generic prose does not
   settle a direction-defining visual language without an exact visual
   specification or an inspected visual artifact.
   For net-new or materially redesigned work with other unresolved material
   decisions, read [style-grounding.md](references/style-grounding.md). Skip it
   when exact reproduction, a mechanical edit, or established evidence already
   determines the result. Retain the reference's compact decision trace before
   writing, then complete and inspect one representative composition before
   propagation. A research scout may gather evidence only after the question is
   fixed and the delegation gate passes; the main agent decides. Treat a
   pictographic control or content-bearing or salient image as a visual-asset
   decision before choosing its representation. Read
   [Visual assets](references/visual-assets.md) before using text, primitives,
   SVG, remote media, or generation for that role.
3. **Choose one resource path.**
   After explicit user direction, use this default: silence is not an opt-out,
   but catalog availability is not relevance. For an update, preserve existing
   resource usage and consult the catalog only when choosing or replacing a
   resource. For new work, choose Reuse only when permitted file or project
   evidence establishes an applicable system whose consistency matters;
   otherwise choose Direct. Ask only when a material resource boundary cannot
   be inferred.
   - **Reuse:** when existing design-system consistency is allowed and relevant,
     read [design-system-reuse.md](references/design-system-reuse.md).
   - **Direct:** use primitives, literal values, and allowed external assets.
     Do not call `get_design_system`, send `catalogId`, or use catalog refs.
   - **Author:** only when the user explicitly requests a local reusable
     component, variable, style, or design-system extension. Read
     [design-system-authoring.md](references/design-system-authoring.md).
     Identify reusable responsibilities from concrete consumers, meaningful
     state or content differences, expected shared evolution, and abstraction
     cost before selecting resources. For systems spanning several usages,
     prefer working from known foundations and a representative composition
     toward justified abstractions; an already established, high-confidence
     pattern may be authored first and proven immediately. Once a component
     responsibility is selected, use instances for its final usages. Bind
     variables/styles only to consumers that perform their named semantic role.
     "Create your own design system" does not by itself require a visible
     specimen board; a definition, swatch, mismatched binding, or equal literal
     is not usage. An exact returned component ID needs no catalog. An empty file
     or repeated UI does not imply this request.
4. **Load exact syntax just in time.** Do not batch-load every reference that
   might become relevant. Read a capability reference only after selecting that
   capability, immediately before its first use. A requested design system does
   not by itself select variables, styles, and components as a bundle; load only
   the resource types justified by concrete consumers. Skip Canvas HTML for
   `markup: null`. When
   trustworthy target markup is already available and the update preserves its
   element structure, always read
   [Elements and identity](references/canvas-html.md#elements-and-identity), then
   read [Layout](references/canvas-html.md#layout) only for sizing or layout class
   changes and
   [Appearance and text](references/canvas-html.md#appearance-and-text) only for
   appearance or text class changes. Text characters, a known catalog prop, a
   known variable or style link, and native state on known nodes need no other
   Canvas HTML section. Preserve every unaffected element, attribute, and class;
   leave markup unchanged for a native-only update. For a create or an update
   that changes element structure, read [canvas-html.md](references/canvas-html.md)
   in full. Then load only the capability references selected below. Copy
   complete examples for private native shapes; never infer them from the Figma
   Plugin API or from validation failures.
5. **Apply one desired result.** Call `apply_canvas` once per coherent root. If
   a genuinely large result must be split, divide it at meaningful screen or
   section boundaries, never into node-level operations. When those screens
   must remain one movable board, create one fixed-size Auto Layout parent and
   append one bounded screen or section per update to that same root; keep its
   key stable and omit already-added children so they are preserved. Use
   independent roots when their relative organization is not part of the
   deliverable. Never inspect the canvas for free space, carry coordinates
   across calls, or use root translation to place a create result. TemPad Dev
   calculates every new root's position from its rendered size and the
   destination page's existing top-level bounds.
6. **Close authored-system scope.** On the Author path, follow the closure
   procedure in [design-system-authoring.md](references/design-system-authoring.md)
   after concrete consumers exist. Resolve authoring warnings, verify native
   component usage and semantic variable/style coverage, inspect materially
   distinct states, and briefly disclose any justified remaining divergence.
7. **Verify the delivered result.** Read structural verification. For a new
   composition or material visual change, open the representative-screen
   `get_screenshot` result before propagation, then inspect the final board and
   materially distinct screens. When the screenshot asset includes
   `localPath`, open that file directly with the host's image-viewing
   capability; otherwise download and open the returned `resource_link`.
   Receiving or copying either reference is not visual inspection. If the PNG cannot be opened,
   stop before propagation or a visual-verification claim. When page-level
   placement is part of the deliverable, a root was resized after placement, or
   the final report claims that multiple top-level roots do not overlap, compare
   their page-space bounds with `get_structure`; isolated screenshots cannot
   prove that relationship. Skip screenshots for mechanical text, token, prop,
   or hierarchy edits. Compare the rendered result with the user requirements,
   established evidence, and retained brief. Inspect for unintended overlap,
   clipping (including glyph ink cut by its text box or a clipping ancestor),
   collapsed content, obscured or unreadable text, inconsistent states, missing
   or substituted assets, incorrect native bindings, and other visible or
   structural defects. Do not infer a task-specific design rule from this defect
   inventory. Diagnose with `get_structure` or `get_code`. A repair
   is valid only when it also preserves unaffected established content, state,
   assets, and relationships; hiding a defect by weakening one of those creates
   a new defect. Correct and re-screenshot only affected compositions. Stop when
   the evidence passes.
   Never claim verification before correcting, accepting with reason, or
   disclosing every observed defect. A fresh QA scout may review when the
   delegation gate passes; the main agent retains final judgment.

Do not turn this workflow into repeated API-like mutations.

## Reference routing

Load a reference only when its capability is part of the requested result:

- page, section, group, Boolean, masks, transforms, shapes, or vectors:
  [document-geometry.md](references/document-geometry.md)
- native paints, media, effects, shaders, grids, or guides:
  [paints-effects.md](references/paints-effects.md)
- exact whole-node fonts, rich text, range styles, lists, or hyperlinks:
  [rich-text.md](references/rich-text.md)
- icon or SVG asset import:
  [Icons](references/visual-assets.md#icons)
- exact native font delivery:
  [Typefaces](references/visual-assets.md#typefaces)
- image or illustration asset delivery:
  [Images and illustrations](references/visual-assets.md#images-and-illustrations)
- authored components, variant sets, properties, or Slots:
  [component-authoring.md](references/component-authoring.md)
- local variables, collections, modes, or bindings:
  [variables.md](references/variables.md)
- local Paint, Text, Effect, or Grid styles and bindings:
  [styles.md](references/styles.md)
- isolated research, asset, inventory, or visual-QA delegation:
  [delegation.md](references/delegation.md)

## Create and update

Create mode describes one complete new root. Update mode is an incremental
declarative patch:

- `targetNodeId` is the only mutable subtree;
- supplied nodes and fields state desired values;
- omitted live children and fields are preserved;
- `removeKeys` explicitly makes owned descendants absent;
- `markup: null` is the isolated assertion that the managed update root itself
  must be absent.

Never infer deletion from omission. Keep `data-key` stable across updates;
names are presentation only. After context loss, recover managed identities
from `get_structure.authoringKey` instead of inventing replacements.

## Safety

- Never write outside the target scope or use names as identity.
- Treat an instance as an authoring boundary: update its root or its component
  definition, never target or remove a definition-derived sublayer.
- Never remove unkeyed or manual content, externally referenced nodes,
  unmanaged resources, or a component that still has instances.
- Never mutate remote resources, publish, detach or reset instances, or execute
  arbitrary JavaScript.
- Use explicit `null` only for supported links or managed resources that the
  requested result truly removes.
- Treat validation failure as evidence to fix the result, not permission to
  imitate an unresolved design-system resource.
