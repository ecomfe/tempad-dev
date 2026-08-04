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
- Use real component or library icons and real or generated imagery. Never
  imitate them with text glyphs or primitive mosaics.
- Design the smallest result that feels complete for the requested task.

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
   or project evidence and a clearly applicable installed skill. If material
   visual invention remains underspecified, read
   [style-grounding.md](references/style-grounding.md). Skip this branch for
   exact reproduction and mechanical edits.
3. **Choose one resource path.**
   - **Reuse:** when existing design-system consistency is allowed and relevant,
     read [design-system-reuse.md](references/design-system-reuse.md).
   - **Direct:** use primitives, literal values, and allowed external assets.
     Do not call `get_design_system`, send `catalogId`, or use catalog refs.
   - **Author:** only when the user explicitly requests a local reusable
     component, variable, style, or design-system extension. Read
     [design-system-authoring.md](references/design-system-authoring.md). An
     empty file or repeated UI does not imply this request.
4. **Load only exact syntax needed.** Always read
   [canvas-html.md](references/canvas-html.md), then only the capability
   references selected below. Copy complete examples for private native shapes;
   never infer them from the Figma Plugin API or from validation failures.
5. **Apply one desired result.** Call `apply_canvas` once per coherent root. If
   a genuinely large result must be split, divide it at meaningful screen or
   section boundaries, never into node-level operations. On create, omit root
   translation unless exact placement is part of the request; TemPad Dev places
   unspecified roots on the current page without overlap.
6. **Verify once.** Read structural verification. For a new composition or
   material visual change, normally call `get_screenshot` once on the result
   root; skip it for mechanical text, token, prop, or hierarchy-only edits.
   Make at most one evidence-based correction.

Do not turn this workflow into repeated API-like mutations.

## Reference routing

Load a reference only when its capability is part of the requested result:

- page, section, group, Boolean, masks, transforms, shapes, or vectors:
  [document-geometry.md](references/document-geometry.md)
- native paints, media, effects, shaders, grids, or guides:
  [paints-effects.md](references/paints-effects.md)
- rich text, range styles, lists, or hyperlinks:
  [rich-text.md](references/rich-text.md)
- icon sources, typeface choice, or generated imagery:
  [visual-assets.md](references/visual-assets.md)
- authored components, variant sets, properties, or Slots:
  [component-authoring.md](references/component-authoring.md)
- local variables, collections, modes, or bindings:
  [variables.md](references/variables.md)
- local Paint, Text, Effect, or Grid styles and bindings:
  [styles.md](references/styles.md)

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
