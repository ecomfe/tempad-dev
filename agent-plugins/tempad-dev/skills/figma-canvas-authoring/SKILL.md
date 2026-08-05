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

Require the intended Figma tab to have MCP access and the current Figma Design
file to be editable. Never bypass that boundary or send raw Plugin API
operations.

## Instruction priority

Apply this order:

1. explicit user requirements and prohibitions;
2. permitted project and file evidence;
3. this skill's defaults;
4. general design heuristics.

Never let a default workflow override the user. Safety, edit permission, exact
scope, and declarative-only writes remain hard boundaries.

## Establish only the necessary context

Before writing, determine:

- the task, content hierarchy, primary action, and smallest complete scope;
- whether this is a create or an update, and the exact update target;
- the visual direction and the evidence permitted to ground it;
- whether to reuse existing resources, compose directly, or explicitly author
  a requested design-system resource;
- which native capabilities the result actually needs.

Infer low-consequence gaps from evidence. Ask only when a missing choice would
materially change the deliverable. Do not collect broad context merely because
it is available.

## Quality floor

- Make the primary task and action obvious before adding secondary content.
- Reuse local terminology, interaction patterns, density, and visual rhythm
  when evidence exists.
- Establish hierarchy through layout, alignment, spacing, and type before
  borders, shadows, or decorative containers.
- Use a small, consistent set of type, spacing, and color roles. Avoid generic
  card grids and unsupported visual conventions.
- Keep repeated elements and states consistent, and use concise realistic copy.
- Use real component or library icons. Choose existing, licensed, generated, or
  intentionally geometric imagery by its role, distinctiveness, rights, and
  importability; no source is a default. Never imitate either with text glyphs
  or primitive mosaics.
- Treat familiar visual sources as candidates, not defaults; familiarity does
  not settle a material product, platform, or expressive decision.
- Choose the smallest coherent scope that preserves realistic density,
  product-specific detail, and one signature visual idea. Do not simplify into
  unexplained dead zones.

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
2. **Ground the visual direction.** Follow the user first, then permitted file
   or project evidence and a clearly applicable installed skill. Before any
   net-new or materially redesigned product UI without a concrete reference or
   representative existing screen/system, read
   [style-grounding.md](references/style-grounding.md); category and broad
   adjectives are not visual evidence. Skip only exact reproduction and
   mechanical edits. Frame the problem and retain the reference's compact brief
   before research. Complete and screenshot the representative screen before
   propagating its language. A research scout may gather evidence only after
   the brief is fixed and the delegation gate passes; the main agent chooses
   the direction. When imagery carries identity, expression, or primary
   hierarchy, choose an importable source route before layout, then read
   [Images and illustrations](references/visual-assets.md#images-and-illustrations).
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
     Component order is flexible, but the final composition must use authored
     components as native instances; an exact returned ID needs no catalog. An
     empty file or repeated UI does not imply this request.
4. **Load only exact syntax needed.** Skip Canvas HTML for `markup: null`. When
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
6. **Close the feedback loop.** Read structural verification. For a new
   composition or material visual change, open the representative-screen
   `get_screenshot` result before propagation, then inspect the final board and
   materially distinct screens. Open a returned local `resource_link` before
   claiming visual verification. Include every delivered top-level root—screens
   and authored definitions—because isolated screenshots hide page-level
   overlap. Skip screenshots for mechanical text, token, prop, or hierarchy
   edits. Check clipping, overlap, collapsed text, fills, hierarchy, spacing,
   density, asset fidelity, and dead space. Diagnose with `get_structure` or
   `get_code`; correct and re-screenshot only affected compositions. Stop when
   the evidence passes. A fresh QA scout may review when the delegation gate
   passes; the main agent verifies its observations and retains final judgment.

Do not turn this workflow into repeated API-like mutations.

## Reference routing

Load a reference only when its capability is part of the requested result:

- page, section, group, Boolean, masks, transforms, shapes, or vectors:
  [document-geometry.md](references/document-geometry.md)
- native paints, media, effects, shaders, grids, or guides:
  [paints-effects.md](references/paints-effects.md)
- exact whole-node fonts, rich text, range styles, lists, or hyperlinks:
  [rich-text.md](references/rich-text.md)
- icon source selection or exact SVG import:
  [Icons](references/visual-assets.md#icons)
- typeface choice:
  [Typefaces](references/visual-assets.md#typefaces)
- sourced or generated imagery:
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
- Never remove unkeyed or manual content, externally referenced nodes,
  unmanaged resources, or a component that still has instances.
- Never mutate remote resources, publish, detach or reset instances, or execute
  arbitrary JavaScript.
- Use explicit `null` only for supported links or managed resources that the
  requested result truly removes.
- Treat validation failure as evidence to fix the result, not permission to
  imitate an unresolved design-system resource.
