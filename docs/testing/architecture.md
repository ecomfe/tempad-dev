# Testing architecture

This document describes the test architecture and coverage model used in this repository.
For contributor workflow and commands, see `TESTING.md`.

## Goals

- Keep tests deterministic, fast, and actionable.
- Separate node runtime behavior from browser runtime behavior.
- Enforce full coverage on small pure packages and an explicit aggregate regression floor elsewhere.
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
- Shared and plugin packages keep their package-owned 100% thresholds.
- Root, extension, and MCP aggregate coverage use the thresholds in `vitest.coverage.ts`:
  90% lines/statements/functions and 85% branches, measured across the configured scope.
- Browser-only behavior is verified in the browser suite and excluded from node-only root coverage.
- Adding a security- or protocol-critical source file to coverage scope is part of the same change
  that introduces it.

### Source of truth for coverage scope

There is no manually maintained pure-function matrix in docs anymore.
Coverage scope is defined only in executable Vitest configuration:

- root: `vitest.config.ts`
- shared aggregate thresholds: `vitest.coverage.ts`
- extension node: `packages/extension/vitest.node.config.ts`
- extension browser: `packages/extension/vitest.browser.config.ts`
- package-level configs where applicable

If a file should enter or leave strict coverage scope, update config + tests in the same PR.

## Plugin sandbox boundary checks

Extension plugin isolation and dependency validation have three layers:

- `check:worker-sandbox` statically reviews each trusted Worker bundle's dependency graph; external
  pnpm packages are enumerated explicitly rather than accepted through a generic `node_modules` rule
- the same check executes the Worker bundles in Chromium, including self-contained module lexing and
  evaluation through the CSP-compatible lexer build
- `check:plugin-sandbox` builds the release extension, loads its generated manifest in Chromium, and
  verifies the opaque-origin sandbox page, restrictive CSP, Figma-only embedding, fixed broker
  protocol, payload bounds, timeout/termination, recovery, prototype isolation, blocked import
  bypasses, and zero requests across tested loopback network channels

Both commands run during extension `test:run`. The browser sandbox regression exercises the shipped
architecture rather than a simulated DOM environment. It supports the application-level guarantees
and explicit non-goals recorded in `docs/security/local-mcp-threat-model.md`; it is not evidence
against browser-engine vulnerabilities or hard process-wide memory exhaustion.

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
