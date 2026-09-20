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
expiry, and recovery semantics. Taskless reads still use the active route.

## Connection lifecycle

1. Enabling Agent integration requests optional access to `http://127.0.0.1/*` from the initiating
   user action.
2. The content bridge opens a named runtime port and registers the page session with the broker.
3. The broker starts one WebSocket client for all Figma tabs in the extension context.
4. The client probes the known ports and requests the `tempad-mcp` WebSocket subprotocol before
   receiving any frames. It accepts a candidate only after receiving both `registered` and `state`.
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

The bridge protocol version covers the shared tool contract as well as transport messages. Bump it
whenever a Hub and extension built from different revisions must not exchange tool calls.

Runtime identities record the observed builds; changed source fingerprints, versions,
executable hashes, or build timestamps do not determine compatibility. The modifying
agent decides whether to reuse or refresh the Hub under the
[evolution guide](../testing/agent-authoring-evolution.md#3-establish-a-trustworthy-runtime).
Compatible extension updates can reconnect to the same Hub. Runtime handshakes,
protocol validation, connection ownership, and stale-request checks remain enforced.
Exact checkout matching belongs to preflight and the frozen run record.

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
explicit choice: registering another Figma tab clears the previous choice, and a newly connected
Hub clears an ambiguous choice inherited from its predecessor. Foregrounding a tab does not route
MCP calls; clicking its badge does. Broker activation is sent to the hub only from that explicit
user action. Pending tool results are
bound to the extension connection that received the request, so a second connection cannot satisfy
or reject another connection's request by guessing its id. While an extension connection is active,
the hub accepts replacement activation only from the same extension Origin. Normal reconnects and
all Figma-tab switching inside one extension context keep the current flow; a later connection from
a differently identified extension cannot take over the established route.

Review recovery uses the same registered session inventory. An optional saved review in
`mcp.enable` identifies the task this page is restoring; the broker sends its durable latest
review as `sessions.reviews` only for the matching file and page claim. Hub task records,
not cached capabilities or transport IDs, remain authoritative for sending comments.
`reviewClosed` is a one-way Done fence. The broker persists it together with draft deletion
before acknowledging Done, then synchronizes it on reconnect. `mcp.designReviewClosed`
notifies other registered tabs locally; it never grants a canvas lease. Both browser and
Hub protocol versions advance for this contract.

Stop persists cancellation locally before dispatch. On a connected socket, the broker sends
the explicit Stop action before publishing the cancelled review snapshot. Otherwise the Hub
restores cancellation first and treats Stop as an already-ended task, skipping native host
interruption. The cancelled snapshot still synchronizes when dispatch fails or on reconnect.

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
