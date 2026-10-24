# Testing guide

This file is the contributor runbook for testing in this repository.
For architecture details (runtime split, strict coverage model, and Worker boundary checks), see `docs/testing/architecture.md`.

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

Use this sequence as the default pre-PR verification. Also run `pnpm test:coverage` when changing
pure utilities or coverage configuration, as detailed below. CI enforces the coverage floor.

## Command reference

Root:

- `pnpm test` (watch package-owned tests in parallel)
- `pnpm test:run` (single run via package-owned `test:run` scripts)
- `pnpm test:coverage` (workspace coverage)
- `pnpm mcp:check-bridge` (build the Hub and exercise legacy/current WebSocket peers through
  actual MCP calls, including assets, reconnects, upgrade errors, and task routing)
  - Set `TEMPAD_MCP_BRIDGE_METRICS=1` to print UTF-8 sizes of the deterministic
    Hub-to-extension, extension-to-Hub, and formatted MCP fixture responses.
- `pnpm agent-plugin:check-installer` (networked discovery smoke test with `plugins@1.3.4`;
  run after `pnpm agent-plugin:build`, without installing into a host)
- `pnpm mcp:check-profiles` (builds and launches isolated real CLI/Hub processes; checks
  shared release ownership, default and overridden directories, actual release/checkout WebSocket
  ports, and independent shutdown). CI runs the same harness beside the bridge check.
  Windows process-level isolation is unverified: the harness refuses Windows and Unix hook
  fixtures are skipped there. Unit tests cover pipe naming by user and checkout and the unchanged
  release pipe; runtime-directory overrides cannot isolate two Windows Hubs for the same checkout.
- `pnpm --filter @tempad-dev/extension test:setup` (install extension browser runtime)
- `pnpm --filter @tempad-dev/extension test:node` (extension node tests only)
- `pnpm --filter @tempad-dev/extension test:browser` (extension browser tests only)
- `pnpm agent-eval:authoring <rollout.jsonl> [...]` (inspect comparable rollout evidence, including separate recorded tool-output text/image traffic and host token usage)
- `pnpm agent-eval:preflight [--checkout <path>] [--app-path <path>]` (reject an absent or partial
  checkout runtime, inactive extension, or development plugin that does not match
  the configured Codex desktop host before page creation; distinguish an active extension that
  matches a stale development bundle from a browser reload that has not picked up a current bundle)
- `pnpm agent-eval:skills <rollout.jsonl>` (fingerprint the presented skill catalog)
- `pnpm agent-eval:log <start|finish|abandon|check|summary>` (retain the small amount
  of provenance needed to trust a live authoring run)

Per package:

- `pnpm --filter @tempad-dev/extension test:run` (includes Worker dependency checks and the real
  Chromium plugin-sandbox and rewrite-runtime regressions)
- `pnpm --filter @tempad-dev/extension test:built` (same checks, reusing a production extension
  built from the current sources; CI builds once before running this command)
- `pnpm --filter @tempad-dev/extension check:plugin-sandbox` (builds and loads the release extension,
  then probes isolation, timeout, recovery, and abuse bounds)
- `pnpm --filter @tempad-dev/extension check:rewrite-runtime` (builds the release extension and
  checks packaged script redirects and rules, Rspack chunk loading, offline fallback, and
  persisted rule cleanup after an upgrade in isolated Chromium profiles)
- `pnpm --filter @tempad-dev/extension test:node`
- `pnpm --filter @tempad-dev/extension test:browser`
- `pnpm --filter @tempad-dev/extension test:browser:headed`
- `pnpm --filter @tempad-dev/extension test:setup`
- `pnpm --filter @tempad-dev/extension test:coverage`
- `pnpm --filter @tempad-dev/plugins test:run`
- `pnpm --filter @tempad-dev/plugins test:coverage`
- `pnpm --filter @tempad-dev/mcp test:run`
- `pnpm --filter @tempad-dev/mcp test:coverage`
- `pnpm --filter @tempad-dev/mcp check:logging` (checks the built logging worker in isolated
  child processes; run `pnpm build:mcp` first)
- `pnpm --filter @tempad-dev/shared test:run`
- `pnpm --filter @tempad-dev/shared test:coverage`
- `pnpm --filter @tempad-dev/site test:run` (node and Chromium reader regressions)
- `pnpm --filter @tempad-dev/site test:browser`
- `pnpm --filter @tempad-dev/site test:setup` (install Chromium for site browser tests)

The official TypeScript compatibility job installs `typescript@6.0.3` and `vue-tsc@3.3.12`
in a temporary directory outside the workspace and verifies the compiler's package identity.
Use an explicit official `typescript/bin/tsc` path rather than `pnpm dlx tsc`: a cached dlx
installation can contain the workspace's compiler fork even when invoked outside the workspace.
`node scripts/check-declarations.mjs /absolute/path/to/typescript/bin/tsc` also builds shared
and the public plugin SDK into a temporary consumer and checks their generated declarations
with strict library checking and no workspace source condition. It does not change workspace
`dist` directories. MCP is a CLI package and does not publish a declaration entrypoint.

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

When changing the Hub/extension compatibility path or legacy assets:

- `pnpm mcp:check-bridge` runs an isolated Hub with temporary runtime, log, and asset directories
  and a dedicated extension Origin. It does not connect to the user's Hub or Figma sessions.
  The harness rejects Windows before starting a Hub because the fixed named pipe ignores runtime
  directory overrides. Unix socket hook fixtures are also skipped on Windows.
  One of the normal loopback candidate ports must be available. The old receiving schema is
  frozen from extension 0.20.0 / MCP 0.7.1 and extension 0.22.0 / MCP 0.10.0; do not derive these
  fixtures from current shared schemas. Every protocol bump must test the released extension's
  supported calls and rejection of unsupported options against the new Hub in the same change.
- Keep the broker regression for new-extension/old-Hub rejection and recovery. This deterministic
  transport check does not replace installed-host Queue/Steer/Stop acceptance.

When changing MCP logging or its packaging:

- Build with `pnpm build:mcp`, then run `pnpm --filter @tempad-dev/mcp check:logging` to verify
  worker loading, bounded output, and final-record flushing on normal and immediate exit.

When changing agent-plugin packaging or marketplace routing:

- `pnpm agent-plugin:build` and inspect the generated targets and all three marketplace manifests.
- `pnpm agent-plugin:check-installer` verifies both the marketplace entry and compatibility
  package with the real CLI. It downloads a pinned installer outside the unit-test suite and
  discovers only a temporary fixture; it does not change any installed plugins.

When changing DOM/browser runtime behavior in extension:

- `pnpm --filter @tempad-dev/extension test:browser`
- Use Playwright browser tests only; do not add jsdom-based tests.

When changing the end-to-end authoring evaluation process or its runtime identity gate:

- Follow `docs/testing/agent-authoring-evolution.md`.
- Use the stable minimal open-run wrapper from the evolution runbook, varying only the product
  platform and product situation by default; add a broad visual direction only when relevant
  to the question. The agent chooses dimensions and screen/flow extent. Freeze the prompt, intent,
  model, and reasoning effort immediately before dispatch; do not add a predicted result or evaluator-authored solution detail.
- Judge the authored result as a whole in plain language. Treat screenshots, native structure,
  timing, and tool traces as clues: inspect only what can confirm or explain the judgment. Do not
  introduce fixed quality axes, scores, finding counts, or promotion gates.
- Add deterministic tests for run-log integrity, runtime fingerprinting, bridge handshake, and
  write-before rejection at the owning package layers. Deterministic checks do not need live-run
  log entries.
- A fresh live Figma task is required only when the selected question needs agent
  discoverability, visual, structural, transfer, or drift evidence; it is not a default check for
  deterministic process infrastructure.

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
- Extension get_code requirements: `docs/extension/mcp-get-code-requirements.md`
- Extension get_code design: `docs/extension/mcp-get-code-design.md`
- Agent authoring evolution: `docs/testing/agent-authoring-evolution.md`
