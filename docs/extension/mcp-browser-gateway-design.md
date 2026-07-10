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
   `registered` and `state` messages from the hub.
5. A 20-second ping keeps the Manifest V3 service worker alive. A disconnected content port or
   WebSocket reconnects while its session remains enabled.

The hub chooses the active browser connection. Inside that connection, the broker chooses the
active Figma session. A sole session is selected automatically; switching sessions is explicit.
Broker activation is sent to the hub only from that explicit user action, so multiple browser
profiles cannot repeatedly steal activation from each other.

## Assets

The page computes asset hashes and descriptors, then sends at most `MCP_MAX_ASSET_BYTES` through the
bridge. The service worker decodes the payload and uploads it to the hub's loopback asset server.
The page never fetches the loopback server directly.

## Trust boundary

Tool execution depends on Figma's page-world API, so scripts on the exact Figma origin are inside the
gateway's trust boundary. A token passed into that same world would not provide meaningful isolation.
The extension boundary instead enforces strict message schemas, exact origins, runtime-port sender
checks, session ownership, pending-call correlation, and payload limits.

Stronger isolation would require moving the tool runtime out of the page world; it is not part of
this design.
