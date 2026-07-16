# Engineering optimization audit

Audit date: 2026-07-15

This is the evidence-backed backlog for the current security, `get_code`, plugin-runtime, protocol,
quality, and positioning pass. Completed entries describe changes in the working tree; they are not a
release record.

## Reproducible baseline

Before implementation, the repository passed `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, and
`pnpm build`. The first test/build attempt was intentionally rerun sequentially after concurrent
commands raced on generated `packages/shared/dist` output. The sequential baseline was green:

- shared: 25 tests
- plugins: 6 tests
- MCP server: 48 tests
- extension node: 599 tests, plus browser Worker probes

The root coverage run was about 97% lines and 96% branches but had no threshold. Package coverage
configuration had drifted to per-file 100% thresholds that the configured aggregate scopes could not
satisfy, so those package commands failed despite high aggregate coverage.

## P0 — immediate abuse and reliability boundaries

- **Completed: WebSocket admission checks.** The hub now rejects missing/non-extension Origins and
  non-root/query handshakes. An exact extension-Origin allowlist is configurable without changing the
  default development workflow.
- **Completed: pending-call ownership.** Tool results and errors can only complete calls assigned to
  the same extension connection, preventing guessed-id completion by another connected extension.
- **Completed: asset-server capability and abuse limits.** A process-random capability path replaces
  the unauthenticated asset route. Wildcard CORS was removed; extension-origin requests must match
  the active extension; aggregate quota is reserved across concurrent uploads; and per-asset size,
  connections, upload/download concurrency, request/response time, and header count are bounded.
- **Completed: asset-endpoint exfiltration guard.** The extension rejects an advertised asset
  endpoint unless it is explicit-port `127.0.0.1` HTTP without credentials, query, or fragment.
  The same check runs for every live `state` update, not only the initial handshake; malformed,
  duplicate-registration, or endpoint-changing traffic closes the candidate and starts the existing
  reconnect path.
- **Completed: zero-config active-connection partition.** Once a connection is active, another
  connection can replace it only when both handshakes carry the same extension Origin. This keeps
  published-extension and same-unpacked-extension reconnects transparent while preventing a later,
  differently identified extension from taking over an established route. No secret, pairing step,
  environment variable, or client configuration is required.
- **Completed: Worker lifecycle.** Each plugin request uses a new Worker with timeout, termination,
  runtime/deserialization error handling, and recovery on the next request. Mutated prototypes no
  longer persist in a reused Worker.
- **Completed: module-loading guard.** Static imports, dynamic imports, and re-exports are rejected by
  the CSP-compatible `es-module-lexer` JavaScript build. It follows ECMAScript lexical grammar for
  comments, strings, templates, regex/division, import attributes, and source-phase imports while
  allowing `import.meta`; lexer failures reject the module before evaluation. Documentation treats
  module lexing as defense in depth rather than the isolation boundary. Worker dependency
  checks enumerate reviewed pnpm packages instead of allowing all `node_modules`, and the release-
  extension Chromium probe exercises the opaque-origin sandbox, CSP, plugin lexing, payload bounds,
  termination, recovery, prototype isolation, and tested network channels.
- **Completed: malformed result rejection.** Browser-gateway and hub schemas require exactly one of
  `payload` or `error` in a tool result, reject explicitly undefined values at the browser boundary,
  and forward only the selected field. Agent-facing error labels are emitted only for shared,
  recognized TemPad error codes rather than trusting arbitrary string properties.

## P1 — high-value performance, protocol, and verification work

- **Completed: early oversized-selection shell.** When descendant text alone proves the 64 KiB
  budget cannot fit, `get_code` skips descendant variable mapping, plugin execution, asset planning,
  asset export, and full-tree rendering. The output contract remains the existing shell with direct
  child ids.
- **Completed: plugin component session batching.** Figma-side style/component preparation stays at
  four concurrent nodes, but prepared jobs are sent to the sandbox in payload-aware batches of at
  most 32. Up to four batch Workers run concurrently, and each evaluates the plugin module once for
  the whole batch. A deterministic 129-instance fixture now requires five Worker startups/evaluations
  instead of 129 (a 96% reduction) while preserving source-order results and fresh-Worker isolation
  between batches and tool calls.
- **Completed: enforceable coverage policy.** Root, extension, and MCP aggregate scopes share an
  aggregate 90% line/statement/function and 85% branch floor. Shared/plugin pure packages retain
  their package-owned full-coverage policy. Security and broker files were added to scope.
- **Deliberately deferred: mutual pairing.** Origin checks do not authenticate the hub to the
  extension or distinguish the published extension from every installed extension before the first
  active route exists. Mandatory pairing would add setup and recovery burden to every MCP client, so
  it is not part of the current hardening path. If a higher-threat deployment appears later, pairing
  must be opt-in and version-negotiated rather than changing the default flow.
- **Pending compatible migration: asset hash length.** The current 8-hex content identifier is useful
  for lookup, not authorization. Negotiate longer new-write ids, dual-read during TTL cleanup, then
  remove short writes.
- **Completed: Hub admission and activation extraction.** Port selection and handshake admission now
  live in a testable WebSocket server module with real loopback integration tests for accepted and
  rejected Origins/paths, connection limits, occupied-port fallback, and exhaustion. Registration,
  state, activation, result/error routing, malformed/oversized input, socket-error containment, and
  disconnect cleanup have a real-socket lifecycle regression. Extension activation and sole-
  connection grace behavior live in a separately tested registry instead of mutable top-level arrays.
- **Completed: bounded deterministic vector export.** Independent vector roots export two at a time
  instead of serially. Per-export asset maps are merged in source order, so concurrency does not make
  the agent-facing asset and SVG order nondeterministic.
- **Completed: broker recovery regressions.** Deterministic tests now cover candidate-port
  exhaustion, retry scheduling, stale handshake epochs, malformed handshakes and established
  messages, duplicate registration, live asset-endpoint changes, delivery failure, session
  replacement, permission failures, and teardown cleanup.
- **Pending performance measurement: continuation rounds.** The shell contract can require one call
  per direct child. Capture realistic large selections before introducing cursor/batch continuation;
  such a field needs protocol negotiation and a compatibility window.
- **Completed: deterministic preflight work evidence.** A 10,000-node synthetic fixture proves that
  one oversized UTF-8 text descendant short-circuits the preflight after one descendant, while
  integration tests verify descendant collection, plugin resolution, asset planning/export, and full
  rendering are not called. Plugin-enabled calls intentionally keep the full path because an active
  plugin may replace or shorten descendant output, so text size alone is not a valid overflow proof.
- **Completed: stable operation-count fixtures.** Tests now assert one CSS read per collected node,
  zero reads for omitted descendants, one semantic extraction per node across repeated layout reads,
  four-at-a-time plugin input preparation, 32-job sandbox batches with at most four concurrent
  Workers, and two concurrent vector exports with deterministic source-order output. These
  assertions gate work amplification without relying on noisy wall-clock thresholds.

## P2 — deeper architecture and maintenance

- Keep the module lexer current when the extension adopts new JavaScript module syntax, and retain
  browser-Worker probes so its CSP-compatible build remains verified in the actual runtime.
- Move page-world tool execution behind a stronger privileged boundary if hostile page scripts enter
  the threat model; a page-visible secret cannot solve that boundary.
- Make asset quota accounting resilient to external directory writes or multiple hub processes if
  those become supported operating modes.
- Add realistic recorded fixtures for markup-heavy overflow and warm/cold Figma API behavior. Keep
  the executable gates on stable operation counts rather than noisy wall-clock totals.
- Extract the remaining top-level Hub lock/stdio-session/shutdown orchestration into a process state
  machine before claiming direct Hub lifecycle coverage. Admission, socket protocol, activation,
  request ownership, and asset serving are covered now; process takeover and forced-shutdown paths
  still need child-process integration tests.
- Continue raising broker branch coverage when new reconnect states are introduced. The current
  reconnect, delivery-failure, session-replacement, and teardown paths have explicit regressions and
  remain in enforced coverage scope.
- Consider a versioned, structured continuation field while preserving the current inline child-id
  comment for older agents.

## Product position

Figma's official MCP offering now includes a recommended hosted remote server and a local desktop
server, with broader write and Code Connect capabilities. TemPad Dev should not position itself as a
replacement for every Figma MCP workflow or promise production-ready code. Its defensible focus is
open implementation, local control, an inspectable browser/read-only handoff path, programmable
output transforms, canonical agent-facing code/token IR, and explicit context-budget behavior.

Primary references:

- [Figma MCP server introduction](https://developers.figma.com/docs/figma-mcp-server/)
- [Figma remote and desktop comparison](https://help.figma.com/hc/en-us/articles/35281385065751-Figma-MCP-collection-Compare-Figma-s-remote-and-desktop-MCP-servers)
- [What the Figma MCP sends versus what the agent does](https://developers.figma.com/docs/figma-mcp-server/mcp-vs-agent/)

## Verification after implementation

- `pnpm lint`: passed.
- `pnpm typecheck`: passed for root and all workspace packages.
- `pnpm test:run`: passed (shared 26, plugins 6, MCP server 72, extension 649, including the
  real-browser Worker dependency probes and release-extension plugin-sandbox regression).
- `pnpm test:coverage`: passed 743 tests and the enforced floor with 98.42% lines, 97.65% statements,
  99.05% functions, and 94.85% branches across the root scope. The critical extension broker scope
  remains 98.43% lines / 86.63% branches, and MCP server coverage is 96.69% lines / 93.05% branches.
- `pnpm build`: passed for shared, plugins, MCP server, extension, and site. Rolldown still reports
  upstream `@vueuse/core` pure-annotation warnings, and the MCP build reports existing `tsdown`
  option-deprecation warnings; neither fails the build.
- Package format checks and a formatter check over every file changed by this pass succeed. The
  workspace-wide `pnpm format:check` still reports only the pre-existing, user-owned untracked
  `docs/mcp/provider-sdk-design.md`, which this pass intentionally did not modify.
- `git diff --check`: passed.

## Compatibility decision

The default remains a bounded local-trust mode with no new setup. Security changes must preserve the
existing enable-and-connect flow and must not require users to distribute, rotate, or recover a
secret across MCP clients. The implemented balance is strict web-Origin/path admission, capability-
bearing asset URLs, live endpoint revalidation, connection-bound results, and same-Origin active
route replacement. Exact Origin configuration stays optional for managed deployments.

A same-user process can spoof browser headers, and a malicious installed extension can still race to
be the first sole connection in compatibility mode. Closing that residual risk requires an identity
credential or OS-mediated channel; it cannot be achieved honestly with a new header that both sides
derive from public data. Any future pairing mode therefore needs separate evidence, an opt-in user
story, and a backward-compatible protocol—not a mandatory configuration change.

The detailed boundary and migration sequence are in
[`docs/security/local-mcp-threat-model.md`](../security/local-mcp-threat-model.md).
