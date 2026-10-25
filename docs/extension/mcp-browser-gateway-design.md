# MCP browser gateway - design

This design keeps local MCP networking inside the extension while the tool runtime stays
in Figma's page world.

## Components

- `composables/mcp.ts` owns one page session and executes MCP tools against `window.figma`.
- `mcp/bridge/content.ts` validates page messages and relays them over an extension runtime port.
- `mcp/broker/service-worker.ts` tracks Figma sessions and routes calls through one background hub
  connection.
- `mcp/broker/hub-client.ts` owns the loopback WebSocket lifecycle.

Shared browser-gateway schemas validate page, session, tool, and asset traffic. Permission requests
use a separate narrow runtime message validated by the background worker.

Explicit design tasks add file leases, fixed session routing, page-side fencing,
and DOM feedback. See [design tasks](mcp-design-tasks.md) for lifecycle, takeover,
expiry, and recovery semantics. Taskless reads use the active route unless they specify an exact
`sessionId` from `list_design_sessions`.

## Connection lifecycle

1. Enabling Agent integration requests optional access to `http://127.0.0.1/*` from the initiating
   user action.
2. The content bridge opens a named runtime port and registers the page session with the broker.
   Each registration rechecks optional loopback permission before starting the Hub connection;
   a cached grant in a surviving content script cannot authorize a restarted worker.
3. The broker starts one WebSocket client for all Figma tabs in the extension context.
4. The client probes the known ports and requests the `tempad-mcp` WebSocket subprotocol before
   receiving any frames. It accepts a candidate only after receiving both `registered` and `state`.
   Release and checkout builds use disjoint port pools from shared constants. A checkout Hub
   announces its real-path profile hash in `registered`; the broker must match it and send
   `runtimeHello` before the Hub registers the connection or exposes state and asset access.
   Missing profile fields mean release. Checkout peers reject missing or different identities
   and never fall back to release ports. Release peers preserve the existing handshake.
   Discovery uses the build profile independently of the runtime fingerprint. A checkout build
   without a valid runtime identity makes no connection attempt. Checkout Hubs close connections
   with code 1008 if the runtime handshake has not completed within five seconds.
   Registration announces `protocolVersion` and the versions the Hub still serves. A Hub that does
   not serve this extension is rejected with instructions to restart the agent's MCP connection
   using `@tempad-dev/mcp@latest`, including other agents keeping an old Hub alive. Reloading Figma
   alone does not update that Hub. The advertised asset URL must use
   an explicit loopback IPv4 port and cannot contain credentials, a query, or a fragment.
5. Every later `state` message is validated by the same rule and must keep the handshake's exact
   asset endpoint. Malformed traffic, a second registration, or an endpoint change closes that
   socket and resumes the existing reconnect loop.
6. A 20-second ping keeps the Manifest V3 service worker alive. A disconnected content port or
   WebSocket reconnects while its session remains enabled.
   Draft requests wait for the initial permission check and session registration. A request
   that opens a replacement runtime port registers its session before forwarding the request.
   A draft request that cannot be forwarded receives an error response instead of being
   silently dropped. A waiting request never carries over into a replacement enable.

Granting loopback access in Chrome settings also triggers a fresh permission check. The broker
notifies Figma content scripts through extension messaging so an enabled page whose initial
check was denied can register without a reload. The notification grants no authority: each
page rechecks permission, disabled pages stay disabled, and a newer revocation wins.

The bridge protocol version covers the shared tool contract as well as transport messages. Bump it
whenever a Hub and extension built from different revisions must not exchange tool calls.

Every bump must include the released-extension transition in the same change: supported wire
versions, request/result adaptations, capability-specific upgrade errors, and mixed-version tests.
Freeze receiving schemas from the released revision rather than importing current shared schemas
in compatibility fixtures. A version bump alone does not complete a migration.

### Protocol 13 transition

The Hub serves both released protocol 13 (extension 0.22.0) and protocol 15 (extension 0.23.0).
Current extensions include `protocolVersion` in `runtimeHello`; a missing field conservatively
selects protocol 13. Package versions and runtime fingerprints do not select capabilities.
An unsupported version or a changed runtime identity/protocol on an open connection closes it.
No tool call is dispatched without a runtime identity. Protocol 13 retains the versioned session,
task, canvas-write, and full-hash asset paths; it does not enter the unversioned read-only adapter.

The session, task, route, and action-result payloads are unchanged from protocol 13. The Hub
rejects `nodeIds`, structure `depth: 0`, and `get_code.resolveTokens: true` with
`EXTENSION_UPGRADE_REQUIRED` before dispatch to that peer. Other released arguments are preserved.
Read responses explicitly identify older selection and token semantics; the Hub neither invents
alias dependencies nor claims consumer-aware token resolution. Exact `nodeId` reads remain the
continuation path. Compatibility notices count toward the same inline response budget.

`pnpm mcp:check-bridge` exercises the built Hub against frozen extension 0.22.0 schemas alongside
current and unversioned peers, covering reads, tasks, writes, assets, reconnects, and routing fences.
Keep protocol 13 for at least one store cycle; removal requires a separate migration decision.

Runtime identities record the observed builds; changed source fingerprints, versions,
executable hashes, or build timestamps do not determine compatibility. The modifying
agent decides whether to reuse or refresh the Hub under the
[evolution guide](../testing/agent-authoring-evolution.md#3-establish-a-trustworthy-runtime).
Compatible extension updates can reconnect to the same Hub. Runtime handshakes,
protocol validation, connection ownership, and stale-request checks remain enforced.
Checkout identity must match during the handshake. Exact source/build matching belongs to
preflight and the frozen run record.

### Released unversioned extensions

Extension 0.20.0 sends no WebSocket subprotocol and strictly rejects extra registration fields.
For these connections the Hub sends only `{type: "registered", id}` and the old state/tool-call
envelopes. It accepts only activation, ping, and tool-result frames. Session inventories, runtime
identity, design actions, and design-task messages are unavailable on this path. Unknown
subprotocols are rejected during the HTTP upgrade.

The active legacy connection can serve taskless `get_code`, `get_screenshot`, and node-based
`get_structure` with their released arguments and result shapes. The internal token tool contract
is retained without changing its public exposure. New arguments such as page identity or native
read-back, and canvas authoring operations, return `EXTENSION_UPGRADE_REQUIRED` before dispatch.
The Hub never fabricates a session or task lease for an old tab. Calls carrying a task id always
resolve their original bound session, even when a legacy connection becomes active or replaces
a disconnected current connection. Current peers still require their runtime identity handshake.

Legacy connections receive a separate random asset capability from the same HTTP server.
That capability permits their 8-character SHA-256-prefix uploads; the current capability continues
to require full SHA-256 uploads. Both use the same Origin checks, quota, concurrent-upload limit,
and store. Legacy retries are fully hashed, and an existing short hash with different full content
returns a collision error without changing its bytes. Existing short-hash downloads remain valid.

Keep this adapter for at least one store cycle. Its removal requires an explicit breaking migration;
see [release coordination](../releasing.md#bridge-protocol-and-release-order).

The hub chooses the active browser connection. Inside that connection, the broker chooses the
active Figma session. A sole session is selected automatically. More than one session requires an
explicit choice: registering another Figma tab clears an automatic choice. An explicit badge choice
survives WebSocket reconnects and is saved in browser session storage for service-worker recovery.
Recovery requires the same session, tab, document, and file; disabling that session, closing its tab,
or changing its document or file clears the saved choice. Storage failure retains the current
worker's choice without guaranteeing recovery after restart. While loading or awaiting a saved
choice, the broker leaves unscoped routing inactive; a fresh tab inventory can release that wait
when it proves the selected tab closed. Foregrounding a tab does not route
unscoped MCP calls; clicking its badge does. Independent read tools can instead pass an exact
`sessionId` returned by `list_design_sessions`; the Hub routes that read to the matching connected
session without changing the active badge. A task-bound read rejects a different explicit session
rather than rebinding the task. Broker activation is sent to the hub only from an explicit user
action. Page-state broadcasts expose the active session ID only to that session itself; the Hub
retains the full inventory for exact routing. Pending tool results are
bound to the extension connection that received the request, so a second connection cannot satisfy
or reject another connection's request by guessing its id. While an extension connection is active,
the hub accepts replacement activation only from the same extension Origin. Normal reconnects and
all Figma-tab switching inside one extension context keep the current flow; a later connection from
a differently identified extension cannot take over the established route.

Versioned peers must send `runtimeHello` before sessions or design actions. A session ID cannot
be claimed by two live connections. Task state and actions are bound to the owning connection;
saved reviews must also match the persisted browser identity and Origin before restoring fences.

Review recovery uses the same registered session inventory. An optional saved review in
`mcp.enable` identifies the task this page is restoring; the broker sends its durable latest
review as `sessions.reviews` only for the matching file and page claim. Hub task records,
not cached capabilities or transport IDs, remain authoritative for sending comments.
`reviewClosed` is a one-way Done fence. The broker persists it together with draft deletion
before acknowledging Done, then synchronizes it on reconnect. `mcp.designReviewClosed`
notifies other registered tabs locally; it never grants a canvas lease. Both browser and
Hub protocol versions advance for this contract.

Stop attempts to persist cancellation locally before dispatch; a storage failure cannot prevent
the Stop action or live task state from reaching its destination. On a connected socket, the broker sends
the explicit Stop action before publishing the cancelled review snapshot. Otherwise the Hub
would restore cancellation first and treat Stop as an already-ended task. The cancelled snapshot
still synchronizes after a failed dispatch or reconnect, including after page reload. A verified
restored Stop attempts native interruption before cancellation; absent native turn identity cannot
guarantee interruption, but never removes the canvas fence.
Hiding a stopped review does not discard its cancellation. The page and broker retain the live
Stop fence when storage fails. The content bridge also retains the latest matching review and
marks local Stop before forwarding it, so a replacement service worker receives cancellation in
the replayed enable even if storage is still unavailable. A stale active update cannot undo that
Stop. Another tab's live review does not become this page's claim, while cancellation and Done
fences can synchronize from any tab in the same file. Changing file/session or disabling the
bridge clears its cache; if all surviving page and worker state is lost before persistence or
Hub delivery, the unpersisted Stop cannot be recovered.
Even with a surviving page, a failed `storage.local.get` during worker replacement can lose the
saved browser identity. The replacement then connects with a new browser ID, so the Hub rejects
reviews bound to the previous identity. The page still enforces its local Stop fence; its cached
cancellation alone cannot establish the old browser identity.
Closing that review still requires a durable receipt, and reconnect processes Stop before Done.

Mutating tool waits warn at their configured timeout and stop waiting after twice that interval.
An unknown outcome keeps the file operation fenced until a definitive result or session recovery;
the error explicitly forbids replaying the write. When a dispatched write's caller stops waiting
because of cancellation, timeout, or disconnection, that file also requires a successful
`get_structure` or `get_code` read before further writes. A late result releases the execution
fence but does not clear this read requirement, which survives Stop and beginning a fresh task.
A completed write whose result cannot be formatted or fit the inline budget also requires readback.
`EXTENSION_RESULT_LOST` also covers page-to-extension result transfer failure after execution.
`CANVAS_APPLY_FAILED` remains an uncertain outcome, including failures from older extensions.
Current extensions return `CANVAS_APPLY_ABORTED` only at gates that prove authoring execution has
not started, including broker/page rejection, editor availability, schema/theme validation, and
markup parsing. The diagnostic retains the original error code. These failures do not require a
file readback. Reconciliation preflight can import library resources before the Undo boundary,
so its failures return `CANVAS_APPLY_FAILED` even when the original cause is a validation error.
Undo-boundary failures retain the requirement even if the
protected snapshots match: those checks do not prove that every native resource field or
concurrent user edit was restored. Uncoded or unknown error codes from dispatched writes also
retain readback, including result-transfer failures from older peers. Only the positive
`CANVAS_APPLY_ABORTED` and `EXTENSION_DELIVERY_FAILED` outcomes release a failed dispatched
write's marker. Other diagnostics can originate inside a mutation on supported older peers,
so they retain readback even when a particular rejection happened before writing.
The Hub persists a file read marker before dispatch and retires it only after a definitive usable
outcome or a qualifying read. Thus a Hub restart, including while the write is still running,
retains the requirement. A failed marker save prevents dispatch; a failed clear retains the fence.
A qualifying read returns at least one structure root or code result, or an exact page snapshot
(which can confirm an empty page). Empty selections and batches containing only errors do not
acknowledge it. This recovery gate is file-scoped: a qualifying read by any caller clears it for
that file; it does not prove that the original caller inspected every affected node. Task-specific
resume read requirements remain bound to their task and owner.
A failed initial page-port delivery reports
`EXTENSION_DELIVERY_FAILED`, which releases the operation because execution never started;
`EXTENSION_DISCONNECTED` remains an unknown outcome after delivery. Incompatible saved task records retain a durable
file fence while valid records recover independently. An unreadable snapshot with no identifiable
file boundary preserves its evidence and blocks all writes, allowing read tools to remain available.

Peers may negotiate terminal receipts through an optional registration offer and runtime hello;
released peers retain their existing messages. A surviving worker can resend only a completed
call's receipt after reconnecting. The optional `durableTerminalReceipts` offer/hello allows
receipts from a previous Hub generation; it is sent only when the receiver offers it, preserving
released strict hello schemas. The Hub checks the persisted original request,
receipt identity, browser and extension Origin, and exact Figma session, file, tab and document
before releasing that operation. It never replays the write. If the original result was lost,
`EXTENSION_RESULT_LOST` requires reading the original target; recovered writes require a
successful `get_structure` or `get_code` read of that file before another write, including calls
without a task. A disconnect reported before the receipt arrives also warns that the write outcome
is unknown and must not be replayed. Unfinished receipt records are bounded by rejecting new calls
before dispatch, and completed receipts are acknowledged idempotently while retained. Unresolved
writes persist in task storage before dispatch, including for peers without receipts; their
files stay blocked across cold restarts. Reads cannot clear this exclusion. Original-browser
tab closure or document replacement can release it; a different browser ID and ordinary idle
snapshots cannot. A lost worker cannot reconstruct receipts. Operator recovery then requires
the interactive CLI described in the [MCP README](../../packages/mcp-server/README.md#task-storage-recovery),
preserves Stop and records abandonment plus mandatory readback atomically. No page bridge exposes
that control. Peers without durable receipts cannot transfer unresolved writes during a planned
runtime switch.

## Assets

For outbound assets, the page computes hashes and descriptors and sends at most
`MCP_MAX_ASSET_BYTES` through the bridge; the service worker decodes and uploads the bytes to the
hub. For inbound canvas assets, the page sends only the hash; the service worker downloads a bounded
body, verifies its digest, and returns the bytes through the same validated bridge. The page never
fetches the loopback server directly. The asset URL contains a random capability path generated for
the hub process; the server also enforces per-asset, aggregate-store, concurrent upload, header, and
request-time limits. It does not emit wildcard CORS.

## Trust boundary

Tool execution depends on Figma's page-world API, so scripts on the exact Figma origin are inside the
gateway's trust boundary. A token passed into that same world would not provide meaningful isolation.
The page-to-extension boundary instead enforces strict message schemas, exact origins, runtime-port
sender checks, session ownership, pending-call correlation, and payload limits.

The extension-to-loopback boundary is separate. The hub rejects non-extension WebSocket Origins and
non-root handshake paths. Deployments can configure an exact extension Origin allowlist; the default
accepts any syntactically valid Chrome extension Origin for compatibility. Active-route replacement
is partitioned by Origin without adding configuration. The asset capability is shared only over the
hub connection, and every advertised endpoint is rejected if it is not an explicit IPv4 loopback
URL. These controls defend against ordinary web origins, late cross-Origin takeover, and accidental
cross-profile response spoofing—not against a malicious same-user process that can forge headers or
win the first-connection race.

Stronger isolation would require moving the tool runtime out of the page world; it is not part of
this design. An optional high-threat pairing mode would require an explicit product and migration
decision; it is not a hidden prerequisite for the normal flow. See the
[local MCP threat model](../security/local-mcp-threat-model.md).
