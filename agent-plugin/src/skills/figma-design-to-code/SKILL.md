---
name: figma-design-to-code
description: >-
  Implement or update project-consistent UI code from one or more visible Figma
  nodes using TemPad Dev MCP. Use when the user wants Figma UI recreated, ported,
  or integrated into the target project's framework, components, styling,
  tokens, and assets. Do not use for Figma canvas editing, design critique,
  product invention, or generic code review.
---

# Implement Figma design in code

Turn visible Figma evidence into the smallest project-native implementation
that preserves the intended result. Keep that result focal: project files,
TemPad output, rules, and tool calls are evidence for the implementation, not
deliverables to reproduce mechanically.

Require TemPad Dev MCP to provide trustworthy design evidence for the current
selection or exact node IDs inside the user's established scope. Never
reconstruct the design from memory, screenshots alone, or `get_structure`
metadata.

## Evidence and authority

Use each source only for what it can establish:

- **The user** sets scope, requirements, prohibitions, and missing product or
  implementation decisions.
- **The project** sets framework, file placement, component boundaries,
  styling, tokens, assets, dependencies, and verification conventions.
- **TemPad Dev** sets visible structure and rendered design facts.

Follow project instruction files for concerns outside Figma-to-code
translation. Do not add policy for routing, analytics, i18n, CMS, or other
orthogonal systems.

TemPad can establish visible hierarchy, layout, spacing, typography, color,
effects, token references, exported assets, and codegen unit context. It cannot
establish unevidenced states, responsive behavior, business logic, navigation,
validation, analytics, or project conventions. Treat `get_structure` as
hierarchy and geometry evidence only, never as missing style truth.

## Workflow

### 1. Establish the implementation envelope

Read only local evidence that can change this implementation, in this order:

1. applicable `AGENTS.md` or equivalent instructions;
2. relevant design-system, token, component, and asset guidance;
3. the nearest comparable implementation and reusable primitives;
4. framework, styling, and check configuration needed for this task.

Determine the target file or component boundary, framework, styling method,
token and asset paths, reuse candidates, dependency constraints, and narrowest
relevant checks. Inspect Tailwind version and theme scales only when the
project actually uses Tailwind-compatible tooling.

Do not inventory the repository broadly after the needed envelope is clear. If
a missing project decision would materially change the result, ask before
implementation.

### 2. Read the design at the requested scope

Call TemPad Dev's `get_code` directly for the requested roots before implementing:

- omit `nodeId` and `nodeIds` for the current selection, including multiple nodes;
  use `nodeId` for one exact target or `nodeIds` for several. Use only IDs supplied
  by the user or returned by TemPad inside the established scope;
- default to `resolveTokens: false`. Use `true` when literal output is requested
  or a targeted read is needed to establish a consumer's actual value;
- set `preferredLang` from the project target; treat returned `lang` as
  authoritative because plugin configuration may override that preference;
- keep TemPad's default vector behavior unless the user explicitly requests
  asset-preserving vector fidelity and the active MCP version supports it.

Keep each root's `code`, `lang`, `warnings`, `assets`, `tokens`, and `codegen`
together. In a batch, each `results` entry identifies its `nodeId` and carries
either a `result` payload or an `error`. Use that root's
`codegen.config.{cssUnit,rootFontSize,scale}` for exact unit conversion.

Preserve the requested composition within each root. Load only the guidance
relevant to the returned evidence:

- [Assets](references/assets-and-tokens.md#assets) for asset delivery;
- [Tokens](references/assets-and-tokens.md#tokens) for token definitions,
  references in code, or consumer values needed for a mapping decision;
- [Recovery](references/recovery.md) for `remainingNodeIds`, errors, warnings,
  wrong-file reads, or incomplete evidence.

### 3. Separate facts, adaptations, and gaps

Before editing, distinguish:

- **design facts** to preserve;
- **project-native adaptations** supported by existing components, tokens,
  utilities, or asset conventions;
- **unevidenced product decisions** that must remain unimplemented or be asked.

Map by rendered value and semantics, not by a convenient name. A familiar
component or token is a candidate, not proof of equivalence. If more than one
material implementation path remains equally plausible, ask the user. Infer
only low-consequence details and report any inference that affects the result.

### 4. Implement the smallest coherent change

- Keep the established framework, styling system, file placement, imports, and
  abstraction level. Do not introduce a parallel system.
- Reuse an existing primitive only when its semantics and rendered behavior fit
  without guessing. Do not force reuse that erases design facts.
- Preserve exact rendered values unless project evidence proves an equivalent
  token, utility, or component. For `rem` output, convert with TemPad's actual
  `cssUnit`, `rootFontSize`, and `scale`.
- Preserve intentional uncommon output, including pseudo-elements, filters,
  masks, blend and backdrop effects, gradients, and non-default compositing,
  unless a documented project constraint requires an adaptation.
- Implement only evidenced states and responsiveness. Do not invent hover,
  loading, error, empty, disabled, or responsive behavior.
- Use native semantic elements and preserve keyboard access and accessible
  names when an established primitive does not already provide them.
- Add no runtime or build dependency without user approval unless the user has
  explicitly waived that constraint.
- Keep `data-hint-*` attributes out of shipped code.

Do not enter a visual tuning loop. Change the implementation again only when
new project, design, tool, or verification evidence identifies a concrete
defect.

### 5. Verify in the project's real workflow

Run the narrowest relevant checks defined by project instructions and scripts.
Repair implementation failures and rerun the affected checks. Use an existing
preview, screenshot, or comparison workflow when available; do not invent a
universal verification matrix.

If no runnable check exists, report the implementation as unverified. Do not
claim visual completion without a real project comparison path; ask the user
to confirm the rendered result against Figma.

## Hard stops

Pause the affected work and anything that depends on it when:

- TemPad is unavailable, unauthorized, inactive on the intended file, or
  cannot provide trustworthy evidence for a required composition;
- the target is unreadable or not visible;
- project, design, and user evidence still conflict after targeted recovery;
- a missing decision would materially change behavior, structure, dependency,
  asset delivery, or token mapping;
- required assets cannot be retrieved or stored under project policy.

Continue independent work supported by sufficient evidence. Report any
requested scope left incomplete and the concrete action needed to unblock it.

## Handoff

Report:

- what changed and where;
- only the relevant adaptation, inference, warning, asset/token handling, or
  residual visual risk;
- checks run, their result, and what remains unverified.

Keep absent concerns absent from the handoff. Do not produce a compliance
checklist for branches the task never used.

## Decision example

If TemPad emits `padding: 15px` and the project has a `space-4` token worth
`16px`, preserve `15px` unless project evidence explicitly makes the token the
intended mapping. Project consistency selects the representation; it does not
authorize changing the visible design.
