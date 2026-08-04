# Create or extend a design system

Read this reference only when the user explicitly asks to create or supplement
a design system. Do not enter this workflow for ordinary canvas composition,
an empty file, or repeated visual elements alone.

## Establish the basis

Treat the user's requested scope as the boundary. Use permitted existing
designs, brand material, and named product requirements as evidence. Do not
claim project-specific intent when none exists; make the smallest necessary
general choice and keep it easy to revise.

Before writing, identify:

- the concrete screens or usage cases the system must support;
- the visual roles that actually recur;
- the reusable component responsibilities and real variation axes;
- anything the user explicitly excludes.

Do not design a complete hypothetical system around one example.

## Model only demonstrated decisions

- Create a variable for a repeated semantic decision, not merely every repeated
  literal. Name it by role rather than current value.
- Create a style when a reusable native style is part of the requested system;
  do not duplicate the same decision as unrelated styles and variables without
  a concrete need.
- Create a component when it represents a reusable responsibility with a
  stable anatomy. Expose only content, state, or substitution that real usages
  need.
- Add a variant axis only for a supported categorical choice. Do not encode
  arbitrary content as variants or generate an unused Cartesian product.
- Prefer composition and Slots for genuinely variable nested content. Avoid
  speculative properties and premature abstraction.

Read [variables.md](variables.md), [styles.md](styles.md), or
[component-authoring.md](component-authoring.md) only for resource types the
requested scope requires.

## Validate through use

Judge a resource in representative composition, not from its definition alone.
For components, follow [component-authoring.md](component-authoring.md): the
representative composition must contain native instances of the new definition.

Create only the smallest examples needed to exercise meaningful content,
states, and layout behavior. Check native bindings, Auto Layout, text resizing,
property behavior, and visual consistency. In the workflow's final visual
check, inspect only visually consequential properties.

Keep examples only when the requested deliverable includes documentation or a
specimen; otherwise avoid leaving verification scaffolding on the canvas.

Finish when the requested usage cases are supported. Do not expand the token
taxonomy, component inventory, modes, variants, or documentation for imagined
future needs.
