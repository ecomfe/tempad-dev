# RATIONALE

## Purpose

This document explains the intent behind the `figma-design-to-code` skill.
It is a maintenance aid, not runtime instruction.

The skill exists to help an agent turn TemPad Dev MCP design evidence into
project-consistent UI code.

## Core principles

### 1. This is an evidence-translation skill

The skill is designed around three sources of truth:

- project files and project instructions for implementation truth
- TemPad Dev output for design truth
- the user for missing product or implementation decisions

The agent should not guess what it cannot prove.

### 2. Project consistency matters more than raw codegen

A good result is not just visually similar output.
It must also fit the target project's:

- framework and file conventions
- styling system
- token workflow
- asset pipeline
- reusable primitives and abstractions

Project consistency does not justify erasing exact design values.
If TemPad emits a precise value, the agent should preserve it unless local
project evidence proves an exactly equivalent utility, token, or abstraction.
In utility-first systems such as Tailwind, collapse arbitrary values only when
the local theme proves an exact match, using TemPad
`codegen.config.{cssUnit,rootFontSize,scale}` when `rem` conversion is
involved.

### 3. The skill should stay narrow

This skill is for Figma design-to-code.
It should not become a general policy layer for unrelated concerns such as
routing, analytics, i18n architecture, CMS strategy, or other orthogonal
systems.

Those concerns should come from project instruction files such as `AGENTS.md`.

### 4. The skill must be honest about uncertainty

The skill should stop, ask, or warn when evidence is incomplete.
It should not invent hidden states, responsive behavior, business logic, or
visual details that are not supported by project or design evidence.

## Why the skill is structured this way

## Evidence first

The workflow starts by reading local project evidence before implementing.
This is intentional.

Most design-to-code failures come from violating project conventions rather
than from failing to extract visible UI from the design.

## `get_code` before `get_structure`

TemPad Dev `get_code` is treated as the primary design-evidence source.
`get_structure` is only a structural aid for hierarchy, geometry, overlap, and
scope recovery.

This prevents the agent from reconstructing detailed UI from structural hints
alone.

## Pseudo-elements are first-class UI

Pseudo-elements such as `::before` and `::after` are often visible parts of the
design, not optional decoration.
If TemPad emits `before:*`, `after:*`, `content-*`, or equivalent pseudo-
element styling, dropping those styles is a correctness bug, not a stylistic
tradeoff.

## Bad-weather handling stays in the main skill

TemPad-specific failure handling remains in the core skill because it directly
affects common execution paths, especially:

- unavailable, inactive, or wrong-file MCP state
- large selections
- `depth-cap`
- budget overflow
- shell recovery
- subtree refetching
- asset handling
- `themeable` SVG behavior, including color evidence on emitted markup

These are not optional edge notes. They materially affect whether the agent can
produce trustworthy output.

## Smallest safe change

The skill prefers the smallest safe change that satisfies the design evidence.
It avoids unrelated refactors and unnecessary abstraction unless local project
patterns clearly justify them.

## Why some things are intentionally excluded

### No separate “existing repo” vs “greenfield” modes

That distinction was intentionally removed.
The meaningful decision is whether enough implementation evidence exists, not
which lifecycle label applies.

### No project-wide policy authoring

The skill does not define new policy for orthogonal concerns.
If such a concern materially affects implementation and is not already defined,
the agent should ask the user or stop.

### No built-in universal verification matrix

Lint, format, typecheck, build, tests, preview, or screenshot comparison are
project-defined concerns.
The skill should use the narrowest relevant checks already defined by the
project and supported by the current host or client.

If no such path exists, the result should be reported as unverified.

### No automatic claim of visual completeness

Unless the project already has a reliable preview, screenshot, or design-
comparison workflow, final visual confirmation belongs to the user.

## Why the final version did not use extra packaging complexity

### No `compatibility` field

It was removed because the most obvious candidates for that field, such as Node
version or active tab state, were either:

- lower-level setup requirements for TemPad itself, or
- runtime troubleshooting facts

They did not add enough value as packaging metadata.

### No `references/` split yet

A reference split was considered and rejected for now.
The current skill is still compact enough, and the most valuable TemPad-
specific details are needed on the main execution path.

## Examples philosophy

Examples are kept only as boundary fixtures.
They are not there to repeat the workflow.
They exist to stabilize high-risk decisions such as:

- shell recovery after budget overflow
- `themeable: true` SVG handling with emitted-root color evidence
- ambiguous token mapping
- exact-value normalization only when project equivalence is proven
- pseudo-element preservation

## What future revisions should preserve

Any future revision should preserve these properties:

- a clear single-purpose scope
- the project / TemPad / user evidence hierarchy
- `get_code` as the primary evidence source
- emitted auto-layout and emitted SVG root markup treated as design evidence, not post-hoc hints
- exact rendered values preserved unless project-native equivalence is proven
- pseudo-elements preserved as first-class rendered output
- strict refusal to guess unsupported visual or behavioral details
- explicit handling of TemPad failure modes
- minimal-diff implementation style
- truthful handoff, including what remains unverified

## Summary

The skill is built on four commitments:

1. design-to-code is an evidence problem, not a guessing problem
2. project consistency matters more than raw codegen purity
3. the skill should stay narrow and avoid absorbing orthogonal concerns
4. truthful handoff matters as much as implementation quality
