# Testing guide

This file is the contributor runbook for testing in this repository.
For architecture details (runtime split, strict coverage model, and worker sandbox checks), see `docs/testing/architecture.md`.

## Scope

- Monorepo package manager: `pnpm`
- Test runner: `vitest`
- Browser test runner: `@vitest/browser-playwright` + Playwright Chromium
- Coverage provider: `istanbul`
- Root check entry: root scripts fan out to package-owned scripts
- Root coverage entry: `vitest.config.ts`

## Quick start

Run from repo root:

First-time setup (once per machine) for browser tests:

- `pnpm --filter @tempad-dev/extension test:setup`

Then run:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test:run`
4. `pnpm test:coverage`

Use this sequence as the default pre-PR verification.

## Command reference

Root:

- `pnpm test` (watch package-owned tests in parallel)
- `pnpm test:run` (single run via package-owned `test:run` scripts)
- `pnpm test:coverage` (workspace coverage)
- `pnpm --filter @tempad-dev/extension test:setup` (install extension browser runtime)
- `pnpm --filter @tempad-dev/extension test:node` (extension node tests only)
- `pnpm --filter @tempad-dev/extension test:browser` (extension browser tests only)

Per package:

- `pnpm --filter @tempad-dev/extension test:run` (includes worker sandbox check)
- `pnpm --filter @tempad-dev/extension test:node`
- `pnpm --filter @tempad-dev/extension test:browser`
- `pnpm --filter @tempad-dev/extension test:browser:headed`
- `pnpm --filter @tempad-dev/extension test:setup`
- `pnpm --filter @tempad-dev/extension test:coverage`
- `pnpm --filter @tempad-dev/plugins test:run`
- `pnpm --filter @tempad-dev/plugins test:coverage`
- `pnpm --filter @tempad-dev/mcp test:run`
- `pnpm --filter @tempad-dev/mcp test:coverage`
- `pnpm --filter @tempad-dev/shared test:run`
- `pnpm --filter @tempad-dev/shared test:coverage`

## Required checks by change type

Always:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:run`

When changing pure utility logic or formatters:

- `pnpm test:coverage`
- Keep coverage scope/threshold behavior aligned with Vitest configs and `docs/testing/architecture.md`

When changing extension build/runtime behavior:

- `pnpm build:ext`
- If packaging impacted: `pnpm zip`

When changing DOM/browser runtime behavior in extension:

- `pnpm --filter @tempad-dev/extension test:browser`
- Use Playwright browser tests only; do not add jsdom-based tests.

## Coverage rules (operational)

- Workspace coverage is configured in root `vitest.config.ts`.
- Coverage provider must stay `istanbul` unless compatibility is re-verified.
- Coverage output must not include build artifacts.
  - Exclude: `**/dist/**`, `**/.output/**`
- `coverage/` outputs are generated artifacts and should not be committed.

## Test authoring rules

- Put tests under package-local `tests/`.
- Use file naming by runtime:
  - `tests/**/*.browser.test.ts` for browser runtime behavior.
  - `tests/**/*.test.ts` for node runtime behavior.
- For extension browser tests, use Playwright via Vitest browser projects.
- Do not add jsdom test environment in this repository.
- Keep tests deterministic:
  - no system clock dependence
  - no random IDs without fixed seed
  - no network or filesystem side effects in unit tests
- For mixed-purity files, only enforce strict coverage on intended pure exports.
- Add regression assertions for behavior changes in the same PR.

## Troubleshooting

### Coverage parse errors or files unexpectedly excluded

- Confirm coverage provider is `istanbul` (not `v8`) in Vitest config.
- Re-run with clean install if dependency graph recently changed:
  - `pnpm install`
  - `pnpm test:coverage`

### `dist` or `.output` files appear in coverage

- Check root coverage excludes in `vitest.config.ts`.
- Ensure tests import source modules (`src/**`, `utils/**`), not built artifacts.

### Package coverage passes but root coverage looks different

- Root `test:run` delegates to package `test:run` scripts.
- Root `test:coverage` still uses the root Vitest config and root-level include/exclude policy.
- Validate against root `vitest.config.ts` first.

### Browser tests fail to launch

- Install browser runtime:
  - `pnpm --filter @tempad-dev/extension test:setup`
- Re-run extension browser tests:
  - `pnpm --filter @tempad-dev/extension test:browser`

## Related docs

- Testing architecture: `docs/testing/architecture.md`
- Extension get_code requirements: `docs/extension/requirements.md`
- Extension get_code design: `docs/extension/design.md`
