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
- `pnpm mcp:check-host-context` (builds and exercises real CLI processes against a private fixture
  Hub; checks both host launch orders, sanitized child environments, registration after reconnect,
  and continued bridging after the original launcher exits). A real MCP SDK fixture also checks
  that the pre-context Hub contract accepts new CLIs through initialization, identity, and tools.
  CI runs it alongside profile isolation.
  It refuses Windows for the same fixed-pipe constraint; it does not connect to installed hosts.
  Native adapter and real Hub socket tests separately cover routing and persisted host contexts.
- `pnpm mcp:check-runtime-prototype` builds a bundled-only prototype in a private runtime root,
  using ephemeral WebSocket/HTTP ports and a synthetic extension. It checks two initialized
  edges, supervisor crash recovery without replacing the Hub or replaying a write, admission
  fencing, Stop, host-context isolation, legacy hook routing, and last-client shutdown. It
  reports startup/recovery timings and process RSS. The installed CLI and live runtimes are
  unchanged; this harness does not download or switch versions. Windows uses named pipes and
  checks actual directory and pipe ACLs rather than Unix permission bits.
- `pnpm mcp:check-runtime-switch` builds trusted local A/B fixtures from source in an ignored
  directory, then exercises manual switching with two initialized SDK clients and a synthetic
  extension. It checks draining, fixed asset endpoints, a disconnected write and late receipt,
  crashes at all four journal phases, port conflicts, rollback retaining a later Stop, and
  pending Claude Stop notices surviving both switching and rollback with durable hook retries.
  New edges also attach during a delayed handoff and after real stale writer leases expire;
  the fixture's initialization deadline exceeds the edge's 90-second recovery bound.
  `TEMPAD_SWITCH_CASES` selects comma-separated cases for diagnosis; `TEMPAD_KEEP_PROTOTYPE=1`
  retains isolated evidence. It never downloads or updates installed runtimes. CI runs the full
  matrix on Linux and Windows with Node 22 and 24; native host behavior remains outside this harness.
- `pnpm mcp:check-runtime-updates` builds complete release archives from the frozen local store,
  serves them from an isolated loopback registry, and exercises default release enrollment, staging and explicit
  activation through real CLI/Hub processes. It checks mixed policies sharing one Hub, exact
  pins, newest-compatible selection below the stable tag, tag rollback without downgrade,
  exact-version requests without substitution, frozen presentation, incompatible epochs,
  offline operation, corrupt caches, and zero
  registry requests from checkout builds. A real metadata write failure must leave the supervisor
  and MCP service alive without starting acquisition. After all owners exit, concurrent installed-release
  launches upgrade both control and Hub across an epoch boundary without registry access or
  allowing an older CLI to downgrade them. A separate simulated Codex namespace checks idle
  automatic activation, generic MCP clients, Claude/off-policy deferral, continuous tool work, bounded request
  waiting and measured admission pause. This is process evidence, not new native acceptance. CI runs this on
  Node 22/24 on Linux and Windows; native host acceptance remains outside this fixture. No installed
  runtime or public registry is used by the acquisition test.
- `pnpm mcp:prepare-release --output <absolute-new.tgz> --verify-baseline` builds and verifies
  the publishable dependency closure and checks the current stable npm baseline. See
  [release policy](docs/releasing.md#runtime-release-policy) before refreshing the review hash.
- `pnpm mcp:measure-runtime --output <new.json> --runs 5 [--lockfile <installation-lock>] <package-dir> [...]`
  compares trusted, explicitly supplied local release artifacts in the given version order. It
  performs MCP initialization/catalog reads through fresh CLI/Hub processes and records artifact
  hashes, structural comparisons across release windows, startup/attach timing and RSS. It never
  downloads packages or connects to installed hosts. TCP listeners are remapped to ephemeral
  loopback ports and IPC listeners are confined to a temporary root; Windows is refused.
  Preserve the resolved dependency lock alongside the report. Structural equality does not prove
  guidance or behavior compatibility, and warm attachment is not uninterrupted session recovery.
- `pnpm mcp:measure-hooks --hook <lifecycle.mjs> --output <new.json> --runs 30` measures an inspected
  hook against an isolated synthetic receiver, including slow commit, lost reply, failed commit,
  disconnect and exit before request arrival. It does not modify installed hooks or contact the
  user's Hub. File/directory fsync and injected delay are not full-device flush, disk-pressure,
  or installed-host adoption evidence. Keep measurement reports outside version control.
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

### Windows runtime CI

The [Windows runtime workflow](.github/workflows/windows-runtime.yml) runs the runtime unit
tests and all three supervisor/switch/acquisition process harnesses on Node 22 and 24. It
preserves LF source bytes for the reviewed manifest hash, asserts the selected Node version,
and uploads per-step logs. Push a validation branch under `ci/` to run it without publishing
`main`; it also runs for `main`, pull requests and manual dispatch.

All Windows matrix jobs must pass on the candidate before release. These checks exercise real
named pipes, ACLs, child processes, downloads, concurrent edges, in-flight requests, automatic
activation, crashes and rollback. They do not establish installed Codex/Claude desktop behavior,
and do not change the Windows limitations of the separate profile/host-context/bridge harnesses.

### Native runtime switch acceptance

Use the [authoring runbook](docs/testing/agent-authoring-evolution.md) for installed-host
replacement, preflight and native calls. The following opt-in fixture tests the packaged
release path without fetching or publishing a release. It requires macOS/Linux, a short new
private directory, and unused release discovery ports; it never stops another port owner.

```sh
node packages/mcp-server/scripts/native-runtime-fixture.mjs --root /tmp/tp-native-example --prepare
node packages/mcp-server/scripts/native-runtime-fixture.mjs --root /tmp/tp-native-example --serve --hold-candidate
# In another terminal, use the canonical descriptor path printed by --prepare:
pnpm agent-plugin:build --runtime-fixture /private/tmp/tp-native-example/runtime-fixture.json
pnpm build:ext
```

Preparation deploys frozen dependencies offline and verifies complete immutable A/B archives.
The fixture changes only package identity and the compiled registry origin to a fixed loopback
server; normal discovery, bootstrap, staging, consent and handoff logic remain in use. Both
packages are private and point publication at the fixture registry. Never publish these archives.
The ignored dev plugin routes Codex, Claude and its hooks to the same private release-test
namespace. It does not change any generated release target or the default checkout configuration.
Use a release-profile extension for this fixture, not a checkout-profile build.

After replacing the plugin and reloading the extension, require preflight and a native MCP read.
`--hold-candidate` keeps the registry on the initial version while this baseline is established.
Send `SIGUSR2` to the registry PID printed by `--serve` to expose the already-verified candidate;
this does not restart either the host or registry. Invoke `--check-runtime-update` with the
descriptor's environment to discover it immediately instead of waiting for the scheduled check.
An off-policy observer can hold the candidate staged for inspection; close it before testing
activation. Enrolled, initialized, wait-capable MCP clients can activate after five idle seconds.
Record stable host/edge identities, changed Hub identity, native feedback/lifecycle/Stop and
subsequent canvas work. Claude bindings must remain staged. The explicit update command remains
available, but cannot override an attached off-policy observer or other compatibility blockers.
The registry request log records only local acquisition. This establishes installed-host behavior
for the local candidate; official-registry provenance and cross-version release compatibility
remain separate checks. Do not count synthetic SDK clients as native-host acceptance.

When finished, uninstall the fixture plugin and confirm its CLI/Hub/supervisor processes have
stopped before shutting down the registry. Regenerate the ordinary plugin with
`pnpm agent-plugin:build`, rebuild the extension with `TEMPAD_MCP_DEV_CHECKOUT="$PWD"`, and follow
the same installation/preflight workflow to restore checkout development. Retain evidence outside
version control. Never reuse a fixture root for different source bytes.

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
