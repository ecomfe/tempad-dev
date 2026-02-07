# Testing architecture (Vitest 4) for pure functions

This document defines the testing architecture and pure-function coverage model.
For daily usage and contributor workflow, see `TESTING.md` at repo root.

## Goals

- Establish a deterministic, unit-test-first strategy for pure functions across the monorepo.
- Prevent regressions in code generation and style normalization logic, especially in `packages/extension`.
- Split extension tests into explicit node and browser projects.
- Use Playwright for browser runtime behavior (no jsdom test layer).

## Definition of pure function in this repository

A function is treated as pure in this strategy when all conditions below are true:

- Same input always produces the same output.
- No side effects that are externally observable.
- No dependency on mutable global runtime state.
- No dependency on IO, environment, system clock, random IDs, or process state.
- Does not mutate externally owned objects (unless explicitly documented as not pure).

Signals that a function is **not pure** in this repository:

- Uses browser globals (`document`, `window`, `MouseEvent.prototype`) or Figma runtime (`figma`, plugin node APIs).
- Uses environment/runtime state (`process.env`, `Date.now`, timers, random IDs).
- Uses filesystem, network, sockets, or process lifecycle APIs.

## Toolchain and version policy

- Test runner: `vitest@4.0.18` (latest stable when this plan is authored).
- Coverage: `@vitest/coverage-istanbul@4.0.18`.
- Vite baseline: `vite@8.0.0-beta.10` via root `pnpm.overrides` (workspace alignment).
- Package manager and execution: `pnpm` workspace scripts.
- Language: TypeScript, ESM.

## Monorepo test architecture

- Use one Vitest project per package, composed from a root workspace config.
- Add root config: `vitest.workspace.ts`.
- Add package configs:
  - `packages/extension/vitest.node.config.ts`
  - `packages/extension/vitest.browser.config.ts`
  - `packages/extension/vitest.config.ts` (aggregator)
  - `packages/plugins/vitest.config.ts`
  - `packages/mcp-server/vitest.config.ts`
  - `packages/shared/vitest.config.ts`
- Store tests under package-level test roots:
  - `packages/*/tests/**/*.test.ts` (node)
  - `packages/extension/tests/**/*.browser.test.ts` (browser)
- Environment policy:
  - Default `node` environment for pure-function tests.
  - Use Playwright browser project for DOM/browser runtime tests.
  - Do not use `jsdom`.
- Alias policy:
  - Ensure `packages/extension` Vitest config resolves `@/` aliases consistently with its TypeScript setup.

## Coverage policy (pure files = 100%)

Strict coverage thresholds apply to the curated pure-function file list:

- `lines: 100`
- `functions: 100`
- `branches: 100`
- `statements: 100`

Notes:

- This 100% gate is file-targeted (pure-function inventory), not blanket global coverage.
- Non-pure files are excluded from this strict gate and tracked separately.
- Root coverage must exclude artifact paths: `**/dist/**`, `**/.output/**`.

## Known failure modes and root causes

### 1) Parse errors with "failed to parse ... excluded from coverage"

Observed symptom:

- `pnpm test`/`pnpm test:coverage` logs parse failures that contain transformed SSR snippets such as `await __vite_ssr_import__...`, and files are reported as excluded.

Root cause:

- `vite@8.0.0-beta.10` can conflict with the current `vitest@4` + V8 remap path, which causes false parse failures in coverage remapping.

Fix:

- Use Istanbul coverage provider (`provider: 'istanbul'`) for workspace and package Vitest configs.

### 2) Coverage report includes `plugins/dist` artifacts

Observed symptom:

- Root coverage report shows compiled files under `packages/plugins/dist/*`.

Root cause:

- Root aggregate coverage captures files touched through workspace resolution/exports when no artifact exclusion is configured.

Fix:

- Keep root coverage exclusions for `**/dist/**` and `**/.output/**` in `vitest.config.ts`.

## Stability rules (do not regress)

- Do not switch coverage provider back to `v8` unless remap compatibility is re-verified under current Vite baseline.
- Keep root `vitest.config.ts` coverage `include` scoped to the pure inventory and `exclude` scoped to artifacts.
- Keep extension browser tests in Playwright projects (`*.browser.test.ts`) and node tests in node projects.
- Avoid ignore pragmas for branch coverage unless a runtime boundary is truly untestable.

## Pure-function inventory matrix

| Package    | File                                                    | Target Exports                                                                                                     | Purity Notes                                                     | Priority |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------- |
| extension  | `packages/extension/utils/number.ts`                    | `parseNumber`, `toDecimalPlace`                                                                                    | Fully deterministic numeric helpers                              | P0       |
| extension  | `packages/extension/utils/string.ts`                    | exported helpers                                                                                                   | Deterministic string transforms/escaping                         | P0       |
| extension  | `packages/extension/utils/object.ts`                    | `prune`                                                                                                            | Pure recursive pruning logic                                     | P0       |
| extension  | `packages/extension/utils/color.ts`                     | all exports                                                                                                        | Pure color conversion/normalization                              | P0       |
| extension  | `packages/extension/utils/css.ts`                       | exported helpers                                                                                                   | Core style normalization and serialization logic                 | P0       |
| extension  | `packages/extension/utils/tailwind.ts`                  | `cssToTailwind`, `cssToClassNames`, `nestedCssToClassNames`, `joinClassNames`                                      | Deterministic CSS→class mapping                                  | P0       |
| extension  | `packages/extension/utils/codegen.ts`                   | `codegen`, `workerUnitOptions`, `generateCodeBlocksForNode`                                                        | Unit-test via worker/runtime dependency mocks                    | P1       |
| extension  | `packages/extension/mcp/tools/code/styles/normalize.ts` | `layoutOnly`, `buildLayoutStyles`, `styleToClassNames`                                                             | Pure style map transforms                                        | P0       |
| extension  | `packages/extension/mcp/tools/code/tokens/transform.ts` | `applyPluginTransformToNames`                                                                                      | Deterministic token rename + bridge conflict handling            | P1       |
| extension  | `packages/extension/mcp/tools/code/tokens/process.ts`   | `processTokens`                                                                                                    | Deterministic token pipeline orchestration under mocked helpers  | P1       |
| plugins    | `packages/plugins/src/index.ts`                         | `raw`, `definePlugin`, `h`, `findChild`, `findChildren`, `findOne`, `findAll`, `queryAll`, `queryOne`              | Pure tree query/composition helpers                              | P0       |
| mcp-server | `packages/mcp-server/src/asset-utils.ts`                | all exports                                                                                                        | Deterministic mime/hash/filename utils                           | P0       |
| mcp-server | `packages/mcp-server/src/config.ts`                     | `getMcpServerConfig`                                                                                               | Deterministic env parsing with constant fallbacks                | P0       |
| mcp-server | `packages/mcp-server/src/request.ts`                    | `register`, `resolve`, `reject`, `cleanupForExtension`, `cleanupAll`                                               | Deterministic pending-call lifecycle under mocked timers/logging | P0       |
| mcp-server | `packages/mcp-server/src/tools.ts`                      | `createCodeToolResponse`, `createScreenshotToolResponse`, `coercePayloadToToolResponse`, `createToolErrorResponse` | Pure payload formatting/guard behavior                           | P1       |
| shared     | `packages/shared/src/mcp/protocol.ts`                   | `parseMessageToExtension`, `parseMessageFromExtension`                                                             | Deterministic JSON+schema parsing                                | P0       |
| shared     | `packages/shared/src/mcp/tools.ts`                      | schema exports (`AssetDescriptorSchema`, tool parameter/result schemas)                                            | Deterministic Zod contracts and regex constraints                | P0       |
| shared     | `packages/shared/src/figma/color.ts`                    | `formatHexAlpha`                                                                                                   | Pure color formatter                                             | P1       |
| shared     | `packages/shared/src/figma/gradient.ts`                 | `resolveGradientFromPaints`, `resolveSolidFromPaints`                                                              | Pure paint-to-CSS conversion and variable fallback formatting    | P1       |
| shared     | `packages/shared/src/figma/stroke.ts`                   | `resolveStrokeFromPaints`, `applyStrokeToCSS`                                                                      | Pure stroke resolution and CSS patching                          | P1       |
| shared     | `packages/shared/src/figma/style-resolver.ts`           | `resolveFillStyleForNode`, `resolveStrokeStyleForNode`, `resolveStylesFromNode`                                    | Deterministic style resolution under mocked Figma APIs           | P1       |

## Test scenarios by package

### extension: `utils/css.ts`

- `splitByTopLevelComma`:
  - nested function calls with internal commas.
  - quoted commas and escaped quotes.
  - empty segments with `keepEmpty=true`.
- `replaceVarFunctions` and `extractVarNames`:
  - single and nested `var(...)`.
  - with and without fallback.
  - malformed/unclosed expressions.
- `parseBackgroundShorthand`:
  - URL, position, repeat, size extraction.
  - no-image fallback behavior.
- `normalizeStyleValue` / `normalizeCssValue` / `normalizeStyleValues`:
  - zero-unit normalization.
  - px scale and rem conversion.
  - prop-level keep-px exceptions.
- color simplification:
  - `simplifyColorMixToRgba`.
  - `simplifyHexAlphaToRgba`.
- var naming helpers:
  - `canonicalizeVarName`, `normalizeCustomPropertyName`, `normalizeFigmaVarName`, `toFigmaVarExpr`.
- `expandShorthands`:
  - padding/margin/inset expansion.
  - border shorthand decomposition.
  - background/grid/flex expansion.
- `serializeCSS` regression focus:
  - gradient border uses pseudo-element ring style.
  - rounded border output preserves `border-radius` compatibility.
  - transparent center mask fields are present.
  - literal border width outputs negative literal inset (example: `-1px`).
  - variable/expression border width falls back to `calc(-1 * <value>)`.

### extension: `utils/tailwind.ts`

- `cssToTailwind`:
  - direct family mappings.
  - side/corner/axis/composite collapsing.
- `cssToClassNames`:
  - whitespace splitting and class extraction.
- `nestedCssToClassNames`:
  - nested selector variant mapping (`&::before`, pseudo states).
  - unknown property arbitrary fallback behavior.
  - de-duplication of generated classes.
- `joinClassNames`:
  - empty/falsey filtering and stable joining.

### extension: `mcp/tools/code/styles/normalize.ts`

- `layoutOnly` key filtering behavior.
- `buildLayoutStyles`:
  - normal nodes.
  - svg root layout stripping path.
- `styleToClassNames`:
  - normal path via `cssToClassNames`.
  - gradient-border nested path via `nestedCssToClassNames`.

### extension: `mcp/tools/code/tokens/transform.ts`

- no-plugin bridge behavior for known/missing source names.
- plugin transform rename behavior for custom properties.
- invalid/empty transform output fallback behavior.
- duplicate renamed target conflict behavior with warning path.
- mixed token/plain-name input behavior when transform batch is skipped.

### extension: `mcp/tools/code/tokens/process.ts`

- empty source index and no-detected-token early return paths.
- rename rewrite + truncation path and empty bridge short-circuit.
- used token resolution path (`buildUsedTokens`) and `resolveTokens` matcher activation.
- merged candidate id behavior when `usedCandidateIds` is non-empty.
- resolve node id collection from style maps and text segment maps.

### Extension browser runtime

- `utils/dom.ts`:
  - fragment transformation with real browser DOM parsing/mutation.
- `utils/keyboard.ts`:
  - `MouseEvent.prototype` lock/unlock behavior for `metaKey` and `altKey`.
- `codegen/requester.ts`:
  - worker requester cache behavior.
  - resolve/reject/missing-payload response handling.

### plugins: `src/index.ts`

- `raw` output shape.
- `definePlugin` identity behavior.
- `h` overload behavior:
  - only name.
  - name + children.
  - name + props.
  - name + props + children.
- tree search helpers:
  - direct child queries (`findChild`, `findChildren`).
  - deep queries (`findOne`, `findAll`).
  - chained query pipeline (`queryAll`, `queryOne`).
  - dedupe behavior in chained searches.
  - predicate and property query paths.

### mcp-server: `asset-utils.ts`

- mime normalization with parameters and casing.
- image extension derivation including override (`image/jpeg -> .jpg`).
- hash filename parsing:
  - hash only.
  - hash + extension.
  - invalid names.

### mcp-server: `config.ts`

- default value fallback behavior with no environment overrides.
- positive and non-negative integer parsing behavior.
- invalid and boundary input fallback behavior (`abc`, `-1`, `0` rules by field).

### mcp-server: `request.ts`

- request registration and id propagation.
- resolve/reject happy paths with pending call cleanup.
- timeout rejection code and message behavior under fake timers.
- disconnected-extension cleanup behavior (targeted reject).
- unknown request handling logs and shutdown cleanup behavior.

### mcp-server: `tools.ts`

- `createCodeToolResponse`:
  - valid payload summary formatting.
  - warning and asset summary branches.
- `createScreenshotToolResponse`:
  - description and resource link block behavior.
- `coercePayloadToToolResponse`:
  - already-formatted payload passthrough.
  - string and object coercion fallback.
- `createToolErrorResponse`:
  - error extraction fallback behavior.
  - troubleshooting text branches.

### shared: `mcp/protocol.ts`

- valid message parsing for both directions.
- invalid JSON returns `null`.
- schema mismatch returns `null`.

### shared: `mcp/tools.ts`

- asset descriptor validation (`resourceUri`, URL shape, and numeric bounds).
- get_code optional parameter acceptance and language enum rejection paths.
- token name canonical format (`--foo-bar`) and minimum list size behavior.
- structure depth positive integer enforcement.
- get_assets hash list and result payload schema validation.

### shared: `figma/color.ts`

- opaque output compaction (short hex where valid).
- alpha-inclusive output behavior.
- clamping and rounding edge cases.

### shared: `figma/gradient.ts`

- paint list guards and visible-paint selection.
- linear/radial/diamond/angular mapping and unsupported type fallback.
- linear angle resolution via handles and transform fallback paths.
- variable-bound stop/solid fallback behavior (found/missing/throwing variable lookup).
- alpha, percentage, and color fallback formatting edge cases.

### shared: `figma/stroke.ts`

- gradient-first stroke resolution then solid fallback behavior.
- border variable replacement for solid strokes.
- gradient border-image patch behavior and border-color conflict removal.
- svg stroke and outline update behavior for gradient/solid/no-op paths.

### shared: `figma/style-resolver.ts`

- fill/stroke style resolution order (`styleId` first, node paints fallback).
- style lookup failures and non-paint style fallback handling.
- `background: url(...) lightgray` normalization and solid fill backfill.
- fill-driven updates for `background`, `background-color`, `color`, and `fill`.
- stroke-driven updates for `border`, `border-color`, `border-image`, and `stroke`.

## Execution commands

Planned script contract:

- Root:
  - `pnpm test`
  - `pnpm test:run`
  - `pnpm test:coverage`
  - `pnpm test:ext:setup`
  - `pnpm test:ext:node`
  - `pnpm test:ext:browser`
- Per package:
  - `pnpm --filter @tempad-dev/extension test:run`
  - `pnpm --filter @tempad-dev/extension test:node`
  - `pnpm --filter @tempad-dev/extension test:browser`
  - `pnpm --filter @tempad-dev/extension test:setup`
  - `pnpm --filter @tempad-dev/plugins test:run`
  - `pnpm --filter @tempad-dev/mcp test:run`
  - `pnpm --filter @tempad-dev/shared test:run`

Recommended local verification order:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test:run`
4. `pnpm test:coverage`

## CI gate and rollout plan

Phase 1:

- Implement tests for `extension` and `plugins` pure targets.
- Include all current codegen/style regression assertions.

Phase 2:

- Implement tests for `mcp-server` and `shared` pure targets.
- Complete protocol and payload formatter coverage.

Phase 3:

- Enable strict pure-file 100% coverage gate in CI.
- Keep non-pure paths out of strict gate until separately designed.

Phase 4:

- Add a periodic audit checklist:
  - identify newly pure functions.
  - move them into the strict inventory list.
  - enforce test addition in the same PR.

## Exclusions and non-pure areas

Initially excluded from strict pure-function gate:

- Figma host-runtime modules requiring `figma` APIs.
- Functions with IO/time/randomness/process coupling.
- Stateful request/asset/store lifecycle modules requiring integration-style tests.

These areas are not ignored permanently; they require separate testing strategy (integration and mocked-runtime tests).

## Maintenance rules

- Every new pure utility function must include unit tests in the same PR.
- Behavior changes in existing pure functions require regression tests.
- If a function transitions from non-pure to pure, update this inventory and add tests immediately.
- Keep test names behavior-oriented and deterministic.

## Document maintenance

- Keep this document aligned with `vitest.config.ts`, `vitest.workspace.ts`, and package `vitest.config.ts` files.
- Update the pure-function inventory matrix in the same PR when inventory or thresholds change.
- Keep contributor-facing runbook and command guidance in root `TESTING.md`.
