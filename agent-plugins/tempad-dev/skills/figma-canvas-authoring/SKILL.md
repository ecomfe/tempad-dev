---
name: figma-canvas-authoring
description: >-
  Create or update native Figma designs with TemPad Dev MCP using components
  and variables from the active file's design system. Use when the user asks
  an agent to design, compose, draft, or refine screens or components directly
  on the Figma canvas, including an empty canvas or document. Do not use for
  Figma-to-code implementation, critique without canvas edits, raw Plugin API
  automation, or unapproved design-system invention.
---

# TemPad Dev: Figma Canvas Authoring

Turn product intent into native, editable Figma content. Make design decisions
from user intent and available evidence; let TemPad Dev perform deterministic
canvas reconciliation.

TemPad Dev MCP must be connected to the intended Figma file. Canvas writes must
be enabled before calling `tempad-dev:apply_canvas`. If either is unavailable,
stop and tell the user how to reconnect or enable it; never work around the
write boundary.

## Sources of truth

Use each source for a different job:

- **User input** defines the product goal, content, scope, and acceptable
  creative freedom.
- **Figma design-system evidence** from `tempad-dev:get_design_system` defines
  reusable component and variable identities.
- **Existing canvas evidence** from `tempad-dev:get_code` and
  `tempad-dev:get_structure` defines visible composition and the exact update
  scope when editing existing work.
- **Project evidence**, when a repository is available, supplies higher-level
  design principles, product patterns, terminology, and constraints.

Never invent a Figma component or variable `id` or `key`. A familiar name is
not proof that two design-system resources are equivalent.

## Workflow

### 1. Establish the task and scope

Determine whether the user wants to create new content or update an existing
subtree.

- For an update, resolve one explicit target node. Use a user-provided
  `nodeId`, or call `tempad-dev:get_structure` on the current selection when
  the exact root identity is needed.
- Inspect existing content with `tempad-dev:get_code` only when its visual
  composition matters to the requested design.
- Do not add speculative screens, states, interactions, or content outside the
  requested scope.
- Ask only when missing product intent would materially change the design.

### 2. Read the available design system

Call `tempad-dev:get_design_system` with one concrete task query such as
`settings form`, `checkout summary`, or `数据表格`.

Treat returned components, component properties, variables, scopes, IDs, and
keys as design facts. Prefer:

1. an existing component instance for a product control or repeated pattern
2. an exposed component property for its supported variation
3. a semantic variable for a supported visual or layout field
4. a primitive or literal only when the design system has a real gap

The result is intentionally scoped and ranked; it is not proof that every
subscribed Figma library was searched.

If a query returns no matches but does not report that components and variables
are absent, retry once without a query to distinguish a query miss from missing
design-system evidence. Do not repeatedly broaden searches.

### 3. Handle an empty document

An empty canvas is not automatically a blocker. Base the decision on available
design-system evidence:

- **Components or variables are returned:** create the requested design
  normally with `apply_canvas` in `create` mode.
- **No resources are discoverable, but the user or trusted project
  documentation provides real component or variable keys:** use those
  references and let Figma validate or import them.
- **No resources or trusted references exist:** do not pretend the result
  follows a Figma design system. Ask the user to choose one of these paths:
  - open or seed a page containing representative design-system instances and
    bound variables
  - provide a reference file or real library component/variable keys
  - explicitly authorize a primitive draft that can be migrated later

When a primitive draft is explicitly authorized:

- label it as a draft rather than design-system-compliant work
- use only user-provided or neutral values
- keep the structure small and easy to replace
- do not invent brand tokens, logos, icons, or component identities

The important distinction is not “empty document” versus “non-empty document”;
it is “grounded design-system evidence” versus “no such evidence.”

### 4. Compose one desired result

Describe the result as a `CanvasNodeSpec` tree, not as a sequence of Figma API
operations.

- Use stable, semantic, unique `key` values and reuse them in later updates.
- Prefer `INSTANCE` nodes over redrawing available components.
- Bind returned variables wherever their semantics and scopes match.
- When a literal and variable binding target the same field, expect the
  variable binding to win. Keep a valid solid fallback paint for bound fill or
  stroke fields.
- Use component properties instead of detaching or rebuilding an instance.
- Keep hierarchy native and editable. Use `FRAME` for containers and auto
  layout where the design calls for it.
- Stay within the current authoring surface. Do not approximate unsupported
  images, logos, icons, gradients, effects, or arbitrary vector artwork with
  unrelated primitives.

Favor the smallest coherent design that satisfies the request. Consistency with
the available design system matters more than novelty.

### 5. Apply once

Send one `tempad-dev:apply_canvas` call:

- Use `create` for a new tree. Its root must be a `FRAME`.
- Use `update` with one explicit `targetNodeId` for an existing subtree.
- Supply the desired result, not individual mutation steps.
- Remember that omitted fields and existing omitted children are preserved.
  Deletion is not supported.

Do not split a design into repeated tool calls merely to mimic Plugin API
operations. Split only when the tool's documented size or depth limits require
independent, meaningful subtrees.

### 6. Verify and refine

Read `rootNodeId`, `nodeIdsByKey`, `mutationCount`, and any warnings from the
result.

- Retain `nodeIdsByKey` and reuse the returned identities for later refinement.
- Use `tempad-dev:get_structure` only to verify hierarchy, ordering, or
  geometry.
- Use `tempad-dev:get_code` when exact rendered style evidence is needed.
- Make at most one evidence-based refinement pass unless the user asks for
  further iteration.

If a component, variable, font, or component property cannot be resolved, fix
the reference or ask the user. Do not silently replace it with an imitation.

## Safety boundaries

- Never bypass the session-only Canvas writes toggle.
- Never update outside the explicit target subtree.
- Never use names as identity when an ID or stable key is required.
- Never delete, detach, publish, or create design-system resources.
- Never send arbitrary JavaScript or emulate raw Figma Plugin API calls.
- Rely on `apply_canvas` validation and rollback, but still keep each requested
  change narrowly scoped.
