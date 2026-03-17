# Testing architecture

This document describes the test architecture and coverage model used in this repository.
For contributor workflow and commands, see `TESTING.md`.

## Goals

- Keep tests deterministic, fast, and actionable.
- Separate node runtime behavior from browser runtime behavior.
- Enforce strict coverage on curated, testable pure logic.
- Avoid configuration drift between docs and executable test configs.

## Runtime model

- Test execution is package-owned and root scripts orchestrate package-local commands.
- Extension node tests: `packages/extension/vitest.node.config.ts`.
- Extension browser tests: `packages/extension/vitest.browser.config.ts` (Playwright).
- Other packages: package-local `vitest.config.ts`.
- Browser behavior must be tested with Playwright; do not introduce `jsdom` in this repository.

## Script ownership model

- Packages own their runtime-sensitive scripts such as `test`, `test:run`, and browser-specific commands.
- Root owns repo-level checks for root-only files and provides thin aggregation scripts such as `lint`, `format`, `typecheck`, and `test:run`.
- Root coverage remains centralized in `vitest.config.ts` because coverage policy is shared across packages.

## Coverage model

- Coverage provider: `istanbul`.
- Build artifacts are excluded from coverage (`**/dist/**`, `**/.output/**`).
- Strict thresholds are enforced for curated pure/testable files.

### Source of truth for coverage scope

There is no manually maintained pure-function matrix in docs anymore.
Coverage scope is defined only in executable Vitest configuration:

- root: `vitest.config.ts`
- extension node: `packages/extension/vitest.node.config.ts`
- extension browser: `packages/extension/vitest.browser.config.ts`
- package-level configs where applicable

If a file should enter or leave strict coverage scope, update config + tests in the same PR.

## Worker sandbox checks

Extension worker sandbox validation has two layers:

- static dependency allowlist check in `packages/extension/scripts/check-worker-sandbox.ts`
- runtime probe in real browser Workers (Playwright)

The runtime probe is part of `check:worker-sandbox` and runs during extension `test:run`.

## Change checklist

When touching test architecture or coverage behavior:

1. Update Vitest config first (scope, thresholds, include/exclude).
2. Add/update tests for behavior changes.
3. Run `pnpm lint` and `pnpm typecheck`.
4. Run `pnpm test:run`.
5. Run `pnpm test:coverage` when coverage scope/threshold behavior changed.

## Troubleshooting

### Coverage includes unexpected files

- Check root and package coverage `exclude` settings.
- Confirm tests import source files, not compiled artifacts.

### Coverage remap or parse instability

- Keep provider on `istanbul`.
- Reinstall dependencies and rerun coverage:
  - `pnpm install`
  - `pnpm test:coverage`

### Browser tests fail locally

- Install browser runtime once:
  - `pnpm --filter @tempad-dev/extension test:setup`
- Rerun browser tests:
  - `pnpm --filter @tempad-dev/extension test:browser`
