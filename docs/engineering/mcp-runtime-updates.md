# Updating a running MCP runtime

Status: Phases 0–3 are implemented. Codex native switching is verified; Claude native acceptance and automatic activation remain pending.
The default CLI keeps the existing bridge until explicit enrollment. Acquisition is opt-in and
activation always requires confirmation. Design baseline: `74ed70c9`.

This design is for maintainers implementing runtime updates and preparing compatible
releases. It owns the proposed process boundary, update transaction, and acceptance
criteria. [Releasing](../releasing.md) owns the implemented artifact and publication policy.

## Problem and intended experience

A user should receive compatible Hub fixes without closing an otherwise idle agent
or restarting its MCP connection. Connected operations drain before switching;
disconnected executions require the durable exclusion described below.
Network failures must not stop the installed runtime, and a development checkout
must never query, download, activate, or fall back to a production release.

This is a process replacement mechanism, not JavaScript module hot reload. The first
implementation preserves the host-facing MCP session but may briefly reconnect the
extension and require an existing design task to resume and read its canvas. It does
not promise uninterrupted WebSockets, HTTP transfers across a restart, or live task
lease migration.

### Baseline behavior (`74ed70c9`)

| Owner                                                                                                                    | Current behavior                                                                                                                 | Consequence                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`cli.ts`](../../packages/mcp-server/src/cli.ts)                                                                         | Bridges host stdio to the shared Hub; starts the `hub.mjs` beside itself when necessary.                                         | Reconnection neither installs a release nor prevents an older CLI from starting its old Hub.                 |
| [`hub-runtime.ts`](../../packages/mcp-server/src/hub-runtime.ts)                                                         | Owns MCP sessions, tool handlers, WebSockets, asset HTTP, and host adapters. Shuts down after the last MCP consumer disconnects. | An idle consumer can keep old code running indefinitely; restarting the Hub also discards MCP session state. |
| [`design-tasks.ts`](../../packages/mcp-server/src/design-tasks.ts)                                                       | Restores active tasks as paused, advances epochs, and requires read-back.                                                        | Reconnecting a socket is not enough to resume editing safely.                                                |
| [`asset-http-server.ts`](../../packages/mcp-server/src/asset-http-server.ts)                                             | Allocates a new port and capabilities at startup.                                                                                | Previously returned HTTP URLs can stop working even when their files remain.                                 |
| [`terminal-receipts.ts`](../../packages/mcp-server/src/terminal-receipts.ts)                                             | Tracks execution completion in process-local state.                                                                              | A host timeout does not prove the Figma operation has stopped.                                               |
| [`shared.ts`](../../packages/mcp-server/src/shared.ts) and [development packaging](../../scripts/build-agent-plugin.mjs) | Release and checkout launches share the default runtime paths and discovery ports.                                               | A development CLI can attach to the running release Hub instead of its own build.                            |

Publishing npm `latest` only affects subsequent package resolution. There is no
scheduled version check, compatible-version activation, or coordinated handoff today.

## Alternatives and feasibility

| Approach                                                                    | Assessment                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detect updates and ask the host to restart MCP                              | Lowest complexity; retain this fallback. Automatic host reconnection and tool refresh are not established across supported hosts. It does not fulfill the no-host-restart goal by itself.                                           |
| Retire an old Hub for new connections; run new connections on a new version | Does not update existing long-lived clients. Concurrent Hubs also need independent extension routing and exclusive state/asset ownership, rather than just separate ports.                                                          |
| Periodically restart today's byte-bridge Hub                                | Loses MCP initialization state and permits old CLIs to respawn old code. A timer alone is insufficient.                                                                                                                             |
| Stable edges plus Hub-managed replacement or an elected edge coordinator    | Saves one persistent process, but still needs an owner-independent lock, activation journal, crash recovery, and a hook endpoint during replacement. Reconsider if measured supervisor cost outweighs that simpler ownership model. |
| Stable edges plus a supervisor                                              | Recommended candidate: explicit lifecycle ownership and a surviving control endpoint. Adds a process and a recovery protocol; this cost requires measurement before full implementation.                                            |

With one host, the proposed steady state has three processes rather than today's two.
An optional installation worker is temporary, not a fourth permanent service. With N
host MCP connections sharing a profile, the count changes from N + 1 to N + 2. No additional
installer process is required when the candidate is already available locally.

Phase 0 must measure actual emitted contracts for known release artifacts: identical
contracts, presentation-only differences safe for old sessions, incompatible wire or
behavior changes, and cumulative eligibility for a session spanning several releases.
Also measure idle memory, cold startup, and reconnect overhead. Source-file churn is
only a screening signal, not an activation rate. If representative correctness fixes cannot
reach long-lived sessions without carrying multiple behavioral APIs, retain detection
and restart guidance instead of completing this architecture merely because it is designed.

## Proposed architecture: stable MCP edge, shared supervisor, replaceable Hub

```text
Host A <-- MCP stdio --> CLI edge A --+
                                    +-- data --> Hub generation N
Host B <-- MCP stdio --> CLI edge B --+              |-- Figma WebSocket server
                                                   |-- asset HTTP server
                                                   |-- tools and host adapters
                                                   +-- task and asset stores
Edges <-- control --> Supervisor -- lease/lifecycle --> Hub
```

| Component                                    | Owns                                                                                                                                   | Does not own                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| CLI edge, one per MCP connection             | MCP initialization, negotiated capabilities, request IDs, cancellation/progress, host metadata, and the session's advertised contract. | Canvas logic, native conversation verification, npm polling, or choosing its own Hub version. |
| Supervisor, one per user and runtime profile | Runtime selection, installation worker, admission gate, generation changes, activation journal, and Hub process lifecycle.             | MCP tool implementations, Figma operations, native feedback delivery, or task-store writes.   |
| Hub, one active generation per profile       | Tool validation/execution, WebSocket and HTTP services, native host integrations, and exclusive task/asset-store ownership.            | The lifetime of host MCP sessions or independent update selection.                            |

Keep the existing npm entry point. A release contains the edge, supervisor, and a
complete runtime payload; an update activates only the runtime payload. The supervisor
may delegate package acquisition to a short-lived worker so downloads do not block
routing. There is no new system daemon, privileged installer, or separate user setup.

The edge is small but is a real MCP server, not a byte pipe. Use the SDK's protocol
handling and forward generic method/argument envelopes to the Hub. Keep tool schemas
and behavior in the runtime; do not compile a second per-tool implementation into
the edge. The edge freezes the validated tool catalog at initialization. Request
metadata, client identity, cancellation, progress, and structured errors must survive
the internal hop unchanged in meaning.

The internal protocol needs explicit version negotiation and bounded frames. Each
data connection binds an edge-session ID; each call carries its request ID, supervisor generation, original metadata,
and remaining deadline. Generation changes must not reset deadlines, confuse equal
request IDs from different clients, or authorize a conversation from an arbitrary
claimed ID. The Hub still verifies native identity through the existing host adapters.
Reattaching an edge to a new Hub must not emit a second MCP `initialize` to the host.
Preserve both directions of protocol traffic and backpressure; server requests cannot
share the client's request-ID space. When the host closes stdio, detach that edge.
When the last edge disconnects and no accepted work remains, stop the Hub and supervisor;
the updater must not turn today's on-demand service into an always-running background app.

The MCP initialization version describes the stable edge. Diagnostics separately
report the active runtime version; they must not imply the initialization reply
changes after an update.

### Per-edge host context and process environment

At the design baseline, [CLI startup](../../packages/mcp-server/src/cli.ts) inherited the first launcher's
environment into the Hub. Identity hints are read in the CLI, but the Hub's Codex
[queue reader](../../packages/mcp-server/src/agent-clients/codex-queue.ts),
[SQLite reader](../../packages/mcp-server/src/agent-clients/codex-server-queue.ts), and
[IPC discovery](../../packages/mcp-server/src/agent-clients/codex-ipc.ts) also read host
paths from process environment. Phase 0b removes that dependency; a supervisor must preserve
the same isolation after the original edge disconnects.

Each edge registers a typed, bounded host context: client kind, session hints, relevant
host discovery inputs, and resolved host-home paths such as `CODEX_HOME` and
`CODEX_SQLITE_HOME`. Resolve defaults in the edge. Capture identity hints from variables
such as `CODEX_APP_TOOLS_PIPE_PATH`, `CODEX_THREAD_ID`, `CLAUDECODE`, and
`CLAUDE_CODE_SESSION_ID` there, never in the supervisor or Hub. Do not forward the entire
environment, credentials, or arbitrary executable paths. These inputs locate a host;
they do not prove conversation ownership. Native verification and request-scoped metadata
still govern binding, including multiple conversations sharing one edge and retired
Claude session hints.

Launch both supervisor and Hub with an explicit environment allowlist: platform necessities
and validated profile configuration, without host identity/home overrides or unrelated
inherited secrets. Host adapters receive the originating edge's context as an argument;
they must not read or mutate global `process.env` for host settings. Adapter caches and
helper-process environments are scoped to that context, so two host homes cannot share
queue readers or connections accidentally. Helpers receive only the required validated
host fields on top of the clean base environment.

Re-registration after a Hub switch or supervisor recovery includes the context and its
revision, not just pending request IDs. Revalidate endpoints and native identity before
delivery or writes; missing context cannot fall back to the process that started the Hub.
Retire a context once its edge and outstanding verified work no longer reference it.

## What can update automatically

Automatic activation requires all of the following, checked again at commit time:

- The candidate comes from the configured stable release channel and is newer than
  the active release. Crossing a breaking-release boundary requires an explicit update
  decision: a minor change within 0.x, transition to 1.0, or a major change thereafter.
- Its internal protocol supports every connected edge and the running supervisor.
- Its executable MCP contract matches every initialized session: methods, capabilities,
  tool names, annotations, input schemas, and output schemas. Compare a canonical wire
  contract hash, not just a package version or tool count.
- Each session may keep its original instructions and tool descriptions only when the
  release explicitly declares that guidance still correct for the candidate's behavior.
  Fixing a typo need not force a restart; changing required workflow or safety guidance does.
- Its extension protocol adapters support the promised released-extension range,
  including connected peers. An offline older extension must not lose a promised adapter.
- Attached Claude bindings satisfy the verified receipt/retry hook requirement in
  [Appendix B](#appendix-b-installed-hooks-and-delivery-evidence); legacy or unknown
  capability defers automatic switching, without disabling ordinary MCP use.
- It runs on the current Node executable and platform, and preserves the current
  configuration's meaning. Updating Node itself is outside this mechanism.
- Both candidate and previous runtime can read and write the state format used after
  activation, including cancellation fences and unknown-result markers.

Each release payload therefore needs a static manifest containing its artifact identity,
Node/platform requirements, supported internal protocol range, wire contract hash,
presentation hash, guidance-compatibility epoch, extension protocol range, and state
read/write compatibility family. Compare this with
every live participant before activation; a release label such as "patch" is insufficient.

Hashes are gates, not proof of semantic compatibility. Releases must declare compatible
behavior and test the retained guidance. An unchanged guidance epoch is an explicit
reviewed promise; a missing declaration blocks activation. Its source, cumulative meaning,
review responsibility, and publication gates are specified in the
[release policy](#appendix-c-release-policy).
Each edge serves its frozen
presentation snapshot, including after `tools/list`; a new session gets the active
runtime's presentation. No description is silently replaced mid-session. Wire changes
or incompatible guidance stay pending until all affected sessions can be restarted.
The first delivery does not maintain multiple schema/behavior implementations or rely
on every host refreshing its tools after a list-change notification.

Changes to the edge, supervisor, Node requirement, extension page code, installed
skills, or hooks retain their own update lifecycle. In particular, a Hub update cannot
replace Figma-side `apply_canvas` or code-export implementations. The first delivery
does not hot-replace the supervisor or edge themselves.

## Runtime provenance and development isolation

Separate endpoint identity from update policy. There is one release namespace per user,
one per real checkout, and explicitly isolated release-test namespaces. Enrollment never
creates a second release Hub, port pool, or store. A verified release package started by
local path uses the release namespace too; an unclassifiable build fails closed.

| Namespace    | Resolution and update policy                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release      | All plugin/manual release launches share one Hub. Each edge registers its update policy; automatic activation requires every attached edge to opt in. |
| Checkout     | `TEMPAD_MCP_DEV_CHECKOUT` pins the real checkout path. No registry requests, downloads, production cache lookup, or production fallback.              |
| Release test | Explicit isolated endpoints and stores for updater tests, never production or checkout state.                                                         |

A checkout declaration always wins over a release-update flag; contradictory inputs
must fail closed. Use the same proposed `--runtime-updates=stable` launch argument for
generated release plugin configuration and manual installations; no plugin is required
to enroll. Existing configurations without the argument keep their current launch behavior
and add no background acquisition. An edge without opt-in joins the same release Hub but
defers automatic activation while attached; enrolled edges may still stage a candidate.
Recheck unanimous consent when closing admission and before commit, including new arrivals.
An explicit `--runtime-updates=pinned` edge requires its launch package's version and manifest;
absence of enrollment is not proof of an npm version pin. Do not switch a pinned edge to a different active artifact: report the
conflict and required reconnect without starting a competing release Hub.
This policy controls runtime acquisition; an external `npx` bootstrap
may still fetch its launch package. Checkout launches use the local Node entry point.
Build origin, real path, and launch policy are validated together rather than guessing
from semver, the current directory, or whether `.git` happens to exist.

From MCP 0.12.0, offer enrollment as
`npx -y @tempad-dev/mcp@latest --runtime-updates=stable`, followed by the ordinary one-time
MCP restart. Keep both root and MCP README languages and the shared installation snippets
in sync; do not document this as a working command before it ships. Adding the argument
to the authored plugin manifest requires a stable plugin version increase and regenerated
targets. Phase 3 leaves existing generated plugin and manual setup arguments unchanged: enrollment
is an explicit host-configuration choice using the same argument, and automatic activation is disabled.

Namespace IPC endpoints, locks, state, assets, activation records, and caches by user
and profile. Checkout profiles also include a stable hash of the real checkout path.
The [release Windows pipe](../../packages/mcp-server/src/shared.ts) retains its existing name
and ignores runtime-directory overrides; the Phase 0a checkout pipe includes user and checkout
hashes. Pipe naming does not establish cross-user access control. Unsupported platforms keep
updates disabled rather than sharing an unsafe fallback endpoint.

### Checkout discovery and installed hooks

Keep the release discovery pool at the current `6220`, `7431`, and `8127` ports. Checkout
Hubs and extensions use a separate bounded pool that never borrows release ports, even
when every checkout port is occupied. Release-test endpoints are also explicitly isolated.
Maintain the pool definitions in shared code and bind the selected pool to the runtime
profile; port separation alone does not authenticate a peer.

The extension's build-time profile descriptor identifies the real checkout hash or a
release build. Use it for both port selection and the handshake. `import.meta.env.DEV`
alone is insufficient: a checkout candidate can be built in production mode for native
acceptance. Development serving and explicitly prepared checkout candidates must carry
the same checkout identity; published archives must contain no checkout identity.
Distinct checkouts may contend within the dev pool but must reject each other's identity
and never fall back to release. A checkout Hub rejects identity-less old extensions
before accepting sessions or tools; rejection must let their discovery loop try the next
candidate. Verify this with frozen released peers. Unambiguous legacy release connections
retain their compatibility adapter; a conflicting profile never wins by answering first.

Claude hooks are launched independently of the MCP server and cannot depend on its
configured environment. [Development packaging](../../scripts/build-agent-plugin.mjs)
must generate dev hook commands pointing explicitly to a packaged profile descriptor
containing the same real checkout identity as the MCP launch. A missing or conflicting
descriptor fails closed, without trying the default release socket. Generate this input
from authored sources; do not patch installed or generated hooks by hand. Keep release
hook discovery unchanged in this isolation step; the later versioned hook migration is
specified in [Appendix B](#appendix-b-installed-hooks-and-delivery-evidence).

### npm launches and version skew

The existing `npx -y @tempad-dev/mcp@latest` remains the bootstrap distribution path;
its resolved package can vary with registry/cache availability. Runtime polling is a
second acquisition trigger, not a second activation authority. Both feed the supervisor.

| Incoming edge/package                            | Required behavior                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundled runtime older than active                | Use the activated runtime if the edge protocol is supported; never downgrade or spawn the adjacent Hub.                                                                                                       |
| Bundled runtime newer than active                | Offer the complete payload through the versioned bootstrap protocol as a local staged candidate. Verify provenance, integrity, and compatibility normally; do not download it again if already verified.      |
| Edge/package prefers a newer supervisor protocol | Negotiate the highest mutually supported version and use the active runtime's contract. Disable only optional unsupported update features. Refuse the new attachment only when no safe common version exists. |
| New runtime needs a newer edge or supervisor     | Keep it staged; identify which sessions/control component require replacement. No force activation.                                                                                                           |

Edges and supervisors must negotiate downward throughout the control-protocol support
window in the [release policy](#appendix-c-release-policy).
The fixed bootstrap discovery response advertises ranges before negotiation. Prefer
optional capabilities to a new protocol generation. This is a minimum support window,
not a guarantee that an indefinitely old supervisor can accept every edge.

If no compatible protocol remains, respond to the host's `initialize` request with an
explicit JSON-RPC server error identifying `MCP_RUNTIME_RESTART_REQUIRED`, the installed
and supported versions, and the required restart action. Emit one stderr explanation,
flush the response, and exit unsuccessfully. Do not initialize successfully with an empty
tool list, advertise unusable tools, or launch another supervisor. Hosts may present this
as a failed MCP connection; their exact UI is an acceptance check, not a protocol guarantee.

The first implementation explicitly accepts that edge/supervisor code can remain old
for the lifetime of open host connections. It guarantees opportunities for Hub updates,
not a maximum age for every process. Report control-component updates immediately when
detected, retaining a restart-required status; no expiry timer forcibly disconnects users.
After all edges disconnect, a subsequent launch may select the newer compatible control
component. Persist control-component identity separately from the active Hub, so an old
edge cannot accidentally respawn an obsolete supervisor during crash recovery.

## Discovery and staging

Recommended initial defaults, subject to isolated measurement:

- Check in the background after successful startup, then every six hours with jitter.
  Persist the last check so reconnects and multiple edges do not multiply requests.
- Only the supervisor checks. A network check never blocks MCP initialization or
  a tool call. Offline operation uses the current verified runtime.
- Bound metadata requests to ten seconds, downloads to two minutes, and the complete acquisition worker to 150 seconds;
  bound response, archive, and extracted sizes. Failure leaves the active runtime intact.
- Retry failed checks with backoff. Quarantine a failed candidate by version and
  integrity hash rather than attempting the same failing switch in a loop.

Resolve the channel once to an exact `@tempad-dev/mcp` version and integrity. Stage
that immutable artifact in a private directory outside the npm/npx cache. Validate
the tarball integrity, package name/version, runtime manifest, required files, archive
paths, and supported engine before executing candidate code. Never use a URL supplied
by a Figma document, extension message, or tool argument as an update source.

The release payload must include a reproducible runtime dependency closure, including
logging workers, so activation needs no network access or floating dependency install.
Building that payload and checking it outside the workspace is a release prerequisite.
Do not run package lifecycle scripts during acquisition, rewrite the running npm cache,
or install into the user's project. Registry integrity checks protect artifact bytes;
they do not independently prove publisher authenticity. Retain the existing trusted
registry/publisher boundary and verify release provenance in CI.

Perform an isolated candidate self-test using temporary stores and endpoints, with no
user Figma discovery or native host delivery. Check startup, contract hashes, configuration,
state-reader compatibility, and clean shutdown. Candidate execution is allowed only
after artifact validation. Keep the active and previous known-good payloads until
rollback and process-reference checks permit cleanup.

## Update transaction

```text
running -> checking -> staged -> draining -> switching -> verifying -> running
              |           |         |            |           |
           running     deferred   deferred     recovery    rollback
```

1. **Stage while serving.** Download and self-test without disturbing the current Hub.
2. **Close admission globally.** Acquire the update lock, pin the connected-client
   compatibility set, and fence new work in the supervisor and old Hub. Newly connecting
   edges join this gate. MCP ping and cached tool listing remain available. New business
   calls receive a bounded, retryable unavailable result stating that they were not
   dispatched; there is no hidden queue or automatic replay of canvas writes.
   The Hub also gates direct HTTP uploads/downloads and browser feedback actions;
   gating only the CLI path would leave an admission race. Keep registration, completion
   receipts, cancellation, and Stop available.
3. **Drain actual work.** Wait for dispatched calls, native feedback admission/removal,
   uploads, downloads, task bindings, and state flushes. Count Figma terminal receipts,
   not merely expired host requests. Idle stdio connections, WebSocket heartbeats, and
   open reviews do not block an update. Known read-back fences can be carried forward;
   detached operations require the stronger execution-fence rules below.
4. **Defer rather than kill.** Derive the drain deadline from the latest recorded remaining
   deadline of admitted work plus a bounded flush allowance, subject to the maximum
   admission-pause policy below. If work is still active, reopen old admission and retry
   later. Do not cancel a canvas transaction or feedback submission merely to update.
5. **Prepare durable handoff.** Flush current task, fence, feedback, and asset state.
   Save the update phase, active/candidate artifact identities, state revision, endpoint
   configuration, and next generation in the supervisor's activation journal. Journal
   writes use atomic replacement and the platform's durability primitives. No task or
   asset store is written by both processes.
6. **Stop the old Hub.** Use a dedicated acknowledged drain/shutdown path; the current
   best-effort `shutdown()` is insufficient. Confirm process exit and store-lock release
   before starting the candidate with production state. Losing a control socket is not
   proof that the process exited. An unresponsive old process blocks the planned update.
   Its shutdown acknowledgment includes the last durably applied control sequence and
   store revision; controls accepted after the earlier flush must not be omitted.
7. **Start and verify the candidate.** Acquire the same store locks, restore state, bind
   the reserved endpoints, reattach edges, and allow extension registration and lifecycle
   controls. Keep normal operations fenced until stores, listeners, and routing are ready.
   Use a bounded readiness deadline; no connected Figma page is required just to start.
8. **Commit and reopen.** Atomically commit the activated artifact and generation before
   releasing admission. Each edge routes subsequent calls to the new generation without
   replacing its host stdio connection. Revalidate task and browser identity before any
   write. Suppress routine success messages in model-facing tool output.

Cancellation and Stop remain admissible during draining. Existing browser-local Stop
fences and saved cancellation snapshots remain authoritative during the brief socket
gap. The new Hub reconciles them before permitting writes. Ordinary control requests
must not report completed cancellation merely because they were buffered. Legacy hooks
have the separate durable-admission contract below. If control delivery or conversation
identity is uncertain, leave tasks paused and require fresh verification.
Never replay Queue/Steer delivery to compensate for an unknown admission result.

### Drain deadlines and disconnected execution

The default canvas timeout is 120 seconds; Codex's 300-second tool timeout is a host
wait limit, not proof that Figma has stopped. Runtime settings may override the defaults.
For each admitted operation,
record its effective absolute deadline and actual terminal state. The drain target is
the latest remaining deadline plus a proposed ten-second flush allowance, capped by a
proposed 330-second admission pause. A longer override may cause deferral; expiry never
authorizes killing the operation. Closing admission prevents a growing new-work queue.
Use monotonic time for a live drain and conservatively reconcile after sleep/restart.

Execution with a confirmed end needs only read-back protection. An execution that may
still be running needs durable file exclusion, preserved across updates **and cold starts**.
This extends the existing in-process exclusion; it intentionally strengthens restart behavior.
It cannot expire just because every edge disconnected. Provide explicit operator recovery
for an abandoned executor, followed by read-back, rather than requiring its original browser
profile to return forever. [Appendix A](#appendix-a-disconnected-execution-and-operator-recovery)
defines the evidence, recovery entry points, and limits.

### Task continuity

Use normal restore semantics in the first implementation: active tasks become paused,
their epochs advance, and subsequent writes require explicit resume and successful
read-back. MCP tools explain the recovery, so an agent can continue through the same
connection without a user restarting it. Cancelled tasks remain cancelled; update
handling must never begin a replacement task automatically. Disconnected owners do not
regain authority simply because their edge process survived.

Prefer a quiet operation boundary, but do not wait for every design task to complete:
that would recreate the indefinite-update problem. No-op MCP heartbeats do not count
as work. The tradeoff is a possible resume/read step during a long conversation.
Transparent live-lease transfer would need a separate fenced handoff protocol and is
deliberately excluded from the first delivery.

### WebSocket and asset continuity

- Restart the WebSocket and HTTP services together with the Hub generation. Keep the
  previous WebSocket port when available; reconnect through existing discovery. Never
  run two writer Hubs on different candidate ports to hide the transition.
- Drain accepted HTTP transfers before stopping. Persist the asset listener port and
  current/legacy capability secrets privately and supply them to the successor. The
  asset server currently needs new constructor support for these inputs. Preserve the
  asset directory and filenames, so existing HTTP URLs and `localPath` values retain
  their ordinary lifetime after a compatible update.
- If the required HTTP port cannot be rebound, keep admission closed and attempt safe
  recovery. Do not claim a transparent update while silently invalidating returned URLs.
  Capability rotation or endpoint changes require an explicit nontransparent transition.
- A reconnected extension must validate its new handshake and asset endpoint normally.
  Do not weaken Origin checks or send a changed endpoint on an already-open connection.
  A stopped task's snapshot must win over restored active state.

## Failure and rollback rules

| Failure                                                                     | Required behavior                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline, invalid artifact, incompatible contract, failed isolated self-test | Keep serving the current runtime; record a pending/failed check without interrupting tools.                                                                                         |
| Drain budget expires                                                        | Reopen old admission, preserving operations and cancellation; retry later.                                                                                                          |
| Persisting the update journal fails                                         | Do not stop the old Hub.                                                                                                                                                            |
| Persisting update scheduling metadata fails                                 | Keep serving tools; expose the error and disable checks until owner restart. Download only after a durable attempt; activate only committed candidates.                             |
| Old Hub cannot confirm shutdown                                             | Do not start a second writer or forcibly kill it for an automatic update.                                                                                                           |
| Candidate fails before admission reopens                                    | Stop and confirm candidate exit, then restart the previous runtime against current state.                                                                                           |
| Candidate fails after handling work                                         | Preserve current state and unknown-result fences; recover with the previous binary only when state compatibility permits. Never replay a write or restore an old database snapshot. |
| Supervisor crashes during ordinary operation                                | Keep edge MCP sessions open; elect one replacement supervisor and reattach to the existing Hub before considering a new Hub.                                                        |
| Supervisor crashes during a switch                                          | Close new admission; reconcile journal, live process identity, and store locks before choosing a generation. An ambiguous transition stays blocked.                                 |
| State requires a one-way migration                                          | Stage only; require a separate coordinated upgrade. Automatic binary rollback is not safe.                                                                                          |
| New runtime needs a newer edge, supervisor, or Node                         | Explain the required MCP restart/runtime upgrade; do not bypass compatibility checks.                                                                                               |

The journal tracks `preparing`, `old-stopped`, `candidate-ready`, and `committed` with
unique transaction/generation IDs. Resume from observed process and lock ownership,
not PID alone. A successor never assumes a restarted supervisor means an old Hub is
dead. Until a new supervisor handshake is established, the Hub rejects new business
work but lets already-dispatched operations settle and persists their outcomes. This
applies during ordinary operation as well as an update.

Edges retain their initialized MCP session and enter bounded reconnect/backoff after
losing the supervisor. One edge wins the profile's startup lock and starts the recorded
compatible supervisor; other edges wait. The winner must also acquire the supervisor's
lifetime lock before publishing its control endpoint. A broken socket alone cannot
replace a still-live supervisor. The successor checks the activation journal, process
identity, the Hub control lease defined below, and store locks, then attaches to the live Hub or recovers a
dead one. Edges re-register their session, versioned host context, and pending request IDs
without asking the host to initialize again. Every routed frame carries the control
generation, fencing stale owners. The independent edge/Hub data connection can deliver
accepted results during control recovery without supervisor buffering. If that connection
is also lost, unrecoverable write results become unknown outcomes, never retries; durable
execution ownership and result recovery require Phase 2. Exhausted recovery
reports unavailability while preserving the host session; it does not create a second writer.

The **Hub control lease** is issued and checked by the Hub that holds the store locks.
It grants one supervisor instance control of that Hub, scoped to the profile, Hub instance,
supervisor instance, and monotonically increasing control generation. Proposed defaults
are renewal every two seconds and expiry after ten seconds without renewal, measured on
the Hub's monotonic clock. Each admission checks expiry; a delayed timer is not authority.
Expiry or control-channel loss stops new business admission, while existing operations may
settle and Stop remains available. It neither releases store locks nor proves a process
has exited. A replacement supervisor must acquire the profile lifetime lock and complete
the validated control handshake before receiving a new lease. Frames from an older
generation cannot renew or use it; wake from sleep requires revalidation before admission.

Rollback means switching executable code while preserving the latest durable state.
Restoring a pre-update snapshot could resurrect a stopped task or resend feedback and
is prohibited. The rollback guarantee must cover state written after activation, not
just whether a candidate can read the old snapshot.

## Status, controls, and rollout

Expose current edge/runtime versions, source profile, last check, staged version,
phase, and the reason activation is deferred. Secrets and full capability URLs never
appear in status. Add proposed CLI actions `--runtime-status`, `--check-runtime-update`,
and `--update-runtime`; they contact the supervisor and cannot bypass drain or profile
rules. A profile-level updates-off setting prevents background checks. A manual check
on a checkout reports that it is pinned without contacting the registry.

Runtime status reports `controlComponents` separately from the active Hub: the retained
supervisor version and each attached edge's reported package version. A newer active or
staged version remains pending with `restartRequired`; switching the Hub does not apply
that control update. Unknown edge versions and their restart requirement remain `null`,
and quarantined candidates do not recommend a restart. No host context or session tokens
are included in this projection.

After every MCP edge and runtime owner has exited, launching a newer installed release
advances both the retained control component and the Hub using those local verified bytes.
The startup lock serializes migration and edge registration; live edge records prevent an
owner crash from being mistaken for a cold restart. An interrupted metadata migration
resumes its recorded decision without restoring task or receipt snapshots. Cold replacement
may cross a wire/guidance boundary, but still requires state/extension compatibility and a
common control protocol for binary rollback. It never downgrades, retries quarantined bytes,
or activates a downloaded candidate merely because it is staged.

The extension's integration status may display a concise pending-update or recovery
message through a negotiated status capability. Older extensions keep the existing
wire shape. Do not inject recurring upgrade reminders into model prompts or tool results.

Do not expose these proposed actions as MCP tools that let document content trigger
installation. The supervisor owns policy; model-visible tools report normal availability
and recovery rather than choosing versions or bypassing an update gate.

Existing raw-bridge CLIs cannot acquire these capabilities by updating the Hub beneath
them. The initial transition requires one coordinated restart of the old MCP connections.
Do not kill an existing legacy Hub or start another writer while old clients still own
it. The supervisor's public IPC endpoint must reject legacy byte-bridge attachment with
actionable guidance; legacy CLI processes cannot participate in hot activation. This
rejection does not apply to installed lifecycle hooks, whose compatibility is described
below. Thereafter, updates outside the compatible-runtime boundary still need a restart.

Migrate existing stores to a profile only with the legacy Hub stopped and its store locks
held. Preserve all task fences, unknown records, feedback receipts, and asset paths;
record an idempotent migration result before activation. Existing asset files may stay
in their owned directory to preserve returned paths. The old default IPC path needs a
compatibility guard so a leftover legacy CLI receives restart guidance instead of
silently recreating an old Hub. If a conflicting legacy process or ambiguous store owner
is detected, defer enrollment. This cannot prevent someone deliberately launching an
unmodified old binary against a separate custom configuration; do not claim that guarantee.

### Installed hook compatibility

Keep the legacy hook listener; rejecting old MCP byte bridges must not reject valid
lifecycle hooks. Its 750 ms deadline cannot guarantee durable admission under all disk
conditions. Automatic switching with attached Claude clients therefore requires verified
receipt/retry-capable hooks; legacy or unknown capability defers automatic switching.
Manual migration retains the compatibility listener and fresh lifecycle validation.
[Appendix B](#appendix-b-installed-hooks-and-delivery-evidence) defines routing,
timing measurements, and recovery when acknowledgment is missing.

## Delivery phases and acceptance gates

Use isolated processes, fake registry artifacts, real sockets, and fault injection.
Each phase has an exit criterion; none implies permission to publish or replace live services.

### Phase 0a — independent release/checkout isolation

Keep one release namespace and its existing paths, pipe, and ports. Isolate checkout roots,
locks, state, assets, logs, discovery ports, and hook routing by real checkout identity.
This phase does not implement enrollment, a supervisor, an updater, or host-context changes.
Exit: isolated real CLI/Hub processes coexist without cross-routing or shared files;
missing/conflicting checkout builds fail closed; dev hooks work without MCP environment;
production-mode checkout extensions and released peers obey the profile handshake.

The implementation uses `TEMPAD_MCP_DEV_CHECKOUT` for Node launches and production-mode checkout
extension builds; `pnpm dev` selects the checkout automatically. Explicit directory overrides
remain bases and receive a checkout suffix. Empty checkout overrides use defaults. Runtime
socket paths exceeding the Unix limit fail before connection retries. Installed hosts are
not switched by the isolation checks; see `pnpm mcp:check-profiles` in [Testing](../../TESTING.md).
Release ZIP packaging rejects checkout builds. Checkout discovery uses the build profile even
when runtime identity is unavailable, and refuses to connect without that identity. Checkout
Hubs close peers that do not complete the profile handshake within five seconds. Generated
dev hooks read the sibling MCP configuration for directory overrides and reject missing or
conflicting checkout identity instead of falling back to release. Configured runtime directory
overrides must be absolute: hooks and MCP hosts need not have the same working directory.

Windows process-level isolation is unverified. Unit tests cover distinct users/checkouts and
the unchanged release pipe name; process and Unix hook checks do not run on Windows. Directory
overrides do not change a checkout pipe name, so two test Hubs for the same Windows user and
checkout cannot be isolated that way. Phase 0a is not claimed as verified on every platform.

### Phase 0b — independent per-edge host context

Extend today's CLI identity registration channel without waiting for a stable MCP edge or
supervisor. Remove first-launcher environment dependence from host adapters and helpers.
Exit: Codex and Claude launch in either order, two Codex homes remain isolated, and losing
the first launcher cannot change another session's identity, queue path, or helper environment.
Deliver and review this behavior change separately from 0a.

The CLI now sends a versioned `notifications/tempad/host-context` registration before the
unchanged client identity notification on every connection. Unknown notifications leave
older Hubs' identity handling intact. The Hub accepts one immutable context per connection;
request metadata and native ownership checks still select the conversation. Queue readers,
helper environments, availability caches and lifecycle subscriptions use that context.
Hub launch uses an environment allowlist rather than inheriting host identities or credentials.
Codex task ownership and delivery serialization compare only the Codex home and SQLite home.
`home` and `tempDir` remain discovery inputs: a verified reconnect updates them without losing
its task or delivery identity. Caches still distinguish complete discovery contexts. Claude
task reconnection does not depend on Codex paths. Rejected storage mismatches are logged.

Contexts remain private to the Hub: saved tasks and feedback receipts retain their routing
context through disconnect and restart, without exposing it to MCP results or the extension.
Older clients and stored records without context keep canvas access and local Stop; native
controls require updating the CLI and restarting its MCP server in the host; reconnecting an old
process cannot supply missing context. They never use
the first launcher's configuration as a fallback. Contexts do not authorize executable paths.
Legacy queue receipts without recoverable context retain their deduplication/cancellation evidence
instead of expiring without checking the native queue, as detailed in the
[feedback retention rules](../extension/mcp-design-tasks.md#codex-feedback-native-queue-and-steer).

`pnpm mcp:check-host-context` verifies real CLI launch/reconnect behavior with a private fixture
Hub. Real Hub socket tests cover registration and task persistence; adapter tests cover two
Codex homes, scoped queue helpers and restored receipts. These checks do not establish live
Codex/Claude UI behavior or Windows process-level isolation. No supervisor is introduced.
Codex App native Queue, Steer, Stop and lifecycle acceptance is required before shipping 0b;
deterministic checks alone do not establish compatibility of the sanitized helper environment.

Native acceptance passed on macOS with Codex App 26.1021.22027 and bundled CLI
0.164.0-alpha.11.1: a comment queued from Figma reached the next native turn, Steer
reached an already-running turn, turn completion paused the design task, and Figma Stop
persisted cancellation and interrupted the owning turn. This used the installed checkout
plugin and runtime-managed queue helper; it does not establish Windows or other host-version
compatibility.

### Phase 0c — feasibility measurements and hook inventory

Compare actual release-artifact contracts/guidance and measure process cost and legacy hook
latencies. Inventory capable, legacy, and unknown hooks with the observed denominator in
installed-host tests, without background telemetry or population-wide adoption claims.
Current shipped hooks are legacy. Exit: delivery evidence after timeout is understood and
the measured benefit justifies the supervisor; otherwise retain update notices. This research
does not block the independent 0a/0b fixes or establish that automatic updates are implemented.

The opt-in measurement commands in [Testing](../../TESTING.md) now inspect supplied local
packages without downloading releases or touching installed runtimes. They record emitted
catalogs, artifact hashes, resolved-dependency lock provenance, process timings/RSS, and
structural comparisons for both adjacent and skipped releases. Schema descriptions are
separated from executable fields without erasing properties literally named `description`.
Unknown schema keywords remain significant. Neither hash grants activation eligibility.

The initial macOS/Node 24 sample covered all 12 stable npm releases from 0.5.0 through 0.11.0,
with five fresh Hub runs per artifact and two CLI attachments per run. Of 11 adjacent transitions, five had identical
advertisements, two changed presentation only, and four changed the wire contract. The
0.5.0 → 0.5.1 presentation change actually changes vector/follow-up guidance and must not be
treated as a safe text correction. The 0.7.0 → 0.7.1 change only renames/titles the server.
All four transitions from 0.7.1 onwards change wire contracts. These counts are not hot-update
coverage: 0.x minor boundaries also need approval, dependencies were resolved at measurement
time, and no historical release supplies a reviewed guidance epoch.

This supports a bounded bundled-only Phase 1 prototype: the 0.6.1 Hub startup-race fix is a
concrete correction whose advertised contract stayed unchanged. It does not justify enabling
automatic updates or carrying multiple schema implementations. Measure the prototype's added
process and recovery cost against this baseline before accepting the supervisor architecture.
Warm CLI attachment is only a baseline; it does not prove uninterrupted MCP reconnection.

The inspected installed Claude payload was 0.4.0: one legacy payload, zero receipt/retry-capable
payloads. No live Claude binding was validated by this inventory. Both that payload and the
current hook were exercised against a synthetic receiver. Slow persistence and lost replies
can leave a committed event; failed persistence, early disconnect and exit before arrival
leave none. All five cases exit successfully without usable acknowledgment. Therefore the
receiver's retained record, followed by fresh binding evidence, must decide recovery; the
hook exit code cannot. File/directory fsync samples and an injected 900 ms delay do not measure
full-device flush or platform-wide load behavior. Those measurements and installed-host
receipt/retry acceptance remain gates before automatic activation, not claims from this probe.

### Phase 1 — stable edge and supervisor, bundled runtime only

The isolated `runtime-prototype.mjs` entry implements this topology with control protocol 2.
Protocol 1 was an unpublished prototype without hook admission provenance; its isolated
fixtures require a new runtime root. Incompatible control components fail during negotiation,
before handoff or rollback, rather than interpreting historical hooks as fresh evidence.
It requires a private Unix root, pins the built `.mjs` files, and allocates ephemeral ports;
the normal CLI does not select it. `pnpm mcp:check-runtime-prototype` exercises it with real
processes and a synthetic extension, without touching installed hosts or downloading packages.

The prototype keeps edge/Hub data sockets separate from supervisor control. Existing responses
and cancellation can settle while the supervisor is unavailable; new business calls, asset
transfers, and feedback admission require the Hub's current lease. Stop, review closure, and
lifecycle hooks remain available. A successor re-registers each edge and its host context against the same Hub.
This avoids replay buffers in the supervisor and preserves the SDK sessions on both ends.
A lost Hub or data socket is not retried as a write: the host session retains ping and its frozen
catalog. Phase 2 adds backend replacement and durable recovery below; Phase 1's process-cost
measurements describe the earlier supervisor-only implementation, not the switching path.
Neither harness is installed-host acceptance.
Its separate build under `dist/prototype/` leaves the normal Hub entry and preflight
fingerprint intact; ordinary builds and npm publication do not include that prototype output.
Dependencies still resolve from the local installation; this is not Phase 3's immutable release payload.

Five fresh-process trials per path on macOS arm64 with Node 24.22.1 gave these local medians:

| Measurement                        | Existing bridge | Prototype |
| ---------------------------------- | --------------- | --------- |
| Attach a second initialized client | 134 ms          | 173 ms    |
| Two-client process RSS sum         | 316 MiB         | 433 MiB   |
| Supervisor crash recovery          | Not applicable  | 5.44 s    |

Prototype cold initialization took 589 ms (585–603 ms), including election and catalog freezing.
The existing harness starts its Hub separately, so its cold timings are not directly comparable.
Recovery included the five-second stale-lock window; all five trials retained the same Hub and
delivered the admitted write once. These are isolated synthetic checks, not latency guarantees
or native-host acceptance. RSS sums include shared pages and are not physical-memory deltas.
The extra process and roughly 116 MiB RSS cost need to be considered before production enablement.

- Two clients initialize and use the same bundled Hub; tools, frozen metadata, progress,
  cancellation, responses, and native identity retain their existing semantics.
- Kill the supervisor during normal operation. Exactly one replacement attaches to the
  existing Hub; clients keep their MCP initialization and no canvas write is replayed.
  Re-register each edge's host context and verify isolation after the original launcher exits.
  Distinguish a lost supervisor connection from the host closing its edge session.
- Exercise newer/older edge negotiation, response backpressure, host disconnect, and last-client
  shutdown. The public legacy hook endpoint works; raw legacy MCP attachment gets guidance.
- Verify a new edge negotiates to each supported old supervisor and keeps usable tools.
  No common version produces an explicit initialization error, never a successful empty catalog.
- No online checks or runtime version switching are enabled in this phase.

### Phase 2 — manual local-artifact switch and recovery

The isolated prototype implements local switching. The installed CLI still uses its normal
bridge; no release or checkout is enrolled, and no online version lookup or download runs.
Build the prototype separately as in Phase 1. Keep the initial entry available for supervisor
recovery and issue operator commands against that entry and the same private, canonical Unix root:

```sh
node <initial-entry>/runtime-prototype.mjs --root <root> --status
node <initial-entry>/runtime-prototype.mjs --root <root> --recover-runtime
node <initial-entry>/runtime-prototype.mjs --root <root> --switch <candidate-entry>/runtime-prototype.mjs
node <initial-entry>/runtime-prototype.mjs --root <root> --runtime-status
node <initial-entry>/runtime-prototype.mjs --root <root> --resolve-runtime-block <request-id>
```

`--switch` is an explicit decision for that exact newer stable version. Both local artifacts
are probed in disposable private runtimes, checked for handoff support and identical frozen MCP
metadata, and fingerprinted before execution. Local dependency resolution is still trusted;
this is not Phase 3's verified npm acquisition or immutable dependency closure. Rejected contracts
require a host restart; failed activation bundles are quarantined in this isolated root.

The coordinator gates new work, drains admitted calls/native feedback/transfers, flushes state,
records the handoff, acknowledges shutdown, and verifies process exit and writer-lock release
before starting the replacement. Known request deadlines include a ten-second flush margin;
work without a shared absolute deadline uses the 330-second outer bound. Expiry defers the switch,
never kills admitted work. Fixed WebSocket/HTTP ports and both asset capabilities are persisted.
The edge checks the replacement's full contract again before acknowledging readiness. Recovery
and rollback reuse current state, including post-activation Stop fences; no old snapshot is restored.
Following a crash, the existing writer-lock expiry can delay recovery by about a minute.
Failed fallback startup retries for up to 90 seconds only when no process still owns the
runtime. A persistent port conflict or uncertain owner keeps admission closed; after fixing
that condition, `--recover-runtime` continues the journal without clearing task or execution fences.
First attachment also waits up to 90 seconds for explicit transient admission failures;
permanent compatibility errors fail immediately. This does not extend a host's shorter
initialization deadline and never replays MCP initialization or business requests.

The supervisor owns the legacy hook socket while the Hub uses a private data socket. Received
events enter a durable inbox; task effects and invocation receipts commit together before reply.
Failed or unconfirmed delivery fences admission. Lost replies can be retried without reapplying
effects. Each inbox/receipt set is bounded at 4,096 identities and fails closed at capacity.
Phase 3 adds 24-hour expiry for completed v2 receipts, with a persisted rejection cutoff so
expired invocations cannot replay even after clock rollback. An expired pending v2 event
is retired by the Hub with its session/task invalidation durably recorded; newer lifecycle
evidence, Stop notices and execution fences survive. The inbox records a terminal expired
outcome rather than an applied acknowledgment, allowing subsequent events and recovery to
proceed. Unconfirmed retirement still fences admission; legacy receipts remain retained.
Live legacy Claude
bindings defer even manual switching in this prototype. A legacy hook that exits before its request
arrives is still unobservable; this implementation does not claim to preserve that event.

Persistent execution exclusion and interactive recovery also apply to the normal Hub. A cold
restart does not unlock a possibly running write. Recovery requires stopping its original execution
environment, confirming the exact block interactively, and then reading the canvas; cancelled tasks
remain cancelled. No extension recovery dialog is exposed in this phase.

`pnpm mcp:check-runtime-switch` owns the repeatable process/fault matrix; unit tests cover durable
commit failures, stale confirmations, lifecycle deduplication and admission boundaries. Windows
process switching and native Codex/Claude acceptance are not claimed by these isolated checks.

- In isolated release-test profiles, switch compatible A to B with two clients still
  initialized; idle clients do not block. The operator offers a newer local build;
  lower or equal versions are rejected. Verified npm acquisition remains Phase 3 work.
- A live canvas operation, native feedback delivery, and asset transfers drain. Verify
  custom deadlines, deferral, and calls arriving after the gate as definitely undispatched.
- A disconnected remote execution transfers only with the durable exclusion contract.
  Read/resume cannot unlock it; late verified completion or document replacement can.
  Unsupported peers defer; a new runtime never mistakes a missing receipt for completion.
- Full cold restart preserves execution exclusion. A new browser profile can use explicit
  operator recovery without the old profile returning; test stale confirmations, failure to
  persist, idempotence, retained Stop fences, and the subsequent mandatory read-back.
- Ship persistent exclusion and its tested interactive CLI recovery in the same MCP version,
  even when automatic updates are off; document the changed restart behavior in its changelog.
  Never release exclusion alone. If the extension dialog is offered, verify its privileged
  origin/user-gesture path and rejection of page, plugin, forged, and replayed recovery messages.
- Exercise Stop, `/clear`, and hook events at every phase boundary, including the legacy listener.
  Inject delays beyond 750 ms and losses before arrival and after commit. Do not claim an
  unreceived event survived; unavailable fresh evidence keeps writes paused. Legacy/unknown
  hook capability defers automatic activation, and capable retries never duplicate effects.
- Asset URLs and local paths survive switching. Test port conflicts, Origin checks,
  capabilities, journal crash points, disk-full errors, and failure after admission reopens.
  Rollback retains all post-activation Stop and execution fences.

### Phase 3 — verified release acquisition, activation off by default

Implemented in `src/runtime-update/`, with the Phase 2 transaction shared by the opt-in release
entry and isolated local harness. The coordinator retains its original edge/supervisor payload,
current/previous Hub, staged candidate, and interrupted-transaction artifacts. New CLI launches
use the same release namespace; non-opt-in edges defer switching. Checks run only while enrolled
edges exist, with persisted backoff and one acquisition worker. Status alone never enrolls a runtime.
The worker verifies official npm integrity, safe extraction, complete dependency closure, and a
self-probe before atomic cache publication is eligible for activation. Failed checks leave the
active Hub available. The release policy is now maintained in [Releasing](../releasing.md#runtime-release-policy).

`mcp:check-runtime-updates` covers real downloads from an isolated local registry, shared ownership,
explicit activation, preserved session presentation, incompatible epochs, offline operation,
corrupt caches, and checkout refusal. These process tests do not establish native host acceptance.
Windows enrollment is disabled. The remaining rollout requirements are:

- Before this phase, publish the backward-compatible hook receiver, then a versioned plugin
  with profile-aware receipt/retry hooks. Allow an installed-plugin upgrade period and verify
  actual capable bindings; an elapsed period or plugin version alone does not establish adoption.
  Follow shared contract → MCP receiver → agent-plugin inputs/generated payloads, and the
  extension consumer when affected. The plugin payload change requires a stable version bump.
- Validate staged artifact integrity, reproducible dependencies, engine and protocol ranges,
  wire hashes, guidance epochs, state compatibility, and failed-candidate quarantine.
- Show exact reasons for pending updates. Presentation-only safe updates can use frozen
  session text; incompatible guidance/schema changes remain blocked.
- Maintain the authored policy, generated manifest, cumulative guidance review, and CI
  gates in [Releasing](../releasing.md#runtime-release-policy). Test skipped releases and epoch
  changes even when later presentation text reverts.
- Publish the compatible runtime before updated plugin launch arguments and
  installation guidance; keep the release package specifier at `@tempad-dev/mcp@latest`.
- Offline starts, sleep/wake, and reconnect storms neither multiply checks nor block tools.
  Checkout runtimes make zero requests even with missing builds or corrupt caches. A release
  Hub with no enrolled edge makes no background requests; a mixed-policy release Hub may
  stage for an enrolled edge but cannot activate while a non-opt-in edge remains attached.

### Phase 4 — native acceptance before automatic activation

Automatic activation remains disabled. Use the isolated
[native fixture](../../TESTING.md#native-runtime-switch-acceptance) to exercise local packaged
candidates through installed hosts; changing the registry origin for this probe does not
establish official-registry provenance or compatibility with every host version.

Codex App acceptance covers Queue/Steer before and after an explicit Hub switch, resumed
canvas reads/writes and screenshots, native Stop interruption, and cancelled-task read-back
after both switching and crash rollback. The existing MCP edge processes remain alive.
Claude installation, initialization and `/clear` hook delivery have been exercised, but its
model-driven tool calls and Stop across a switch still need native acceptance. These results
do not enable automatic activation.

- Run the full preceding matrix and frozen released-extension compatibility checks against
  the packaged candidate. Measure switch latency and deferral rates before promising a target.
- Complete native acceptance through the normal installed Codex and Claude paths under the
  [authoring runbook](../testing/agent-authoring-evolution.md): `/clear`, legacy/current hooks,
  feedback, Stop, runtime update, and resumed canvas work without MCP reinitialization.
- Confirm pending supervisor/edge updates remain visible rather than falsely reported as
  applied. No zero-downtime or host-support claim follows from isolated tests alone.

Protocol references: [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
and [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Appendix A: Disconnected execution and operator recovery

Distinguish two conditions:

- **Execution ended, result unknown:** persist the normal read-back fence. It can cross
  generations and no longer blocks drain; a qualifying later read can clear it.
- **Execution may still be running:** a WebSocket close or request timeout is insufficient
  to release exclusion. The current operation/receipt maps and ordinary read-back marker
  do not durably represent this condition across a generation change.

To stop a disconnected peer from pinning the whole runtime forever, Phase 2 must add a
durable unresolved-execution record: file, task/epoch, browser/tab/document identity,
request ID, and receipt generation/token. After persistence is acknowledged and old
Hub-local work has settled, this exclusion may move to the new Hub instead of blocking
its upgrade. It blocks **all new writes to that file**, across tasks and clients; resume,
an idle snapshot, a successful read, or lease expiry cannot clear it. Reads during this
period must not be presented as final verification of the pending operation.

Automatic release requires a verified terminal receipt or authoritative evidence that
the executing document closed/was replaced; unknown outcomes still require read-back.
Other files and runtime updates can proceed while one file remains blocked. The recorded
old receipt generation must remain verifiable after the switch; today's broker discards
pending receipts on generation change, so this needs a coordinated extension contract.
Peers without that contract retain conservative update deferral. Ordinary read-back
markers alone are never a substitute. All automatic rollback candidates must enforce
the same durable exclusion, including records created after activation.

### Cold starts and operator-assisted recovery

This record persists the file exclusion already enforced by `hasPendingOperation` in
[design-tasks.ts](../../packages/mcp-server/src/design-tasks.ts). Its lifetime is deliberately
stronger: unlike today's process-local operations, it survives all edges disconnecting,
a full Hub restart, lease expiry, and a different browser profile connecting. Closing the
agent or restarting the Hub does not stop JavaScript already executing in a Figma page.
Keep unresolved records until resolution, outside ordinary retired-task retention.

`--runtime-status` remains read-only and reports a block ID/revision, file, originating
browser/document, recorded time, and available recovery evidence without receipt secrets.
Provide a separate proposed `--resolve-runtime-block <block-id>` interactive action and
an equivalent user-operated extension recovery dialog. These are not model-callable MCP
tools, automatic retries, or part of `--recover-task-storage`.

The extension confirmation must run in a packaged extension-owned page, not the injected
Figma UI or a document/plugin frame. It is not web-accessible or embeddable by Figma.
Require a trusted confirmation gesture there; the background worker checks browser-supplied
sender identity and the allowed extension page before admitting a dedicated control request.
Neither page bridges nor content scripts may request or relay this recovery capability.
The Hub verifies the registered extension connection, Origin/profile, and a short-lived,
single-use challenge bound to the exact block revision. Keep the challenge in privileged
extension contexts; invalidate it on reconnect, expiry, or revision change. A caller-provided
`userGesture: true` is never evidence. The Hub trusts the verified broker to attest the UI
gesture within the existing local trust boundary; it cannot observe the click itself.
If this route is not ready, expose only the interactive CLI recovery, not a page-world bypass.

Persistent exclusion and working operator recovery are one release unit. The CLI route
must be available in the first MCP version that preserves these records across cold starts,
including with automatic updates disabled. Explain the new persistence and recovery in
that release's changelog; rollback candidates must retain an equivalent recovery path.

1. Prefer automatic evidence: reconnect/reload the original executor and verify terminal
   completion or document replacement. A different browser ID alone is not that proof.
2. If the original profile cannot return, the operator must confirm that the original
   execution environment has been stopped (for example, its Figma page/browser was closed).
   Show the exact file and executor and explain that the action cannot terminate remote
   code. An unreachable machine or an elapsed timeout is not proof. This is an explicit
   operator attestation when machine-verifiable evidence is unavailable, not a claim that
   the software has verified termination. Do not expose a silent noninteractive reset.
3. Under the file gate, compare the selected block revision, persist an abandonment
   tombstone for that execution and retire its old authority, then replace its execution
   exclusion with a required-read marker. Do not clear other blocks or any Stop fence.
   Durability failure leaves the block in place; a stale confirmation cannot clear a
   newer operation. Record the resolution basis and make repeating the same action idempotent.
4. Keep the task inactive. Rebind/resume with a fresh epoch and read the affected canvas
   before writing. Reject late old-generation results as current authority; tombstones
   must survive rollback and subsequent task-state updates.

If the old executor might still be running, closing the original environment is necessary:
invalidating a lease cannot undo an already-dispatched native call. The recovery dialog must
state that limit rather than promising that a button can safely stop unknown remote code.
This path avoids requiring the old browser identity forever without making cold restart
an implicit override.

## Appendix B: Installed hooks and delivery evidence

[`lifecycle.mjs`](../../agent-plugin/src/clients/shared/lifecycle.mjs) is shipped inside
the installed plugin, has a 750 ms total deadline, and uses the old socket or fixed Windows
pipe. Updating the Hub does not update this code. Keep a compatibility listener at the
released path for valid `tempad/client-hook` requests, even while rejecting raw legacy
MCP attachment. Reuse [runtime-paths.mjs](../../agent-plugin/src/clients/shared/runtime-paths.mjs)
for private-root checks, atomic claiming of the legacy root, and ambiguity detection.
Do not redirect or take over a live legacy Hub's endpoint.

The release namespace owns the legacy listener regardless of enrollment, through its
supervisor. Route only to the relevant verified Claude binding in that namespace; never
broadcast an event or choose the foreground/default Figma file. Legacy hooks cannot
disambiguate parallel checkouts; generated checkout hooks use explicit profile descriptors.
Other namespaces use their own endpoints; do not add a cross-profile broadcast router
or let a second supervisor compete for the legacy endpoint.
New hooks carry profile identity and use the new discovery path. Codex remains native-IPC
only; this is not a Codex hook fallback.

During a switch, received lifecycle events enter a bounded durable inbox keyed by
profile and invocation ID with an ordered sequence. Acknowledge only after durable
commit, using the peer's response shape; do not assume commit will fit its deadline.
Once a complete request is admitted for persistence, finish that persistence even if
the hook closes its socket. Acknowledgment loss must not delete the event or trigger
feedback replay. New hooks retry within their host budget with the same invocation ID
and distinguish durable receipt from application; legacy hooks cannot do either reliably.
The Hub deduplicates and applies the inbox before reopening task writes.

The old 750 ms timer covers input reading, connection, persistence, and reply handling;
it is not a server-side disk budget. Measure full invocation-to-reply and durable-commit
latencies (p50/p95/p99 and maximum) under cold start, disk contention, and memory pressure
on each supported platform. Inject slow flush, crash-before-commit, commit-with-lost-ack,
and exit-before-request-arrival. Do not weaken durability to meet a percentile target.
A passing latency sample is not a proof that every legacy invocation can succeed.

Delivery evidence and fallback:

| Observation                                                | Required behavior                                                                                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable inbox record exists, reply was lost                | Consume that record once by invocation ID. Return the same admission receipt to a capable retrying hook; do not repeat effects.                                                                                 |
| Request received but commit fails or remains unconfirmed   | Keep the profile fenced and expose the delivery fault. Receipt-capable hooks retry with the same ID; a timeout is not success.                                                                                  |
| Hook exits before the listener receives a complete request | The server cannot reconstruct or even reliably detect the missing event. Fresh authoritative lifecycle/binding evidence is required before further writes; a socket timer or cached task state is not evidence. |
| Required fresh evidence remains unavailable                | Leave the affected task/profile paused and explain recovery. Do not infer the active conversation from focus, inherited environment, or the previous session.                                                   |

A Figma-local Stop fence protects a known Figma Stop. It cannot replace a missing Claude
`Stop`, `/clear`, or session-binding event. After a switch, reconcile the inbox and require
fresh validated client/session/turn evidence through the existing host-specific mechanism
before resuming writes. Stale pre-switch hooks cannot satisfy that check. A fresh event
cannot prove a missing historical event was delivered; it can only establish a safe current
binding while existing task cancellation and read-back protections remain in force.

The inbox records each invocation's first admitting Hub, plus a durable freshness boundary
when that Hub is replaced. Reattaching the same Hub preserves both; the first Hub can accept
hooks issued while it was starting. Historical delivery may reconcile cancellation, but cannot
activate a session, bind a task, or consume a pending Stop notice. Delivery faults fence admission
until the entire accepted backlog commits or retires, including events received during recovery.

Automatic switching while Claude clients are attached is eligible only after each binding
demonstrates the new receipt/retry contract and its recovery tests pass. Unknown or legacy
hook capability keeps the candidate staged; manual migration remains available with paused
tasks and revalidation. Merely recognizing an installed plugin version is insufficient.
Keep this limit visible rather than claiming guaranteed delivery through the old listener.

Cached Stop notices may be returned only from an authoritative matching binding; do not
fabricate prompts or feedback receipts. The listener preserves existing responses during
normal operation, and only lifecycle events enter its inbox. Routing ambiguity or inbox
exhaustion is a visible failure, not permission to broadcast. Test ordering across `/clear`,
Stop, a later turn, and supervisor recovery; Codex remains native-IPC only.

A pending Claude Figma Stop notice is stored with its cancelled task and consumed in the
same transaction as the hook receipt. A new user turn or ended session retires the old notice;
restoring it never restores session liveness or hook capability. Cancellation remains readable
by older Hubs, but binaries predating this notice field cannot preserve the pending message.
Claude does not support Queue or Steer; its native acceptance covers canvas tools, lifecycle
binding and tool-boundary Stop notices, not Codex-only comment delivery.

## Appendix C: Release policy

The implemented publication gates, cumulative guidance review, release boundaries, and hook
rollout are maintained in [Releasing](../releasing.md#runtime-release-policy). Automatic activation
remains disabled until Phase 4 acceptance; passing artifact checks alone does not enable it.
