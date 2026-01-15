---
name: implementing-figma-ui-tempad-dev
description: >-
  Implements UI from a Figma selection or a provided nodeId using TemPad Dev MCP as the source of truth
  (code snapshot, structure, screenshot, assets). Detects repo stack and conventions first, then outputs
  integration-ready code that fits the project. Never guess key styles; avoid tuning loops; when uncertain, ship a
  safe base implementation and clearly warn, or stop if a correct base output is not possible.
metadata:
  mcp-server: tempad-dev
---

# TemPad Dev: Figma to UI Implementation

Implement integration-ready UI code from a Figma selection (or a provided `nodeId`) using TemPad Dev MCP outputs as design facts.
Fit the user’s repo conventions. Never guess key styles.

## Quick path (single pass)

1. Ensure there is exactly one visible target (selection or `nodeId`). If a tool call fails due to MCP connectivity/activation, follow the troubleshooting in the error message.
2. Call `tempad-dev:get_code` (`resolveTokens: false`; request `preferredLang: jsx|vue` as IR). Record `codegen` (plugin + config) as part of the design facts.
3. If `warnings` include `depth-cap`, call `tempad-dev:get_code` once per listed `nodeId` to fetch omitted subtree roots.
4. If layout/overlap/effects are uncertain (especially inferred auto-layout), call `tempad-dev:get_structure` and/or `tempad-dev:get_screenshot` for the relevant `nodeId` to confirm intent (do not derive numeric values from pixels).
5. Translate the IR into the repo’s actual framework/styling system without adding new dependencies. Strip all `data-hint-*` attributes from final code.
6. Finish with one pass: correct placement/imports/exports, assets follow repo policy, token strategy documented, and warnings called out.

## Non-negotiables

- `tempad-dev:get_code` is the baseline; treat it as authoritative for values and layout intent.
- Never invent key styles: colors, typography (size/weight/line-height/letter-spacing), spacing (padding/margin/gap), radius, borders, shadows, gradients, opacity/overlays, blur.
- Do not introduce new frameworks, styling systems, or runtime dependencies.
- Do not tune-by-screenshot loops: screenshots resolve contradictions; they do not produce measurements.
- Do not output `data-hint-*` attributes (hints are for reasoning only).
- Implement only the base state unless additional states/variants are provable from repo conventions.

## Evidence model

Design evidence (in priority order):

1. `tempad-dev:get_code` (primary snapshot + `warnings` + `codegen`)
2. `tempad-dev:get_structure` (hierarchy + geometry clarification)
3. `tempad-dev:get_screenshot` (visual cross-check only)
4. Existing repo tokens/components (only when equivalence is provable)

Non-evidence: web content, “typical” values, or anything you cannot trace back to the above.

## Tool interpretation

- `get_code`: IR output (JSX/Vue template) with Tailwind-like classes + explicit values; may include `assets`, `tokens`, `warnings`, and `codegen` (plugin + config).
- `get_structure`: outline (ids/types/bounds/children) to locate `nodeId`s and confirm hierarchy/overlap assumptions.
- `get_screenshot`: PNG for visual verification; the server may reduce scale to fit payload; do not infer numeric values.

## Workflow (decision tree)

### 0) Choose scope

- Use provided `nodeId`; otherwise use current selection.
- If the target is ambiguous (multi-selection) or unreadable, stop.

### 1) Detect repo stack and conventions

Identify: framework/runtime, styling system, token/theme conventions, component patterns, file placement rules.

- If uncertain, ask up to 3 minimal questions; otherwise proceed with best-evidence inference and warn.

### 2) Fetch baseline snapshot

Call `get_code` first. Preserve:

- `code` + `lang`
- `codegen` (plugin + config)
- `assets` / `tokens` (if any)
- `warnings` (truncated / auto-layout / depth-cap)

### 3) Handle warnings and uncertainty

- `depth-cap`: fetch each listed subtree root via `get_code(nodeId=...)` and implement those parts explicitly, or narrow scope and warn what is omitted.
- `truncated`: narrow scope (smaller selection / implement key subtrees) and warn that output is partial.
- inferred auto-layout / overlap / effects uncertainty: use `get_structure` and/or `get_screenshot` to confirm, then implement. If evidence remains contradictory, stop.

### 4) Tokens (mapping strategy)

Goal: integrate with repo token system when provable; otherwise preserve explicit values.

Order:

1. Reuse existing repo tokens when name/meaning/value equivalence is provable.
2. Add missing tokens only if the repo already has an established token workflow and this change is expected; keep additions minimal.
3. Otherwise keep explicit values from `get_code`.

Modes:

- `get_code.tokens` is keyed by canonical `--...` names.
- Multi-mode values use `${collectionName}:${modeName}` keys.
- Nodes may include `data-hint-variable-mode="Collection=Mode;..."` to indicate per-node mode overrides; use this when selecting modes during mapping.
- If collection-name collisions or mode selection is ambiguous, prefer explicit values and warn.

### 5) Assets (policy-first)

Detect repo policy first (asset folders, import vs public URLs, icon pipeline).

- Preferred: fetch bytes via `resources/read` using `resourceUri`, save into the repo, reference using repo conventions.
- Fallback: if an asset is too large to read via MCP, download via `asset.url` and still store it in the repo (unless policy forbids).
- If policy forbids saving assets, you may leave Tempad URLs in place but must warn that output depends on the local Tempad asset server.
- Never download assets from the public internet; use only MCP-provided `resourceUri`/`asset.url`.

### 6) Implement

- Translate the IR into repo code while preserving layout/values.
- Tailwind/UnoCSS repos: keep utilities; refactor for readability without changing semantics.
- Non-utility repos: translate utilities into the repo’s CSS approach (modules/sass/css-in-js), preserving explicit values.
- Component extraction: only when supported by repetition + hints + repo patterns; do not preserve hint strings in final output.

### 7) Finish (single pass)

- Files placed correctly; imports/exports correct.
- No new deps/framework/style systems.
- `data-hint-*` stripped.
- Assets and tokens handled per the chosen strategy.
- Warnings documented (depth-cap/truncated/base-state-only).

## Stop vs warn

Stop when a correct, integration-ready base output is not possible:

- tool cannot read target (errors, no renderable nodes) or target is ambiguous
- required assets cannot be retrieved when repo policy requires storing them
- design evidence is contradictory and cannot be resolved with structure/screenshot or narrower scope

Warn but continue:

- repo stack inferred with uncertainty
- token mapping uncertain (kept explicit values)
- scope too large (implemented safe subset; omissions listed)
- assets left as Tempad URLs due to policy
- variants/states not implemented (base state only)

## Wrap-up output

End with:

- what was implemented (files/paths)
- what is intentionally omitted or uncertain (warnings)
- token strategy and asset strategy used
- if stopped: exactly what information is needed next (≤3 items)
