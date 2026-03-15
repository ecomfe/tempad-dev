---
name: figma-design-to-code
description: >-
  Implement or update project-consistent UI code from a Figma selection or
  nodeId using TemPad Dev MCP. Use when the user wants visible Figma UI
  recreated, ported, or integrated into the target project's framework,
  styling system, tokens, and existing components when available. Do not use
  for design critique, product invention, generic code review, or for guessing
  hidden states, responsiveness, or behavior not shown in design or project
  evidence.
metadata:
  version: '4.3'
---

# TemPad Dev: Figma Design to Code

Use this skill to turn TemPad Dev design evidence into project-consistent UI
code.

TemPad Dev MCP must be available and able to provide trustworthy design
evidence for the current selection or provided `nodeId`. If not, stop and tell
the user to enable or reconnect TemPad Dev MCP.

Within this skill, TemPad Dev MCP is the authoritative source of design
evidence. Treat:

- project files and project instructions as implementation truth when available
- TemPad Dev output as design truth
- the user as the source of truth for missing product or implementation
  decisions

Do not infer project conventions before reading local evidence.

For concerns orthogonal to Figma-to-code translation, follow project
instruction files such as `AGENTS.md` and other project instructions instead of
defining new policy in this skill. If such a concern is unspecified there and
would materially change the implementation, ask the user or stop.

## Evidence model

Use three evidence channels for different jobs:

- **Project evidence**: `AGENTS.md` or equivalent project instruction files,
  design-system docs, token/theme docs, component docs, existing primitives,
  nearby implementations, framework/styling config, asset rules, and project
  scripts
- **Design evidence**: `tempad-dev:get_code` first for markup, styles, tokens,
  assets, warnings, and codegen facts; `tempad-dev:get_structure` only for
  hierarchy, geometry, overlap, and retry targeting
- **User input**: missing behavioral intent, responsive intent, target file,
  acceptable tradeoffs, asset or dependency decisions, or other product or
  implementation decisions that cannot be recovered from project or design
  evidence

## What TemPad Dev can and cannot prove

TemPad Dev can prove:

- the visible structure of the current selection or a provided `nodeId`
- explicit layout, spacing, typography, color, radius, borders, shadows,
  gradients, masks, filters, compositing, and other rendered visual details
- token references and values when present
- exported assets and whether an SVG may safely adopt one contextual color
  channel via `themeable`
- codegen facts such as actual output language, `cssUnit`, `scale`, and
  `rootFontSize`

TemPad Dev cannot prove:

- hidden, hover, active, loading, error, empty, disabled, or responsive states
  unless separately evidenced
- non-visual product requirements such as behavior, business logic, validation,
  navigation, or analytics
- project conventions, file placement, component boundaries, primitive-reuse
  policy, token-mapping policy, or asset workflow beyond what the project
  already establishes
- missing style truth from `get_structure`; it is only a structure aid

## Default operating rules

Do not output `data-hint-*` attributes.

Never invent visual details or behavior not evidenced, including color,
typography, spacing, radius, borders, shadows, gradients, opacity, overlays,
blur, hidden states, responsive behavior, interactions, or asset semantics.

Treat advanced or uncommon style output from TemPad Dev as intentional unless
project constraints force an adaptation.

Only ask the user when the answer would materially change the implementation and
cannot be established from project or design evidence. Typical blockers:

- more than one plausible target file or component boundary
- more than one plausible existing primitive or abstraction to reuse
- missing behavior, state, or responsive intent
- asset, dependency, or token workflow requiring a product decision

If a gap is minor and non-blocking, proceed with a clearly stated inference.

Prefer the **smallest safe change**. Do not perform unrelated refactors or add
new abstractions unless project patterns clearly call for them.

Do not enter open-ended visual tuning loops without new evidence. If remaining
differences cannot be proved from project or design evidence, warn clearly and
stop or hand off for user validation.

## Workflow

### 1. Read local evidence first

Read local evidence before implementing. Prioritize, in order:

1. `AGENTS.md` or equivalent project instruction files
2. relevant design-system, token, and component docs
3. existing primitives/components and nearby implementations
4. config files and scripts that constrain output

Establish at least:

- framework/runtime and file conventions
- styling rules, including whether utilities are used and how classes are
  ordered or formatted
- token/theme system and mode handling
- asset and icon pipeline
- reusable primitives/components, file placement, and import path conventions
- the narrowest established project checks for this change, if any

Only if the project actually uses Tailwind or Tailwind-compatible tooling,
detect Tailwind version and config before changing class syntax or ordering.

For Tailwind projects, also inspect the local theme scales relevant to exact-
value mapping, especially spacing, sizing, radius, and typography.

If a material implementation constraint is still missing after local evidence,
ask the user instead of inferring it.

### 2. Fetch the top-level design snapshot

Call `tempad-dev:get_code` first.

Use these defaults:

- `resolveTokens: false`
- pass `nodeId` only when the user provided one; otherwise use the current
  selection
- set `preferredLang` to match the project target, such as `jsx` or `vue`

Use TemPad's default vector behavior unless the user explicitly asks for
asset-preserving vector fidelity and the current MCP version clearly supports
it.

Use `resolveTokens: true` only when the user explicitly does not want
design-token usage.

Treat returned `lang` as authoritative because TemPad Dev plugin or config may
override `preferredLang`.

Record these as design facts:

- `code`
- `lang`
- `warnings`
- `assets`, if present
- `tokens`, if present
- `codegen`

Use `codegen.config.{cssUnit,rootFontSize,scale}` as the authoritative unit
context for exact-value mapping.

Prefer fetching the full requested top-level selection first so parent
composition and containment are not lost.

### 3. Resolve incomplete or conflicting evidence before implementing

If `get_code` warns or fails, narrow uncertainty instead of guessing.

- **`depth-cap`**: keep the returned top-level result as the source of parent
  layout and composition, then fetch the listed subtree roots with `get_code`.
  If warning data indicates overflow such as `cappedNodeOverflow=true`, treat
  evidence as incomplete and stop full implementation unless the user narrows
  scope or prioritizes subtrees.
- **budget overflow or shell response**: keep the returned parent shell as the
  composition source of truth, then fetch omitted child subtrees separately and
  fill them into that known shell. Prefer the smallest parent container that
  still preserves the shared layout for the child subtrees you must assemble.
  Do not treat plain string truncation as usable evidence.
- **layout, hierarchy, or overlap uncertainty**: call
  `tempad-dev:get_structure`, but use it only to resolve hierarchy or geometry,
  or to choose a narrower parent-shell retry target. Do not treat it as
  missing style truth.
- **remaining contradiction**: if project evidence, design evidence, and
  structure evidence still conflict after narrowing, stop.
- **untrustworthy parent recovery**: if you still cannot obtain a trustworthy
  parent shell or parent composition via `get_code`, stop full implementation
  and ask the user to narrow scope or choose the highest-priority subtree.

Retry policy:

- retry once only for transient transport or connectivity failures
- do not blind-retry deterministic issues such as invalid selection, hidden
  node, wrong file, `depth-cap`, budget overflow, or unreadable target; change
  scope or inputs first

If TemPad MCP appears unavailable, inactive, or pointed at the wrong file, stop
and tell the user to:

- enable MCP server in TemPad Dev Preferences
- keep the correct TemPad Dev / Figma tab active
- use the MCP badge in the TemPad Dev panel to activate the correct file if
  multiple Figma tabs are open

If asking the user to narrow scope because of budget overflow, report the
current consumption, limit, and overage from the error text.

### 4. Implement code in the established project style

Translate TemPad Dev output into the implementation's established patterns.

- Reuse existing primitives and abstractions when they fit **without guessing**.
- Keep the established framework and styling system. Do not introduce a second
  one.
- Follow established file placement and import conventions.
- If the implementation is utility-first, keep utilities and match existing
  conventions. Otherwise translate generated utilities into the established
  styling approach while preserving values.
- Preserve exact values. Do not coarsen arbitrary values such as `py-[4px]`,
  `text-[12px]`, or `font-[600]` into named utilities unless local project
  evidence proves the same rendered value; for `rem` output, use
  `codegen.config.{cssUnit,rootFontSize,scale}` to convert exactly. Apply this
  to spacing, sizing,
  inset, gap, radius, `font-size`, `line-height`, `letter-spacing`, and
  `font-weight`.
- Implement the base state only unless variants, interactions, or responsive
  behavior are evidenced.
- Preserve emitted pseudo-elements. If TemPad output includes `before:`,
  `after:`, `content-*`, or equivalent CSS, keep them or use an established
  equivalent with the same rendered result.
- Preserve other high-fidelity details from `get_code`, including pseudo-
  classes, filters, masks, blend or backdrop effects, and other non-default
  visual properties, unless implementation constraints require adaptation.
- New runtime or build dependencies require user confirmation unless explicitly
  waived.
- Extract new abstractions only when repetition plus established patterns
  justify it.
- If multiple plausible primitives, layout abstractions, or delivery strategies
  fit and evidence does not decide, ask the user instead of guessing.

#### Assets

Follow the established asset policy first.

- Download bytes only from TemPad-provided `asset.url`. Never substitute public
  internet assets.
- Treat assets as files to save or reference, not as text evidence to parse.
- If policy forbids storing assets, you may reference TemPad URLs, but you must
  warn that the output depends on the local TemPad asset server.
- If a vector is already emitted as inline SVG in `code`, treat that markup as
  the current design truth for structure and sizing. Only refactor delivery
  when the implementation already has another established SVG policy.
- Do not introduce a new SVG pipeline if one is already established.
- Preserve vector semantics:
  - `themeable: true` means one context-driven color channel, typically via
    `currentColor`
  - drive that color from the established wrapper or component styling rather
    than inventing a new icon API
  - vectors without `themeable: true` keep their internal palette
- Use `asset.themeable` only after accounting for the project's existing SVG
  delivery policy.
- Do not invent multi-color SVG props or custom CSS variables unless the
  implementation already has an established icon API that requires them.

#### Tokens

Preserve design-token usage by default.

Token evidence may be either direct values or mode-specific values keyed by
`Collection:Mode`. Preserve references between variables when present.

- Prefer existing tokens only when equivalence is justified by value,
  references, and semantics, not by name alone.
- If the implementation can safely carry design-token references for this
  change, preserve TemPad token references until they are mapped through the
  normal token workflow.
- Add new tokens only when there is already an established process for doing so
  and this change is expected to use it.
- If token landing, mode selection, or mapping remains ambiguous or unsupported,
  use explicit values and warn.
- Hints may be used only for reasoning about mode selection; never output hint
  attributes.

#### Semantics and accessibility

When not already using an appropriate primitive or component:

- use native elements where appropriate, such as `button`, `a`, `input`, and
  `label`
- preserve keyboard interaction and focusability
- add accessible names when needed, such as `aria-label` or `alt`

Assume the existing CSS reset or normalize strategy. Do not add new reset
libraries or global CSS unless there is already a defined pattern for it.

### 5. Project checks and handoff

Project checks are project-defined, not skill-defined.

- Follow project instruction files such as `AGENTS.md`, local docs, and
  existing project scripts for any lint, format, typecheck, build, test,
  preview, screenshot, or design-comparison steps relevant to this change.
- Run the narrowest relevant checks that the project already defines and the
  current host or client can actually execute.
- If those checks fail, repair obvious implementation issues when feasible and
  re-run the relevant checks.
- Do not invent a default verification matrix just because this is a
  Figma-to-code task.
- If no established or runnable check path exists for this change, say the
  output is **unverified**.
- If shell recovery or subtree stitching was involved and no existing project
  check can confirm the resulting layout, explicitly call out the remaining
  visual risk.
- Do not claim visual or design-complete verification unless the project
  already has a normal preview, screenshot, or design-comparison workflow.
  Otherwise ask the user to visually validate the result against Figma.

## Stop conditions

Stop instead of shipping code when:

- TemPad Dev MCP is unavailable, unauthorized, disconnected, inactive on the
  correct file, or otherwise cannot provide trustworthy design evidence
- the target cannot be read or is not visible
- project, design, and user evidence still conflict after narrowing
- a missing user decision would materially change the implementation and cannot
  be safely inferred
- required implementation constraints are missing and cannot be safely inferred
  from project or design evidence
- a trustworthy parent composition cannot be recovered after `depth-cap`, shell
  response, or budget overflow
- required assets cannot be retrieved or stored under the established policy
- new dependencies would be required and user confirmation has not been obtained

## Output contract

When shipping code, end with:

- what was implemented and where
- evidence caveats, warnings, any stated inference, and whether shell recovery
  or subtree stitching was used
- asset handling, including whether assets were stored locally or still depend
  on TemPad URLs
- token handling, including mapped tokens, preserved references, or explicit
  fallback values
- dependency notes, including whether any were added and whether approval was
  obtained
- project-check status, including commands run if any, what passed or failed,
  and what remains unverified
- any residual visual risk and the visual confirmation the user should still
  perform

If blocked, provide at most 3 concrete next items needed from the user.

## Examples

### Example: over-budget parent with recoverable shell

- `get_code` returns a parent shell plus budget overflow details
- keep that shell as the composition source of truth
- fetch missing child subtrees with `get_code`
- insert them into the known parent structure
- do not rebuild sibling layout from guesswork
- if no trustworthy parent shell can be recovered, stop and ask for a narrower
  scope instead of reconstructing parent layout from guesses
- report any remaining visual risk if project checks cannot confirm the layout

### Example: SVG marked `themeable: true`

- first check the established icon or SVG delivery policy
- if the implementation already uses contextual icon color, adapt the SVG to
  one color channel, usually `currentColor`
- do not invent multi-color props or a custom icon API
- if more than one delivery strategy is plausible and evidence does not decide,
  ask the user

### Example: token mapping is ambiguous

- preserve TemPad token references if the implementation can safely carry them
- map to existing tokens only when value plus semantic equivalence is justified
- if mode selection or landing zone is still unclear, use explicit values and
  warn instead of inventing a mapping
