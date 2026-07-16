# Local MCP and plugin runtime threat model

This document covers the local path between an MCP client, the `@tempad-dev/mcp` hub, the browser
extension broker, Figma's page world, and the loopback asset HTTP server. It describes the controls
that exist today, including the plugin execution boundary, and the compatibility changes that still
need an explicit product decision.

## Security goals

- A normal web page must not be able to register as TemPad Dev, become active, invoke tools, or read
  and upload assets through the loopback servers.
- One connected extension must not be able to complete or reject another extension's pending tool
  request by guessing its request id.
- A hub candidate must not be able to redirect asset uploads from the extension to a remote host.
- A malformed or excessive asset request must have bounded per-request size, aggregate storage,
  concurrency, headers, and time.
- Plugin failures and mutations must not persist across invocations or indefinitely occupy a Worker.
- Plugin code must not obtain extension privileges, DOM access, persistent browser storage, or a
  network path. Inputs and outputs must be bounded and validated before crossing the boundary.
- These controls must preserve the normal zero-configuration local workflow and existing plugin
  installation flow.

## Trust boundaries and assumptions

The MCP client and hub run with the user's local OS privileges and are trusted with returned design
context. Figma's exact page origin is trusted because the tool runtime depends on `window.figma` in
that page world. The extension broker and the packaged sandbox broker are trusted to validate,
correlate, and bound traffic.

Installed plugin code is untrusted relative to the extension, Figma page, hub, and local machine. A
plugin is intentionally authorized to read the plain design/style data supplied to its hook and to
choose its own generated output. That output remains untrusted content: users and agents must review
it before executing or integrating it.

The application-level isolation boundary is the browser's opaque-origin sandbox document and its
Content Security Policy. Fresh Workers, reduced globals, module lexing, structured payload checks,
timeouts, and termination are additional containment and recovery layers; no single one is treated
as sufficient by itself.

The loopback interface is not an authentication boundary by itself. Browsers, other extensions, and
other processes owned by the same OS user may all be able to reach it. Origin and capability checks
are therefore required even though the listeners bind only to `127.0.0.1`.

## Current controls

### WebSocket hub

- The listener binds to `127.0.0.1` and accepts only the root path without a query string.
- The handshake requires a syntactically valid `chrome-extension://<32-character-id>` Origin.
- `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS` can replace compatibility mode with an exact,
  comma-separated Origin allowlist.
- Concurrent extension connections are capped (16 by default) before registration state is
  allocated. WebSocket messages are capped at 4 MiB, and per-connection errors are contained and
  cleaned up instead of surfacing as unhandled process errors.
- Pending requests record the selected extension connection id. Results or errors from another
  connection are ignored.
- Once an extension connection is active, a different extension Origin cannot replace it. A
  reconnect from the same published or unpacked extension Origin can still become active without a
  prompt or configuration change.
- The broker accepts an advertised asset server only when it is `http://127.0.0.1:<port>` with no
  credentials, query, or fragment. It revalidates every subsequent `state` update and reconnects on
  malformed traffic, duplicate registration, or any endpoint change.

### Asset HTTP server

- Every hub process generates a 256-bit random capability path. The full capability-bearing URL is
  delivered only in the extension handshake and is redacted from request logs.
- Web Origins are rejected. Extension-origin requests must come from the currently active extension,
  and that exact Origin is echoed instead of emitting wildcard CORS. Origin-less local MCP clients
  still authenticate with the capability path.
- Uploads enforce per-asset size, reserve aggregate quota before concurrent bodies are accepted, and
  cap concurrent uploads. Server connections and concurrent downloads are capped; HTTP headers,
  header wait time, request/response time, and keep-alive time are bounded.
- Downloads use attachment disposition, `nosniff`, a restrictive CSP, no referrer, and private cache
  semantics.
- Asset responses remain ephemeral and are not exposed as MCP resources.

### Plugin Workers

#### Installation and source boundary

- Existing `@name`, HTTPS URL, and loopback HTTP development flows require no new configuration.
  Remote plain HTTP, URL credentials, and HTTPS-to-loopback redirects are rejected.
- Live registry responses are bounded to 128 KiB, schema/URL validated, and fall back to the bundled
  snapshot on failure. Registry entries must resolve to HTTPS sources.
- Plugin source is streamed with a 512 KiB limit, HTML responses are rejected, and the final redirect
  URL is revalidated. The fetched source and its SHA-256 digest are stored as a local snapshot;
  updates remain explicit rather than automatic.

#### Execution boundary

- The packaged broker runs in a manifest-declared sandbox page without `allow-same-origin`. Its CSP
  denies all defaults and connections, allows only packaged/blob scripts needed for execution, and
  denies objects, frames, forms, and base-URL changes. The page has an opaque origin and no extension
  runtime APIs.
- Development builds additionally allow scripts and HMR connections from the loopback WXT server so
  the same opaque-origin page can run under Vite. The production manifest retains the connection
  denial and contains no development-server source.
- The sandbox page is web-accessible only to `https://www.figma.com/*`. The UI embeds it as a hidden
  `sandbox="allow-scripts"` iframe, verifies the exact frame window and opaque `null` Origin, and then
  transfers a private `MessageChannel`.
- The broker accepts only two fixed packaged Worker kinds. Requests and responses are limited to
  plain structured data, 4 MiB, depth 64, and 100,000 entries. It caps four active Workers and 32
  queued requests and normalizes error messages to 2,048 characters.
- Codegen and variable transforms use a fresh Worker for every broker request. MCP component
  generation may put up to 32 same-plugin jobs in one request to amortize startup; module state is
  shared only within that batch. Each Worker is terminated after success, failure, unreadable
  messaging, or a five-second timeout, so prototype mutation and other global state do not survive
  into the next batch or tool invocation. The client resets the entire sandbox frame after protocol
  or timeout failures.
- Static imports, dynamic imports, re-exports, import attributes, and source-phase imports are
  rejected before module evaluation by the CSP-compatible `es-module-lexer` JavaScript build.
  Object properties and `import.meta` remain valid; syntax the lexer cannot validate fails closed.
  This scanner is defense in depth: the sandbox CSP remains the network/module-loading boundary.
- Trusted code validates plugin results against the codegen or variable-transform contract before
  using them. Oversized, cyclic, non-plain, malformed, or unsupported values are rejected.

## Residual risks

1. **No mutual hub pairing.** Compatibility mode accepts any syntactically valid Chrome extension
   Origin. An installed malicious extension can race to become the first sole connection, and a
   hostile same-user process can spoof Origin while racing to bind a known hub port. Exact Origin
   configuration narrows the extension side but does not authenticate the hub process to the
   extension.
2. **Origin partitioning is not cryptographic identity.** A differently identified extension cannot
   take over an already-active route, and connection-bound results prevent guessed-id completion.
   This is a useful no-config containment boundary, but it cannot distinguish a same-user process
   that deliberately forges the same Origin header.
3. **Short asset hashes.** The asset protocol uses the existing 8-hex-character content identifier.
   Uploads recompute and verify it, but the collision space is too small to treat the hash as a
   security identity. The random URL capability is the authorization control.
4. **Plugin sandbox scope.** The boundary is designed to contain hostile application-level plugin
   behavior, but it is not a virtual machine or a browser security proof. Browser/JavaScript-engine
   vulnerabilities, side channels, and hard renderer-wide memory exhaustion are out of scope. The
   five-second timeout bounds CPU hangs but is not a memory quota. A plugin can inspect every value
   deliberately passed to its hook and can return misleading or unsafe generated code. Runtime
   regressions cover extension/DOM absence, storage denial, prototype isolation, timeout/recovery,
   module-loading bypasses, payload limits, and zero loopback requests through fetch, WebSocket,
   XMLHttpRequest, EventSource, nested Workers, and `importScripts`; new browser capabilities must be
   reviewed as the platform evolves.
5. **Page-world compromise.** Code executing on the trusted Figma origin can observe design context
   handled by the page runtime. Moving tool execution into a separate privileged context would be a
   different architecture.
6. **Process-local quotas.** The aggregate asset quota is enforced by the current catalog and active
   process. External writes to the asset directory and multiple concurrent hub processes are outside
   that accounting model.

## Versioned hardening plan

The following changes intentionally remain proposals because they affect setup or wire compatibility.

### Optional high-threat pairing mode

The normal local workflow must remain zero-config. If a managed or higher-threat deployment later
needs mutual identity, first add protocol-version and feature negotiation, then design pairing as an
opt-in mode with explicit setup, rotation, recovery, and legacy fallback. It must not silently become
mandatory for Codex, VS Code, Cursor, Claude Code, or manual stdio configurations.

There is no reliable no-config substitute for a shared credential or OS-mediated identity channel:
Origin is public metadata and a same-user process can forge it. The current design therefore uses
Origin partitioning for transparent containment and documents the remaining first-connection race
instead of claiming mutual authentication.

### P1: asset identifier migration

Move new writes from 8 hex characters to at least 32 hex characters while accepting both lengths
during a transition. Advertise the negotiated length in the registration feature list, keep old
catalog entries readable until TTL cleanup, then remove short-hash writes before short-hash reads.

### P2: response continuation contract

If shell responses evolve into opaque cursor-based continuation, add a new optional response field
behind protocol negotiation. Keep the current inline child-id comment during the compatibility
window so older agents do not lose the existing `get_code` recovery path.

## Regression ownership

- Origin, path, capability, CORS, quota, and request-correlation tests live under
  `packages/mcp-server/tests`.
- WebSocket admission and connection-limit tests use a real loopback listener. A full socket
  lifecycle regression covers registration, state broadcast, activation, result/error routing,
  malformed and oversized input, socket-error containment, and disconnect cleanup; sole-connection
  grace logic is covered through the extracted extension registry.
- Handshake and live-state asset URL validation, reconnect, delivery-failure, session-replacement,
  and teardown routing tests live under `packages/extension/tests/mcp/broker`.
- Worker lifecycle and module syntax tests live under `packages/extension/tests/codegen`,
  `packages/extension/tests/mcp/transform-variables`, `packages/extension/tests/plugin-sandbox`, and
  `packages/extension/tests/utils`.
- `packages/extension/scripts/check-plugin-sandbox.ts` builds and loads the release extension in
  Chromium and owns the end-to-end isolation, abuse-bound, termination, and recovery probes.
- Plugin installation URL, registry fallback, size, redirect, integrity, and cancellation tests live
  under `packages/extension/tests/composables`.
- Any change to these boundaries must update this document and its regression tests together.
