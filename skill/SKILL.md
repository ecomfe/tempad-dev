---
name: figma-design-to-code
description: >-
  Implement integration-ready UI code from a Figma selection or a provided nodeId using TemPad Dev MCP as the only source of design evidence in an existing repo. Use when an agent must translate TemPad Dev `get_code` / `get_structure` output into repo-native UI code, preserve design-token usage by default, reuse existing primitives and conventions, ask the user for missing product or implementation decisions when they materially affect the result, and stop instead of guessing unsupported design evidence.
---

# TemPad Dev: Figma Design to Code

This skill requires TemPad Dev MCP. If `tempad-dev:*` tools are unavailable/inactive/unauthorized, stop and tell the user to install TemPad Dev MCP and ensure it is activated in the TemPad Dev panel in the Figma design file.

Treat TemPad Dev outputs as design facts. Treat repo files as implementation facts. Treat the user as the source of truth for product decisions that are not provable from either.

## Operating rules

Use three evidence channels for different jobs:

- Repo evidence: `AGENTS.md`, repo instruction files, design-system docs, existing primitives/components, nearby implementations
- Design evidence: `tempad-dev:get_code`, then `tempad-dev:get_structure` if hierarchy or overlap is still unclear
- User input: missing behavioral intent, target location, acceptable tradeoffs, or other decisions that cannot be recovered from repo/design evidence

Do not infer repo conventions before reading local evidence.

Never invent: colors, typography (size, weight, line-height, letter-spacing), spacing, radius, borders, shadows, gradients, opacity, overlays, blur, hidden states, responsive behavior, or interactions that are not evidenced.

Do not output `data-hint-*` attributes.

Treat advanced or uncommon style output from TemPad codegen as high-confidence evidence. Preserve it unless it directly conflicts with repo constraints.

## Workflow

### 1) Detect repo conventions

Read local evidence before implementing. Prioritize, in order:

1. `AGENTS.md` and repo instruction files
2. design-system docs, token/theme docs, component docs
3. existing primitives/components and nearby implementations
4. config files that constrain output (framework, styling, linting, formatting, build)

Identify what is needed to integrate cleanly:

- Framework/runtime and file conventions (React/Vue, TS/JS, SFC conventions, naming)
- Styling integration rules (utility allowed? class sorting? linting? extraction patterns?)
- Token/theme system (CSS variables, token files, naming, dark mode/modes)
- Asset policy (public folder vs imports, icon pipeline, hashing, directory rules)
- Existing primitives/components (buttons, inputs, typography, layout wrappers), import path conventions

Only if the repo actually uses Tailwind (or Tailwind-compat tooling), also detect Tailwind version and conventions that affect class syntax/formatting.

Ask the user for a minimal clarification when the answer would materially change the implementation and cannot be established from the repo. Typical cases:

- more than one plausible target file or component boundary
- more than one plausible existing primitive/layout abstraction to reuse
- required behavior/state/responsive intent is not visible in design evidence
- asset/dependency policy needs a user decision

If a detail is minor and non-blocking, proceed with a clearly stated inference.

### 2) Fetch baseline design snapshot

Call `tempad-dev:get_code` with:

- `resolveTokens: false` by default
- pass `nodeId` only if user provided one; otherwise rely on the tool’s default behavior (current selection)
- `preferredLang`: choose what matches the repo (jsx or vue)

Use `resolveTokens: true` only when the user explicitly does not want design-token usage, or the task is a deliberately self-contained quick prototype rather than repo integration.

Important: `get_code.lang` is the language actually used by MCP after considering TemPad Dev plugin/config priority. A plugin may override `preferredLang`. Use returned `lang` plus `codegen` facts to interpret the IR correctly, then translate to the repo’s required output.

Record as design facts:

- `code`, `lang`
- `warnings`
- `assets` (if present)
- `tokens` (if present)
- `codegen` (e.g. scale, length units, rootRem, and other normalization settings)

### 3) Resolve warnings and uncertainty

Prefer reading the full requested top-level selection first so parent layout, composition, and containment are not lost.

If warnings indicate missing/partial/uncertain evidence, act immediately:

- `depth-cap`: keep the top-level result as the source of parent layout, then call `get_code` for each listed subtree root `nodeId` that is needed to complete the implementation.
  - If warning data indicates overflow (for example `cappedNodeOverflow=true`), treat evidence as incomplete and stop full implementation. Ask for narrower scope or user-prioritized subtrees.
- output budget exceeded error: pass a smaller subtree `nodeId` to narrow scope, then retry `get_code`.
  - If the full tree does not fit, `get_code` returns a valid parent shell for the current scope and explicitly marks the response as a shell.
  - Treat that shell as the composition source of truth. Fetch oversized child subtrees separately and fill them into the known parent wrapper instead of reassembling siblings from guesses.
  - Prefer the smallest parent container that still preserves the shared layout/composition shell for the child subtrees you need to assemble.
  - Do not treat plain string truncation as an acceptable substitute for a shell response.
  - Use `get_structure` to identify hierarchy and choose the right parent-shell retry target, but do not treat `get_structure` as a substitute for missing parent layout/style facts.
  - If you still cannot obtain a usable parent container shell via `get_code`, stop full implementation and ask the user to narrow scope or choose the highest-priority parent subtree.
  - Always report current consumption, limit, and overage from the error text when asking for scope changes (for example `current ~7800 tokens / 31240 bytes; limit ~6000 tokens / 24000 bytes; over by ~1800 tokens / 7240 bytes`).
- Layout, hierarchy, or overlap uncertainty: call `get_structure` to resolve contradictions.
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

Default goal: keep design-token usage intact for repo integration without inventing token mappings.

Rules:

1. Resolve token ambiguity with user requirements and project conventions first. If the repo has a documented token system or an established token-addition workflow, follow that before inventing a fallback.
2. Prefer existing repo tokens when you can justify equivalence using value equivalence (including references) plus semantic alignment in the repo.
   Token naming can be supporting evidence, but do not map solely because names look similar.
3. If the repo can safely carry design-token references for this change, preserve TemPad token references from `get_code` until they are mapped or added through the repo's normal token workflow.
4. Add new tokens only if the repo already has an established token workflow and this change is expected.
5. If the repo has no safe token landing zone, or mode selection/mapping still remains ambiguous after checking user requirements and project conventions, use explicit values and warn.

Hints may be used only for reasoning about mode selection when present; never output hint attributes.

### 6) Implement repo-native code

Translate TemPad Dev IR into the repo’s conventions:

- Utility-first repo (Tailwind/UnoCSS): keep utility classes; adjust ordering/formatting to match repo rules. If Tailwind is used, respect the repo’s Tailwind version/config before changing class syntax.
- Non-utility repo: translate utilities into the repo’s styling approach (CSS Modules/scoped CSS/Sass/CSS-in-JS) while preserving explicit values.

Constraints:

- Do not introduce new frameworks or styling systems.
- New runtime/build dependencies require user confirmation unless the user explicitly says no confirmation is needed.
- Implement base state only unless variants, interactions, or responsive behavior are provable from repo conventions or evidence.
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
- A missing user decision materially changes output and cannot be safely inferred
- Required assets cannot be retrieved/stored under repo policy

Otherwise, ship the best-evidence base implementation and end with:

- Evidence caveats: any `warnings`, omissions, or inferred repo conventions
- Assets: stored vs TemPad URLs, and any policy-driven constraints
- Tokens: mapped vs explicit values, and any ambiguity
- Dependencies: whether any were added (and whether user confirmation was obtained)
- If stopped: next required info (max 3 items)
