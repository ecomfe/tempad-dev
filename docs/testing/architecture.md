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
- Root coverage remains centralized in `vitest.config.ts`; baseline inventories, source patterns,
  and thresholds live in `vitest.coverage.ts` so package and workspace coverage cannot drift.

## Coverage model

- Coverage provider: `istanbul`.
- Build artifacts are excluded from coverage (`**/dist/**`, `**/.output/**`).
- Shared schemas and the plugin SDK enforce the same per-file 100% thresholds in package and
  workspace coverage runs. Shared installation and response helpers are also reported but only
  participate in the root aggregate baseline.
- Root, extension, and MCP report all TypeScript runtime modules in their node source scope,
  including untested modules. The shared agent/Hub runtime-path JavaScript helper also participates
  in the root and MCP reports and baseline. Their existing baseline groups retain the thresholds in
  `vitest.coverage.ts`: 90% lines/statements/functions and 85% branches. These gates do not imply
  that the full runtime has reached those percentages. Extend the gated baseline when adding
  behavioral coverage; do not remove baseline files or lower its floor to pass a change.
- Every extension MCP module and Hub runtime module also has a per-file floor of 50% for
  lines/statements/functions and 40% for branches. Broad source globs include new modules
  automatically, so aggregate coverage cannot hide a completely untested core file. The CLI,
  Hub, and isolated prototype entry launchers remain reported but are excluded from this floor
  because their integration tests run in child processes outside coverage instrumentation. These minimums supplement the existing
  baseline; meeting either gate is not evidence that every behavior is correct.
- Browser behavior is verified separately in the browser suite. Browser-facing TypeScript still
  appears in the node coverage report; that report does not measure Vue templates or native host behavior.
- Adding a security- or protocol-critical source file to coverage scope is part of the same change
  that introduces it.

### Source of truth for coverage scope

There is no manually maintained pure-function matrix in docs anymore.
Coverage scope is defined only in executable Vitest configuration:

- workspace and package composition: `vitest.config.ts` and package-level configs
- shared aggregate thresholds, baseline inventories, and runtime source patterns: `vitest.coverage.ts`
- extension browser: `packages/extension/vitest.browser.config.ts`

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
