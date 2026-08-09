# Create or extend a design system

Read this reference only when the user explicitly asks to create or supplement
a design system. Do not enter this workflow for ordinary canvas composition,
an empty file, or repeated visual elements alone.

## Contents

- [Establish the basis](#establish-the-basis)
- [Model only demonstrated decisions](#model-only-demonstrated-decisions)
- [Validate through use](#validate-through-use)

## Establish the basis

Treat the user's requested scope as the boundary. Use permitted existing
designs, brand material, and named product requirements as evidence. Do not
claim project-specific intent when none exists; make the smallest necessary
general choice and keep it easy to revise.

Before writing, identify:

- the concrete screens or usage cases the system must support;
- reusable responsibilities whose consumers, state behavior, or expected
  shared evolution may make a shared definition valuable;
- real content, state, and substitution differences;
- anything the user explicitly excludes.

When the scope is complex enough to benefit, keep a private working map of
concrete usages, real consumers or states, and the value of shared evolution.
Revisit the decisions after the compositions exist, because early selection
cannot reveal every useful abstraction. The map is an attention aid, not a
mandatory classification pass, canvas documentation, an inventory-completion
target, or a rule that repetition creates a resource. Do not design a complete
hypothetical system around one example.

"Create your own design system" means create and use the necessary native
resources. It does not by itself require a swatch, specimen, or documentation
board. Include one when the user asks for it or when it is a material part of
the requested handoff, not as verification scaffolding. Any optional definition
layout is subordinate to the resources: size it around their real contracts;
never distort a component or variant merely to make that container fit.

For a system spanning several usages, prefer a concrete-to-reusable loop:

1. Identify the requested usage cases and any shared responsibility with
   plausible value through reuse, state consistency, or coordinated change.
2. Author only foundational variables and styles whose final consumers are
   already known.
3. Validate one representative composition before propagating its language.
4. Decide which demonstrated responsibility merits a component from expected
   reuse, shared change, state consistency, variation, and abstraction cost;
   define its contract from the real usage differences.
5. Revisit the resource plan against the delivered usages. Replace provisional
   choices when the concrete reuse, shared change, states, or divergence show a
   more valuable system boundary.

When several candidates exist, compare their coordination value before
committing the boundary. Prefer the shared definition that best prevents
cross-consumer drift, inconsistent state, or repeated coordinated change; do
not let a convenient leaf component stand in for a more valuable boundary. An
early seed resource remains provisional when later composition reveals a
stronger candidate.

Adapt the ordering when a small scope or established pattern already provides
strong evidence. Do not use a specimen of guessed components as a substitute
for concrete usage: real composition reveals which anatomy is stable and which
differences require local structure, properties, composition, or variants.

## Model only demonstrated decisions

- Create a variable for a repeated semantic decision, not merely every repeated
  literal. Name it by role rather than current value.
- Tokenize recurring layout decisions such as spacing rhythm, control size, or
  corner roles only when they have multiple real consumers. Screen dimensions,
  content-driven media geometry, and one-off optical adjustments stay literal.
- Create a style when a reusable native style is part of the requested system;
  do not duplicate the same decision as unrelated styles and variables without
  a concrete need. Consider recurring typography roles when concrete consumers
  would benefit from shared evolution.
- Create a component when it represents a reusable responsibility with stable
  anatomy and a shared definition has concrete value through expected reuse,
  coordinated change, state consistency, or a meaningful variation contract.
  Expose only content, state, or substitution that real usages need.
- Treat repetition and structural similarity as evidence, never as a threshold
  or default. One demonstrated usage with material states or established reuse
  may justify a component; many similar copies may remain local when shared
  evolution has little value. Weigh reuse, divergence, state behavior, API
  clarity, and maintenance cost. Elapsed time, tool friction, or already-authored
  copies are not design evidence.
- Distinguish divergence from an interface. When usages share one responsibility
  and stable anatomy but differ through a supported content, state, or
  substitution property, that difference can strengthen the value of coordinated
  change; it is not by itself a reason to keep copies local. Keep them separate
  when their ownership, behavior, anatomy, expected evolution, or abstraction
  cost makes independent definitions more truthful.
- Treat literal content values as inputs, not anatomy. Different text, media,
  labels, or metadata do not establish independent ownership or evolution. A
  Local rationale must name a difference in responsibility, behavior, structure,
  ownership, expected evolution, or abstraction cost—not merely different
  content that a property, Slot, or instance swap can express.
- Add a variant axis only for a supported categorical choice. Do not encode
  arbitrary content as variants or generate an unused Cartesian product.
- Prefer composition and Slots for genuinely variable nested content. Avoid
  speculative properties and premature abstraction.

Before authoring a selected component, map its concrete usages privately:

```txt
usage | stable anatomy | differing content/state/substitution | mechanism or invariant
```

Map each meaningful difference to the smallest supported component mechanism,
such as Text, Boolean, Instance Swap, a variant, a Slot, or nested composition.
Mark something invariant only when every real usage agrees. If the intended
contract cannot express a real difference, revise the structure or keep that
responsibility local; do not create a component that silently freezes varying
content or state.

Read [variables.md](variables.md), [local-styles.md](local-styles.md), or
[component-authoring.md](component-authoring.md) only for resource types the
requested scope requires.

## Validate through use

Judge a resource in representative composition, not from its definition alone.
For components, follow [component-authoring.md](component-authoring.md): the
representative composition must contain native instances of the new definition.

Create only the smallest examples needed to exercise meaningful content,
states, and layout behavior. Check native bindings, Auto Layout, text resizing,
property behavior, and visual consistency. Instantiate each materially distinct
property or variant state; geometry changes only when reflow is part of the
component contract. In the workflow's final visual check, inspect only visually
consequential properties. For variables and styles, inspect every representative
binding; equivalent raw literals do not demonstrate system usage.

Close the authored system only after concrete consumers exist:

- Reconcile every authored resource with the consumers that justified it.
  Revise a component contract and replace same-responsibility copies with native
  instances; bind variables and styles to the semantic fields their names
  claim. Remove a definition that concrete use no longer justifies.
- Revisit the strongest remaining shared decision across behavior, typography,
  layout, and appearance. Choose from reuse, coordinated change, state or
  variation, divergence, ownership, and abstraction cost—not literal equality
  or content differences. Author the resource when shared evolution earns its
  cost; otherwise keep the decision local for a concrete reason.
- Resolve authoring warnings through real consumers or removal, and inspect
  every materially distinct component state. A representative binding proves
  connectivity, but an equal literal on an intended peer is not native system
  usage.

Use the cheapest sufficient evidence for these outcomes. This is not a required
inventory, resource count, or tool sequence, and repetition remains evidence
rather than a threshold. Treat tooling that blocks a selected abstraction as a
delivery limitation, not design judgment; continue closing unaffected resources.
Never add a swatch, specimen, or definition panel solely to silence a warning or
stand in for final usage. A staged authoring call may warn temporarily.

If the strongest remaining shared decision stays literal or local, state the
reason briefly in the handoff; do not emit an exhaustive candidate inventory.

Keep examples when the user requests documentation/specimens or the requested
handoff materially benefits from them. Requesting a local design system alone
does not imply either; never leave examples only as verification scaffolding.

Finish when the requested usage cases are supported. Do not expand the token
taxonomy, component inventory, modes, variants, or documentation for imagined
future needs.
