---
name: figma-design-to-code
description: >-
  Implement integration-ready UI code from a Figma selection or a provided nodeId using TemPad Dev MCP as the only source of design evidence (code snapshot, structure, assets, tokens, codegen config). Detect the target repo stack and conventions first, then translate TemPad Dev’s Tailwind-like JSX/Vue IR into project-native code without adding new dependencies. Never guess key styles or measurements. If required evidence is missing/contradictory or assets cannot be handled under repo policy, stop or ship a safe base with explicit warnings and omissions.
---

# TemPad Dev: Figma Design to Code

This skill requires TemPad Dev MCP. If `tempad-dev:*` tools are unavailable/inactive/unauthorized, stop and tell the user to install TemPad Dev MCP and ensure it is activated in the TemPad Dev panel in the Figma design file.

TemPad Dev outputs Tailwind-like IR in either JSX or Vue. Treat MCP outputs as design facts. Never guess key styles.

## Evidence rules

Priority order:

1. `tempad-dev:get_code` (authoritative: explicit values, layout intent, warnings, assets, tokens, codegen, lang)
2. `tempad-dev:get_structure` (hierarchy, overlap, bounds clarification)

Never invent: colors, typography (size/weight/line-height/letter-spacing), spacing, radius, borders, shadows, gradients, opacity/overlays, blur.

Do not output `data-hint-*` attributes.

Treat advanced/rare style output as high-confidence evidence from TemPad codegen. Preserve it unless it directly conflicts with repo constraints.

## Workflow

### 1) Detect repo conventions

From the repo (do not assume), identify what is needed to integrate cleanly:

- Framework/runtime and file conventions (React/Vue, TS/JS, SFC conventions, naming)
- Styling integration rules (utility allowed? class sorting? linting? extraction patterns?)
- Token/theme system (CSS variables, token files, naming, dark mode/modes)
- Asset policy (public folder vs imports, icon pipeline, hashing, directory rules)
- Existing primitives/components (buttons, inputs, typography, layout wrappers), import path conventions

Only if the repo actually uses Tailwind (or Tailwind-compat tooling), also detect Tailwind version and conventions that affect class syntax/formatting.

If uncertain, ask up to 3 minimal questions; otherwise proceed and warn where inferred.

### 2) Fetch baseline design snapshot

Call `tempad-dev:get_code` with:

- `resolveTokens: false`
- pass `nodeId` only if user provided one; otherwise rely on the tool’s default behavior (current selection)
- `preferredLang`: choose what matches the repo (jsx or vue)

Important: `get_code.lang` is the language actually used by MCP after considering TemPad Dev plugin/config priority. A plugin may override `preferredLang`. Use returned `lang` plus `codegen` facts to interpret the IR correctly, then translate to the repo’s required output.

Record as design facts:

- `code`, `lang`
- `warnings`
- `assets` (if present)
- `tokens` (if present)
- `codegen` (e.g. scale, length units, rootRem, and other normalization settings)

### 3) Resolve warnings and uncertainty

If warnings indicate missing/partial/uncertain evidence, act immediately:

- `depth-cap`: call `get_code` once per listed subtree root `nodeId` and stitch results before implementing.
  - If warning data indicates overflow (for example `cappedNodeOverflow=true`), treat evidence as incomplete and stop full implementation. Ask for narrower scope or user-prioritized subtrees.
- output budget exceeded error: pass a smaller subtree `nodeId` to narrow scope, then retry `get_code`.
  - Always report current consumption, limit, and overage from the error text when asking for scope changes (for example `current ~7800 tokens / 31240 bytes; limit ~6000 tokens / 24000 bytes; over by ~1800 tokens / 7240 bytes`).
- Layout/overlap uncertainty: call `get_structure` to resolve contradictions.
  - If contradictions remain after structure (or cannot be narrowed), stop.

Retry policy:

- Retry once only for transient transport/connectivity failures (e.g. timeout/disconnect/no active extension after reconnect/activation).
- Do not blind-retry deterministic errors (`depth-cap`, budget exceeded, invalid selection, node not visible). Change scope or inputs first.

### 4) Assets handling (only if `assets` exists)

Follow repo asset policy first:

- Download bytes via TemPad-provided `asset.url`, save into repo at policy-correct path, reference with repo conventions.
- If policy forbids storing assets, you may reference TemPad URLs but must warn output depends on the local TemPad asset server.
- Do not read image/SVG bytes into LLM context for analysis. Treat assets as files to download/reference, not text evidence to parse.

Never download assets from the public internet. Only TemPad-provided `asset.url`.

### 5) Tokens mapping (only if `tokens` exists)

Token evidence shape:

- `tokens` is a record keyed by canonical CSS variable names (e.g. `--...`).
- Each token’s value is either a string or a record keyed by `Collection:Mode` strings whose values are strings.
- Any value string may reference other variables; preserve references.

Mapping goal: integrate with repo tokens when safe; otherwise keep explicit values from `get_code`.

Rules:

1. Prefer existing repo tokens when you can justify equivalence using value equivalence (including references) plus semantic alignment in the repo.
   Token naming can be supporting evidence, but do not map solely because names look similar.
2. Add new tokens only if the repo already has an established token workflow and this change is expected.
3. If mode selection or mapping remains ambiguous, keep explicit values and warn.

Hints may be used only for reasoning about mode selection when present; never output hint attributes.

### 6) Implement repo-native code

Translate TemPad Dev IR into the repo’s conventions:

- Utility-first repo (Tailwind/UnoCSS): keep utility classes; adjust ordering/formatting to match repo rules. If Tailwind is used, respect the repo’s Tailwind version/config before changing class syntax.
- Non-utility repo: translate utilities into the repo’s styling approach (CSS Modules/scoped CSS/Sass/CSS-in-JS) while preserving explicit values.

Constraints:

- Do not introduce new frameworks or styling systems.
- New runtime/build dependencies require user confirmation unless the user explicitly says no confirmation is needed.
- Implement base state only unless variants/states are provable from repo conventions or evidence.
- Preserve high-fidelity style details from `get_code` (including pseudo-elements/pseudo-classes, uncommon style properties, filters/masks/blend/backdrop effects, and non-default compositing details). Do not simplify them away unless required by repo constraints.

Component extraction and primitives:

- Extract only when repetition + repo patterns justify it.
- Prefer existing repo primitives/components when they match intended semantics and do not require guessing styles.

### 7) Semantics and accessibility minimums

Only apply when the IR would otherwise require plain container semantics (e.g. clickable `div`) and you are not already using an appropriate repo primitive/component:

- Use native elements where appropriate (`button`, `a`, `input/label`).
- Ensure keyboard interaction and focusability.
- Add accessible names when needed (`aria-label`, `alt`).

Assume the repo’s existing CSS reset/normalize. Do not add new reset libraries or global CSS unless the repo already has a defined pattern for it.

### 8) Exit and wrap-up

Stop (do not ship code) when:

- TemPad Dev MCP is unavailable/unauthorized, or target cannot be read
- Evidence is contradictory and cannot be resolved via structure or narrower scope
- Required assets cannot be retrieved/stored under repo policy

Otherwise, ship the best-evidence base implementation and end with:

- Evidence caveats: any `warnings`, omissions, or inferred repo conventions
- Assets: stored vs TemPad URLs, and any policy-driven constraints
- Tokens: mapped vs explicit values, and any ambiguity
- Dependencies: whether any were added (and whether user confirmation was obtained)
- If stopped: next required info (max 3 items)
