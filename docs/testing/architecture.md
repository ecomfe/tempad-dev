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

| Package    | File                                                            | Target Exports                                                                                                           | Purity Notes                                                     | Priority |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------- |
| extension  | `packages/extension/utils/number.ts`                            | `parseNumber`, `toDecimalPlace`                                                                                          | Fully deterministic numeric helpers                              | P0       |
| extension  | `packages/extension/utils/string.ts`                            | exported helpers                                                                                                         | Deterministic string transforms/escaping                         | P0       |
| extension  | `packages/extension/utils/object.ts`                            | `prune`                                                                                                                  | Pure recursive pruning logic                                     | P0       |
| extension  | `packages/extension/utils/color.ts`                             | all exports                                                                                                              | Pure color conversion/normalization                              | P0       |
| extension  | `packages/extension/utils/module.ts`                            | `evaluate`                                                                                                               | Deterministic object-URL module evaluation lifecycle             | P1       |
| extension  | `packages/extension/utils/log.ts`                               | `logger`                                                                                                                 | Deterministic prefixing and dev-gated logging behavior           | P1       |
| extension  | `packages/extension/worker/safe.ts`                             | default `Set<string>`                                                                                                    | Stable allowlist contract for worker lockdown                    | P1       |
| extension  | `packages/extension/worker/lockdown.ts`                         | `lockdownWorker`                                                                                                         | Deterministic global-pruning and worker global sealing flow      | P1       |
| extension  | `packages/extension/mcp/config.ts`                              | `MCP_CLIENTS_BY_ID`, `MCP_CLIENTS`, `MCP_SERVER`                                                                         | Deterministic MCP client deep link and command/config generation | P1       |
| extension  | `packages/extension/rewrite/config.ts`                          | `GROUPS`                                                                                                                 | Stable rewrite marker and replacement contract payload           | P1       |
| extension  | `packages/extension/rewrite/figma.ts`                           | module side effect (`rewriteCurrentScript(GROUPS)`)                                                                      | Stable rewrite bootstrap invocation contract                     | P1       |
| extension  | `packages/extension/rewrite/runtime.ts`                         | `rewriteCurrentScript`                                                                                                   | Deterministic rewrite/eval/fallback orchestration                | P1       |
| extension  | `packages/extension/utils/css.ts`                               | exported helpers                                                                                                         | Core style normalization and serialization logic                 | P0       |
| extension  | `packages/extension/utils/tailwind.ts`                          | `cssToTailwind`, `cssToClassNames`, `nestedCssToClassNames`, `joinClassNames`                                            | Deterministic CSS→class mapping                                  | P0       |
| extension  | `packages/extension/utils/codegen.ts`                           | `codegen`, `workerUnitOptions`, `generateCodeBlocksForNode`                                                              | Unit-test via worker/runtime dependency mocks                    | P1       |
| extension  | `packages/extension/rewrite/shared.ts`                          | `isRules`, `getRewriteTargetRegex`, `loadRules`, `groupMatches`, `applyGroups`                                           | Deterministic rewrite-rule validation and replacement pipeline   | P1       |
| extension  | `packages/extension/mcp/errors.ts`                              | `createCodedError`, `coerceToolErrorPayload`                                                                             | Deterministic error normalization and code tagging               | P0       |
| extension  | `packages/extension/mcp/transport.ts`                           | `setMcpSocket`, `getMcpSocket`, `requireMcpSocket`                                                                       | Deterministic transport state guard behavior                     | P0       |
| extension  | `packages/extension/mcp/tools/config.ts`                        | `currentCodegenConfig`                                                                                                   | Deterministic codegen config projection from UI state            | P0       |
| extension  | `packages/extension/mcp/tools/screenshot.ts`                    | `handleGetScreenshot`                                                                                                    | Deterministic screenshot downscale and payload guard flow        | P1       |
| extension  | `packages/extension/mcp/tools/structure.ts`                     | `handleGetStructure`                                                                                                     | Deterministic structure payload shaping and size guarding        | P1       |
| extension  | `packages/extension/mcp/tools/code/layout-parent.ts`            | `getLayoutParent`                                                                                                        | Deterministic ancestor lookup with type filtering                | P0       |
| extension  | `packages/extension/mcp/tools/code/messages.ts`                 | `buildTokenSummary`, `buildCandidateSummary`                                                                             | Deterministic summary message formatting                         | P0       |
| extension  | `packages/extension/mcp/tools/code/render/props.ts`             | `classProps`, `filterGridProps`, `classProp`, `mergeClass`                                                               | Deterministic class and data-hint prop shaping                   | P1       |
| extension  | `packages/extension/mcp/tools/code/variables.ts`                | `collectRefs`, `transform`                                                                                               | Deterministic variable-reference collection and rewrite mapping  | P1       |
| extension  | `packages/extension/mcp/tools/code/sanitize/negative-gap.ts`    | `patchNegativeGapStyles`                                                                                                 | Deterministic negative-gap normalization and compensation logic  | P1       |
| extension  | `packages/extension/mcp/tools/code/sanitize/relative-parent.ts` | `ensureRelativeForAbsoluteChildren`                                                                                      | Deterministic parent-position enforcement for absolute children  | P1       |
| extension  | `packages/extension/mcp/tools/code/sanitize/stacking.ts`        | `applyAbsoluteStackingOrder`                                                                                             | Deterministic stacking-order correction and parent isolation     | P1       |
| extension  | `packages/extension/mcp/tools/code/sanitize/index.ts`           | `sanitizeStyles`                                                                                                         | Deterministic sanitize patch orchestration order                 | P1       |
| extension  | `packages/extension/mcp/tools/code/styles/layout.ts`            | `mergeInferredAutoLayout`, `inferResizingStyles`                                                                         | Deterministic inferred auto-layout and resizing style adaptation | P1       |
| extension  | `packages/extension/mcp/tools/code/styles/overflow.ts`          | `applyOverflowStyles`                                                                                                    | Deterministic overflow-direction and clipping adaptation         | P1       |
| extension  | `packages/extension/mcp/tools/code/styles/index.ts`             | re-export surface                                                                                                        | Stable style pipeline export contract                            | P2       |
| extension  | `packages/extension/mcp/tools/code/assets/plan.ts`              | `planAssets`                                                                                                             | Deterministic vector asset grouping and descendant pruning logic | P1       |
| extension  | `packages/extension/mcp/tools/code/assets/vector.ts`            | `exportSvgEntry`, `transformSvgAttributes`, `extractSvgAttributes`                                                       | Deterministic SVG export shaping and attribute normalization     | P1       |
| extension  | `packages/extension/mcp/tools/code/assets/export.ts`            | `exportVectorAssets`                                                                                                     | Deterministic vector export selection and snapshot guards        | P1       |
| extension  | `packages/extension/mcp/tools/code/assets/image.ts`             | `hasImageFills`, `replaceImageUrlsWithAssets`                                                                            | Deterministic image-fill asset replacement and fallback behavior | P1       |
| extension  | `packages/extension/mcp/tools/code/assets/index.ts`             | re-export surface                                                                                                        | Stable asset helper export contract                              | P2       |
| extension  | `packages/extension/mcp/tools/code/styles/normalize.ts`         | `layoutOnly`, `buildLayoutStyles`, `styleToClassNames`                                                                   | Pure style map transforms                                        | P0       |
| extension  | `packages/extension/mcp/tools/code/styles/prepare.ts`           | `prepareStyles`                                                                                                          | Deterministic style preparation orchestration                    | P1       |
| extension  | `packages/extension/mcp/tools/code/tokens/extract.ts`           | `buildTokenRegex`, `extractTokenNames`, `createTokenMatcher`                                                             | Deterministic token name extraction and boundary matching        | P0       |
| extension  | `packages/extension/mcp/tools/code/tokens/index.ts`             | re-export surface                                                                                                        | Stable token pipeline export contract                            | P2       |
| extension  | `packages/extension/mcp/tools/code/tokens/cache.ts`             | `getVariableByIdCached`                                                                                                  | Deterministic cache lookup and write-through behavior            | P0       |
| extension  | `packages/extension/mcp/tools/code/tokens/resolve.ts`           | `createStyleVarResolver`, `resolveStyleMap`                                                                              | Deterministic style token substitution pipeline                  | P1       |
| extension  | `packages/extension/mcp/tools/code/tokens/transform.ts`         | `applyPluginTransformToNames`                                                                                            | Deterministic token rename + bridge conflict handling            | P1       |
| extension  | `packages/extension/mcp/tools/code/tokens/process.ts`           | `processTokens`                                                                                                          | Deterministic token pipeline orchestration under mocked helpers  | P1       |
| extension  | `packages/extension/mcp/tools/code/tokens/rewrite.ts`           | `rewriteTokenNamesInCode`, `filterBridge`                                                                                | Deterministic token rewrite and bridge filtering                 | P0       |
| extension  | `packages/extension/mcp/tools/code/tokens/source-index.ts`      | `buildSourceNameIndex`                                                                                                   | Deterministic candidate name indexing                            | P0       |
| extension  | `packages/extension/mcp/tools/code/tokens/used.ts`              | `buildUsedTokens`                                                                                                        | Deterministic used-token set materialization and resolver wiring | P1       |
| extension  | `packages/extension/mcp/tools/code/text/types.ts`               | `MARK_PRIORITY`, `MARK_WEIGHTS`, `HOIST_ALLOWLIST`, `TYPO_FIELDS`, `REQUESTED_SEGMENT_FIELDS`, `NEWLINE_RE`              | Stable text-segment constants and field contracts                | P2       |
| extension  | `packages/extension/mcp/tools/code/text/index.ts`               | re-export surface                                                                                                        | Stable text render entry export contract                         | P2       |
| extension  | `packages/extension/mcp/tools/token/candidates.ts`              | `collectCandidateVariableIds`                                                                                            | Deterministic candidate-variable traversal and rewrite mapping   | P1       |
| extension  | `packages/extension/mcp/tools/token/indexer.ts`                 | `getVariableRawName`, `canonicalizeNames`, `canonicalizeName`, `getTokenIndex`                                           | Deterministic token canonicalization, batching, and cache/index  | P1       |
| extension  | `packages/extension/mcp/tools/token/mapping.ts`                 | `buildVariableMappings`, `normalizeStyleVars`, `applyPluginTransforms`                                                   | Deterministic style token rewrite and plugin transform wiring    | P1       |
| extension  | `packages/extension/mcp/tools/token/index.ts`                   | re-export surface                                                                                                        | Stable token API export contract                                 | P2       |
| plugins    | `packages/plugins/src/index.ts`                                 | `raw`, `definePlugin`, `h`, `findChild`, `findChildren`, `findOne`, `findAll`, `queryAll`, `queryOne`                    | Pure tree query/composition helpers                              | P0       |
| mcp-server | `packages/mcp-server/src/asset-utils.ts`                        | all exports                                                                                                              | Deterministic mime/hash/filename utils                           | P0       |
| mcp-server | `packages/mcp-server/src/config.ts`                             | `getMcpServerConfig`                                                                                                     | Deterministic env parsing with constant fallbacks                | P0       |
| mcp-server | `packages/mcp-server/src/request.ts`                            | `register`, `resolve`, `reject`, `cleanupForExtension`, `cleanupAll`                                                     | Deterministic pending-call lifecycle under mocked timers/logging | P0       |
| mcp-server | `packages/mcp-server/src/asset-store.ts`                        | `createAssetStore`                                                                                                       | Deterministic asset index persistence/reconcile logic            | P1       |
| mcp-server | `packages/mcp-server/src/asset-http-server.ts`                  | `createAssetHttpServer`                                                                                                  | Deterministic HTTP routing and asset upload/download lifecycle   | P1       |
| mcp-server | `packages/mcp-server/src/tools.ts`                              | `createCodeToolResponse`, `createScreenshotToolResponse`, `coercePayloadToToolResponse`, `createToolErrorResponse`       | Pure payload formatting/guard behavior                           | P1       |
| mcp-server | `packages/mcp-server/src/shared.ts`                             | `normalizePackageVersion`, `resolveRuntimeDir`, `resolveLogDir`, `resolveAssetDir`, `resolveLogLevel`, `resolveSockPath` | Deterministic path and logger option resolution helpers          | P1       |
| shared     | `packages/shared/src/index.ts`                                  | re-export surface                                                                                                        | Stable root contract re-export surface                           | P2       |
| shared     | `packages/shared/src/mcp/constants.ts`                          | exported constants and patterns                                                                                          | Deterministic protocol limits and URI/hash patterns              | P0       |
| shared     | `packages/shared/src/mcp/errors.ts`                             | `TEMPAD_MCP_ERROR_CODES`                                                                                                 | Stable error contract constants                                  | P0       |
| shared     | `packages/shared/src/mcp/index.ts`                              | re-export surface                                                                                                        | Stable MCP contract re-export surface                            | P2       |
| shared     | `packages/shared/src/mcp/protocol.ts`                           | `parseMessageToExtension`, `parseMessageFromExtension`                                                                   | Deterministic JSON+schema parsing                                | P0       |
| shared     | `packages/shared/src/mcp/tools.ts`                              | schema exports (`AssetDescriptorSchema`, tool parameter/result schemas)                                                  | Deterministic Zod contracts and regex constraints                | P0       |
| shared     | `packages/shared/src/figma/index.ts`                            | re-export surface                                                                                                        | Stable Figma utility re-export surface                           | P2       |
| shared     | `packages/shared/src/figma/color.ts`                            | `formatHexAlpha`                                                                                                         | Pure color formatter                                             | P1       |
| shared     | `packages/shared/src/figma/gradient.ts`                         | `resolveGradientFromPaints`, `resolveSolidFromPaints`                                                                    | Pure paint-to-CSS conversion and variable fallback formatting    | P1       |
| shared     | `packages/shared/src/figma/stroke.ts`                           | `resolveStrokeFromPaints`, `applyStrokeToCSS`                                                                            | Pure stroke resolution and CSS patching                          | P1       |
| shared     | `packages/shared/src/figma/style-resolver.ts`                   | `resolveFillStyleForNode`, `resolveStrokeStyleForNode`, `resolveStylesFromNode`                                          | Deterministic style resolution under mocked Figma APIs           | P1       |

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

### extension: `utils/module.ts`

- object URL creation and module evaluation behavior.
- URL revoke behavior after dynamic module import.
- payload pass-through behavior from input source string into blob content.

### extension: `utils/log.ts`

- prefix insertion behavior for log/warn/error calls (including empty and pre-prefixed input).
- debug suppression behavior when `__DEV__` is false.
- debug emission behavior via `console.debug` in development mode.
- fallback behavior to `console.log` when `console.debug` is unavailable.

### extension: `worker/safe.ts`

- allowlist contract stability for required intrinsics (`Object`, `Promise`, `Reflect`, `console`, `onmessage`).
- exclusion behavior for unrelated host globals.

### extension: `worker/lockdown.ts`

- non-safe global pruning behavior via reflective unset operations.
- worker global hardening behavior for `name`, `onmessage`, `onmessageerror`, and `postMessage`.

### extension: `mcp/config.ts`

- deep link payload generation for VS Code/Cursor/TRAE clients.
- command/config fallback payload generation for Claude/Codex/Windsurf.
- deterministic client ordering and stable MCP server command metadata.
- base64 capability guard behavior when runtime does not provide `btoa`.

### extension: `rewrite/config.ts`

- marker array contract stability for readonly/global-close/dev-mode patch groups.
- regex replacement behavior for captured variable names in dev-mode unlock pattern.
- string and regex replacement output parity with expected runtime rewritten snippets.

### extension: `rewrite/figma.ts`

- import-time rewrite bootstrap behavior using `GROUPS`.
- invocation contract between rewrite bootstrap entry and runtime rewriter.

### extension: `rewrite/runtime.ts`

- current-script guard behavior when script element/source is missing.
- rewrite/eval path behavior for fetched script content and Figma delete patching.
- fallback script replacement behavior when fetch/rewrite/eval fails.

### extension: `rewrite/shared.ts`

- rules payload validation and invalid-shape rejection.
- rewrite target regex extraction and invalid-regex fallback behavior.
- rules loading success/failure paths (`fetch` non-ok, invalid payload, thrown errors).
- grouped replacement execution for marker matching, changed/no-op stats, and logging toggles.

### extension: `mcp/tools/code/styles/normalize.ts`

- `layoutOnly` key filtering behavior.
- `buildLayoutStyles`:
  - normal nodes.
  - svg root layout stripping path.
- `styleToClassNames`:
  - normal path via `cssToClassNames`.
  - gradient-border nested path via `nestedCssToClassNames`.

### extension: `mcp/tools/code/styles/prepare.ts`

- normalization orchestration with `normalizeStyleVars`.
- sanitize + layout stage wiring.
- trace stamp behavior for present and missing trace clocks.

### extension: `mcp/tools/code/tokens/transform.ts`

- no-plugin bridge behavior for known/missing source names.
- plugin transform rename behavior for custom properties.
- invalid/empty transform output fallback behavior.
- duplicate renamed target conflict behavior with warning path.
- mixed token/plain-name input behavior when transform batch is skipped.

### extension: `mcp/tools/code/tokens/extract.ts`

- regex builder null/empty input behavior.
- boundary-safe matching and special-character escaping.
- plain `--token` extraction fallback path.
- configured-name extraction and matcher fallback behavior.

### extension: `mcp/tools/code/tokens/index.ts`

- re-export contract behavior for token pipeline helpers.

### extension: `mcp/tools/code/tokens/process.ts`

- empty source index and no-detected-token early return paths.
- rename rewrite + truncation path and empty bridge short-circuit.
- used token resolution path (`buildUsedTokens`) and `resolveTokens` matcher activation.
- merged candidate id behavior when `usedCandidateIds` is non-empty.
- resolve node id collection from style maps and text segment maps.

### extension: `mcp/tools/code/tokens/rewrite.ts`

- rewrite skip behavior for empty/invalid rewrite maps.
- boundary-safe token rewrite replacement.
- bridge filtering by used-name set and empty-id omission.

### extension: `mcp/tools/code/tokens/source-index.ts`

- index population from `codeSyntax.WEB` canonical names.
- fallback normalization path for non-`var(...)` syntax.
- first-write-wins behavior for duplicate canonical names.
- figma-name fallback indexing and missing-variable filtering.

### extension: `mcp/tools/code/tokens/cache.ts`

- direct passthrough behavior when caller does not supply cache.
- cache-hit behavior for value and explicit `null`.
- cache-miss write-through behavior for found and missing variables.

### extension: `mcp/tools/code/tokens/resolve.ts`

- resolver short-circuit behavior for empty styles and filtered node ids.
- CSS variable replacement flow with token matcher and canonical-name lookup.
- variable alias resolution (target missing and cyclic guard).
- mode selection behavior (node overrides, active/default/fallback modes).
- literal serialization behavior for color/float/string/boolean/object tokens.
- style map resolution behavior across node-present and node-missing entries.

### extension: `mcp/tools/code/tokens/used.ts`

- empty bridge early return behavior.
- variable-id deduplication via bridge values.
- canonicalization fallback behavior when plugin transform result is missing.
- resolver payload shaping (`candidateIds`, `candidateNameById`, mode/value flags).
- missing variable filtering behavior with stable candidate metadata.

### extension: `mcp/tools/token/candidates.ts`

- recursive variable-id collection across node/style paint sources.
- visibility-based pruning for hidden nodes and hidden paint descriptors.
- rewrite-map deduplication across code syntax and canonical CSS variable names.
- fallback behavior for sparse payloads (nulls, non-arrays, missing names).

### extension: `mcp/tools/token/indexer.ts`

- variable raw-name extraction from `codeSyntax.WEB` and fallback to Figma variable names.
- canonicalization batching behavior (300-size chunks), including fallback normalization for non-var outputs.
- token index build behavior with canonical collision buckets and cache-key reuse/invalidation.

### extension: `mcp/tools/token/mapping.ts`

- mapping collector delegation behavior through `buildVariableMappings`.
- style map rewrite behavior for exact rewrites, code syntax aliases, and boundary-safe raw-name replacement.
- plugin transform behavior for no-op guards and fallback to original `var(...)` on empty transform outputs.

### extension: `mcp/tools/token/index.ts`

- re-export contract behavior for candidate collection and token definition resolvers.

### extension: `mcp/tools/code/text/types.ts`

- mark priority/weight consistency behavior.
- hoist allowlist and code-font keyword contract stability.
- typography/requested segment field stability and newline regex behavior.

### extension: `mcp/tools/code/text/index.ts`

- re-export contract behavior for text segment rendering entrypoint.

### extension: `mcp/errors.ts`

- coded error creation and code attachment behavior.
- error payload coercion across `Error`, string, object, and unknown inputs.
- recognized vs unrecognized MCP error code handling.

### extension: `mcp/transport.ts`

- transport socket set/get lifecycle behavior.
- guard failure behavior for missing and non-open sockets.
- open-socket happy path for `requireMcpSocket`.

### extension: `mcp/tools/config.ts`

- codegen setting projection behavior for `cssUnit`, `rootFontSize`, and `scale`.
- runtime update reflection behavior across repeated reads.

### extension: `mcp/tools/screenshot.ts`

- first-pass screenshot success path at scale `1`.
- downscale retry behavior (`1` -> `0.75` -> `0.5` -> `0.25`) until payload fits.
- terminal failure behavior when all scale attempts exceed max payload bytes.

### extension: `mcp/tools/structure.ts`

- depth-limit coercion behavior (`0` treated as unset).
- semantic tree outline payload shaping behavior.
- payload-size guard branch when serialized output exceeds protocol limits.

### extension: `mcp/tools/code/layout-parent.ts`

- ancestor lookup skips non-layout containers (`GROUP`, `BOOLEAN_OPERATION`).
- missing-parent and root-node fallback behavior.

### extension: `mcp/tools/code/messages.ts`

- summary message formatting for token rewrite and candidate collection phases.
- zero-count and non-zero branch wording behavior.

### extension: `mcp/tools/code/render/props.ts`

- class-prop generation for empty and non-empty class lists.
- auto-layout hint gating for fallback/non-fallback paths.
- grid-only style key stripping and class-name merge/classProp helpers.

### extension: `mcp/tools/code/variables.ts`

- reference collection from normalized CSS values (comments and SCSS vars).
- transform pipeline rewrite behavior with canonical-name extraction.
- fallback behavior when transform results are missing or target style disappears.

### extension: `mcp/tools/code/sanitize/negative-gap.ts`

- negative row/column gap normalization to explicit `row-gap`/`column-gap`.
- parent/child compensation behavior for multi-child containers.
- sparse tree and non-finite value fallback behavior.

### extension: `mcp/tools/code/sanitize/relative-parent.ts`

- absolute-child detection and nearest layout parent promotion.
- missing-node and root-absolute fallback behavior without mutation.
- existing parent `position` preservation.

### extension: `mcp/tools/code/sanitize/stacking.ts`

- absolute child demotion when later in-flow siblings exist.
- parent isolation insertion and existing-isolation preservation.
- handling for missing roots and child lists.

### extension: `mcp/tools/code/sanitize/index.ts`

- sanitize patch execution order and argument forwarding behavior.

### extension: `mcp/tools/code/styles/layout.ts`

- inferred auto-layout merge behavior across explicit, inferred-only, and `NONE` modes.
- existing flex/gap/padding short-circuit behavior.
- resizing inference behavior for stretch/fill/hug under different parent layout modes.

### extension: `mcp/tools/code/styles/overflow.ts`

- explicit overflow-direction mapping for horizontal/vertical/both modes.
- clips-content fallback behavior when child bounds exceed parent bounds.
- bounds resolution fallback behavior for missing/non-finite/transform-only geometry.

### extension: `mcp/tools/code/styles/index.ts`

- re-export contract behavior for normalize and prepare style pipeline helpers.

### extension: `mcp/tools/code/assets/plan.ts`

- vector-group detection when all descendant leaves are vector assets.
- mixed/malformed child graph behavior (missing child metadata).
- defensive skip traversal behavior when descendant lookups become unavailable.

### extension: `mcp/tools/code/assets/vector.ts`

- SVG export behavior for upload success, upload fallback (inline raw), and export failure fallback.
- width/height attribute normalization behavior under configured CSS units.
- root `<svg>` attribute extraction behavior and no-match fallback.

### extension: `mcp/tools/code/assets/export.ts`

- vector-root export behavior for snapshot missing/filtered paths.
- zero-size snapshot guard behavior with and without render bounds.
- null export-entry filtering behavior for final SVG map.

### extension: `mcp/tools/code/assets/image.ts`

- image-fill detection behavior for visible and hidden paints.
- URL replacement behavior for uploaded image assets and mime-type detection.
- fallback behavior for missing image bytes, failed node exports, and placeholder URL generation.

### extension: `mcp/tools/code/assets/index.ts`

- re-export contract behavior for asset planning and export helpers.

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

### mcp-server: `asset-store.ts`

- index loading behavior for missing/empty/invalid index payloads.
- upsert/touch/remove/flush persistence behavior and timer batching.
- stale record pruning and temp-file cleanup during reconcile.
- orphan file recovery and error handling when stat/scan/delete operations fail.

### mcp-server: `asset-http-server.ts`

- HTTP routing guard behavior for methods, paths, and hash parsing.
- download flow behavior across hit/miss, stat failures, and stream error handling.
- upload flow behavior across existing assets, pipeline failures, hash checks, and temp-file lifecycle.

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

### mcp-server: `shared.ts`

- package-version normalization fallback behavior.
- runtime/log/asset dir resolution with env override and tmpdir fallback.
- log-level selection for debug vs info.
- sock path resolution for win32 pipe and unix socket paths.
- startup filesystem side effects (`ensureDir` + `ensureFile`) and logger transport wiring.

### shared: `mcp/protocol.ts`

- valid message parsing for both directions.
- invalid JSON returns `null`.
- schema mismatch returns `null`.

### shared: `index.ts`

- re-export contract behavior for MCP and Figma top-level surfaces.

### shared: `mcp/index.ts`

- re-export contract behavior for constants, errors, protocol parsers, and tool schemas.

### shared: `mcp/constants.ts`

- stable protocol numeric limits and default timeout/ttl values.
- asset URI prefix/template and hash pattern behavior.

### shared: `mcp/errors.ts`

- stable mapping of contract error code literals.

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

### shared: `figma/index.ts`

- re-export contract behavior for color, gradient, stroke, and style resolver helpers.

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
