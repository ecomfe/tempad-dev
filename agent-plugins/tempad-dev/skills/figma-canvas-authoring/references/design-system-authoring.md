# Implement a selected local design system

Use this reference only when the user or resolved plan requires new local
components, variables, or styles. It translates that plan into native resources
and verifies delivery; it does not choose component strategy, visual language,
resource inventory, or token taxonomy.

## Establish the implementation contract

Before writing, identify each selected resource, responsibility, concrete
consumer, meaningful variation, and exclusion. Resolve any open material
boundary first. For components, use the gate in
[component-authoring.md](component-authoring.md); screen count, one-screen scope,
and visual similarity alone neither establish nor exclude a component.

Keep a private reconciliation map:

```txt
selected resource -> native representation -> intended consumers
```

A resource is complete only when its native definition or binding exists and
every intended consumer uses it. Equivalent primitives or literals are not
coverage.

## Translate the plan

Use this loop:

1. Stabilize one representative composition.
2. Author only selected resources with known consumers.
3. Exercise each contract in that composition.
4. Propagate native instances and bindings to all intended consumers.
5. Reconcile the final artifact with the map.

Preserve the decided semantics:

- A variable carries a semantic value consumers must bind and evolve together;
  name it by role, not literal.
- A local style carries a reusable paint, text, effect, or grid definition. Do
  not duplicate one decision across resource types unless required.
- A component carries a reusable responsibility. Define stable anatomy and
  expose only variations required by real usages.

Consume a component through a childless instance placeholder without layout or
appearance classes. Do not make a repeated shell or wrapping top-level subtree
a component unless every consumer can use that placeholder through supported
properties. Slots do not permit markup children on instance placeholders; keep
incompatible wrappers as ordinary structure around a compatible inner boundary.

Map each real component difference to the smallest supported mechanism: Text,
Boolean, Instance Swap, variant, Slot, or nested composition. Use one variant
axis per mutually exclusive categorical concern and Booleans only for
independently optional concerns. Do not encode arbitrary content as variants,
generate unused combinations, or freeze varying content as invariant.

If supported native mechanisms cannot express a real usage, do not weaken or
redesign it silently. Choose another valid boundary or report the limitation.

Read [variables.md](variables.md), [local-styles.md](local-styles.md), or
[component-authoring.md](component-authoring.md) only for selected resource
types.

## Verify the native handoff

Verify through representative consumers, not definitions alone: inspect native
bindings, Auto Layout, text resizing, property behavior, and every material
state. Raw literals and primitive lookalikes do not demonstrate system usage.

For components, verify visible inspectable definitions and native INSTANCE
consumers using [component-authoring.md](component-authoring.md). For variables
and styles, inspect live bindings rather than apply input or equal values.

Resolve warnings through real consumers, or remove a resource only when the
resolved plan no longer includes it. Tool friction, payload size, or an easy
resource type does not alter the plan. Do not create swatches, specimens,
definition panels, or redundant examples solely for verification; add
documentation only when requested.

Finish when selected resources support all requested usages and the live Figma
structure reconciles with the map. Do not expand for imagined future needs.
