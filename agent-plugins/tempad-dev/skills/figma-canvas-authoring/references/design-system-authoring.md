# Implement a selected local design system

Read this reference only when the user or the resolved design plan requires new
local components, variables, or styles. This reference translates that plan
into native Figma resources and verifies the handoff. It does not decide the
product's component strategy, visual language, resource inventory, or token
taxonomy.

## Establish the implementation contract

Before writing, identify only what the resolved plan establishes:

- the screens or usage cases in scope;
- each selected resource and the design responsibility it represents;
- its concrete consumers and meaningful content, state, or substitution
  differences;
- anything the user or governing evidence excludes.

If a material resource boundary is still undecided, return to the core
workflow's design-resolution step. Do not derive a component library from UI
category, visual similarity, repetition, screen count, an example in this
skill, or the currently supported tool schema.

Keep a private implementation map:

```txt
selected resource -> native representation -> intended consumers
```

This is a reconciliation aid, not canvas documentation. A selected resource is
closed only when the native definition or binding exists and every intended
consumer uses it. A visually equivalent primitive or literal is not coverage.

## Translate the selected plan

Use a concrete-to-reusable implementation loop:

1. Stabilize one representative composition before propagating dependent work.
2. Author only selected resources whose real consumers are known.
3. Exercise each contract in that representative composition.
4. Propagate native instances and bindings to every intended consumer.
5. Reconcile the final artifact with the implementation map.

Choose the Figma representation that preserves the already-decided semantics:

- A variable carries a selected semantic value that consumers need to bind and
  evolve together. Name it by role, not its current literal.
- A local style carries a selected reusable native paint, text, effect, or grid
  definition. Do not duplicate the same decision as unrelated resource types
  unless the plan requires both.
- A component carries a selected reusable responsibility. Define its stable
  anatomy and expose only content, state, or nested substitution required by
  real usages.

Canvas HTML consumes a component through a childless instance placeholder with
no layout or appearance classes. Do not select a repeated product shell or
other wrapping top-level subtree as a component unless every intended consumer
can use that placeholder through supported component properties. An authored
Slot does not allow markup children on the instance placeholder. Otherwise keep
the wrapper as ordinary structure and select a compatible inner component
boundary.

For a selected component, map each real difference to the smallest supported
mechanism: Text, Boolean, Instance Swap, a variant, a Slot, or nested
composition. Model one mutually exclusive categorical concern as one variant
axis; use Boolean properties only for independently optional concerns. Do not
encode arbitrary content as variants, generate unused combinations, or freeze a
varying field as accidental invariant content.

If the selected contract cannot express a real usage through supported native
mechanisms, do not weaken or silently redesign it. Return to the governing
design decision when an alternative boundary is valid; otherwise report the
authoring limitation.

Read [variables.md](variables.md), [local-styles.md](local-styles.md), or
[component-authoring.md](component-authoring.md) only for the resource types in
the selected plan.

## Verify the native handoff

Judge resources through representative consumers, not definitions alone.
Verify native bindings, Auto Layout, text resizing, property behavior, and each
materially distinct state. Equivalent raw literals and primitive lookalikes do
not demonstrate system usage.

For components, follow the discoverability and source-state checks in
[component-authoring.md](component-authoring.md). Main definitions must remain
visible and inspectable, and final usages must be native instances. For
variables and styles, inspect representative live bindings rather than relying
on apply input or equal values.

Resolve authoring warnings through real consumers or remove a resource only
when the resolved plan no longer includes it. Tool friction, payload size, or
the existence of one easy resource does not change the plan. Do not create a
swatch, specimen, definition panel, or redundant example solely for
verification; include documentation only when the requested handoff calls for
it.

Finish when the selected resources support the requested usage cases and the
implementation map reconciles with the live Figma structure. Do not expand the
system for imagined future needs.
