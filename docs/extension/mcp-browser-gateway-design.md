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

## Connection lifecycle

1. Enabling Agent integration requests optional access to `http://127.0.0.1/*` from the initiating
   user action.
2. The content bridge opens a named runtime port and registers the page session with the broker.
3. The broker starts one WebSocket client for all Figma tabs in the extension context.
4. The client probes the known ports, then accepts a candidate only after receiving both
   `registered` and `state` messages from the hub. The advertised asset URL must use an explicit
   loopback IPv4 port and cannot contain credentials, a query, or a fragment.
5. Every later `state` message is validated by the same rule and must keep the handshake's exact
   asset endpoint. Malformed traffic, a second registration, or an endpoint change closes that
   socket and resumes the existing reconnect loop.
6. A 20-second ping keeps the Manifest V3 service worker alive. A disconnected content port or
   WebSocket reconnects while its session remains enabled.

The hub chooses the active browser connection. Inside that connection, the broker chooses the
active Figma session. A sole session is selected automatically; switching sessions is explicit.
Broker activation is sent to the hub only from that explicit user action. Pending tool results are
bound to the extension connection that received the request, so a second connection cannot satisfy
or reject another connection's request by guessing its id. While an extension connection is active,
the hub accepts replacement activation only from the same extension Origin. Normal reconnects and
all Figma-tab switching inside one extension context keep the current flow; a later connection from
a differently identified extension cannot take over the established route.

## Assets

The page computes asset hashes and descriptors, then sends at most `MCP_MAX_ASSET_BYTES` through the
bridge. The service worker decodes the payload and uploads it to the hub's loopback asset server.
The page never fetches the loopback server directly. The asset URL contains a random capability
path generated for the hub process; the server also enforces per-asset, aggregate-store, concurrent
upload, header, and request-time limits. It does not emit wildcard CORS.

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
