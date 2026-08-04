# TemPad Context Provider Runtime and SDK Design

Status: draft

## Summary

TemPad Dev MCP should evolve from a Figma-oriented MCP bridge into a
provider-oriented Context Hub for coding agents.

The hub remains the MCP-facing gateway used by Claude Code and similar clients.
External runtimes connect to the hub as context providers. A provider can be a
Chrome extension, web prototype runtime, Storybook addon, Figma bridge, mock API,
product notes adapter, or any future source of implementation context.

The core design decision is to keep context content flexible while standardizing
the provider contract:

- Do not define one universal design handoff schema.
- Do define a stable provider protocol for connection, identity, activation,
  self-describing context retrieval, lifecycle, errors, and assets.
- Do provide an SDK so provider authors do not implement WebSocket lifecycle,
  activation, dispatch, and error handling themselves.
- Do expose a very small stable MCP surface to agents. For v0, third-party
  provider integration should be centered on one self-describing `get_context`
  tool rather than provider-specific RPC actions.

Success for v0 is not a perfect context schema. Success is that one real
provider can plug in easily, the hub can expose it cleanly, and a coding agent
can retrieve useful context without relying on a rigid universal data model.

## Problem Statement

Vibe-coded prototypes and other interactive runtimes often know things static
design artifacts do not:

- what is currently visible
- what the user has selected
- what state the runtime is in
- what mock data is being rendered
- what interactions exist
- which constraints matter for implementation
- which visual details require fidelity
- which prototype code is only scaffolding

Today, TemPad Dev MCP exposes useful Figma-derived context through a small set
of tools. That model is valuable, but it is too narrow for a provider ecosystem.
The runtime that knows the useful context may not be Figma. It may be a browser
prototype, Storybook story, dev server, product notes adapter, or repository
component mapper.

The key challenge is not to define a universal screen/component/token schema.
The key challenge is to define:

1. how providers connect
2. how providers identify themselves
3. how providers are activated for an agent session
4. how agents retrieve self-describing provider context
5. how large follow-up context is referenced and expanded
6. how provider integrations are made easy and safe through an SDK

## Goals

### Primary Goals

- Define a stable external provider contract.
- Keep provider context content flexible and provider-defined.
- Provide a provider SDK for browser and Node-like runtimes.
- Let TemPad Dev MCP aggregate multiple providers and expose them through MCP.
- Support both first-party and third-party providers.
- Minimize v0 protocol surface.
- Preserve the existing Figma MCP tools; do not force them into the third-party
  provider SDK abstraction in v0.

### Secondary Goals

- Support explicit activation and user-visible active provider state.
- Support permission scopes.
- Leave room for provider-specific actions later, without making them part of
  the v0 third-party provider contract.
- Support provider capability updates after registration.
- Make the system usable with agent skills.
- Keep large assets and binary resources out of inline tool results.

## Non-Goals

- Defining a universal design handoff schema.
- Requiring every provider to return structured screen, component, token, or flow
  objects.
- Requiring providers to implement MCP directly.
- Replacing the current Figma MCP tools in v0.
- Making provider-specific actions part of the v0 third-party provider contract.
- Treating prototype source code as authoritative production architecture.
- Solving full visual diffing, end-to-end testing, or Figma interoperability in
  v0.
- Supporting remote multi-tenant provider hosting in v0.

## Core Principles

### Context Is Flexible

The content returned by providers should remain flexible. A provider may return:

- natural language
- Markdown
- JSON
- source snippets
- DOM summaries
- component usage notes
- screenshots
- mock data
- runtime state
- design tokens
- resource links
- provider-specific blobs

The protocol should only standardize the transport-level envelope for mixed
content. It should not standardize provider business semantics unless a later
feature requires deterministic handling.

### Provider Contract Is Stable

The provider-facing contract should be stable and versioned. It should cover:

- connection
- handshake
- provider identity
- capability discovery
- activation and deactivation
- self-describing context retrieval
- follow-up ref expansion
- lifecycle and health
- errors and cancellation
- asset/resource references

### MCP-Facing and Provider-Facing Protocols Are Separate

The agent-facing protocol is MCP. The provider-facing protocol is a TemPad
provider protocol, initially JSON-RPC over WebSocket.

This separation keeps compatibility with MCP clients while allowing lightweight
runtime integrations that do not need to know MCP details.

### The Hub Is Not a Provider

The MCP server package should act as a Context Hub and MCP Gateway. It should:

- accept provider connections
- manage provider sessions
- manage active providers
- route MCP calls to providers
- aggregate or group provider results
- enforce permissions and budgets
- host asset/resource indirection

The TemPad Dev Chrome extension may become a provider implementation over time,
but the third-party provider SDK should be validated without changing the
current Figma MCP tools in v0.

### Instructions Matter

Provider instructions are first-class. Since context content is flexible, the
agent needs guidance about how to use each provider. Provider instructions are
more valuable than rigid schema names for many integration scenarios.

The generic MCP server instructions should teach the agent to list providers,
call `get_context` for active providers, read the returned self-description, and
treat provider-specific content as contextual evidence.

Provider-specific instructions should teach the agent how to interpret that
provider's context.

## High-Level Architecture

```txt
Claude Code / Cursor / other MCP clients
        |
        | MCP over stdio or Streamable HTTP
        v
TemPad Dev MCP
Context Hub + MCP Gateway
        |
        | Provider Protocol over WebSocket
        | In-process provider adapter
        | Future adapter types
        v
Context Providers
  - TemPad Dev Chrome extension
  - Web prototype runtime
  - Storybook provider
  - Figma bridge
  - Mock API provider
  - Product notes provider
  - Repository component mapper
```

## Terminology

### Provider

A runtime or adapter that can return context to the hub. Providers do not need
to implement MCP. They implement the TemPad provider protocol or use the
provider SDK.

### Provider Session

A concrete connection between one provider instance and the hub. For example,
two browser tabs using the same provider package are two provider sessions.

### Provider Manifest

The provider's self-description: id, title, version, instructions, capabilities,
supported scopes, and optional metadata.

### Capability

A provider-declared capability. In v0, the only required context capability is
self-describing context retrieval. Provider-specific actions are deferred.

### Context Content

Mixed content returned by a provider. The transport-level shape is standardized,
but the meaning of the content is provider-defined.

### Resource

A larger context item or asset referenced by a provider. In v0, provider-owned
follow-up context uses provider-local refs that can be expanded through
`get_context`. Asset bytes can be downloaded through hub-hosted HTTP asset URLs
when the provider returns them.

### Active Provider

A connected provider session that the user has chosen as the current context
source. v0 supports a single active provider. Connected does not imply active.

## Current Implementation Baseline

The current implementation already has the shape of a provider protocol:

- The hub starts an MCP server for consumer sessions.
- The hub starts a local WebSocket server for the Chrome extension.
- The extension connects to one of several candidate localhost ports.
- The hub assigns an id and sends `registered`.
- The hub broadcasts `state` with active id, provider count, port, and asset
  server URL.
- The extension sends `activate`.
- The hub forwards `toolCall` messages to the active extension.
- The extension returns `toolResult`.

This should be generalized:

- Rename extension concepts to provider concepts.
- Add provider-initiated `hello` registration.
- Add provider manifest and capabilities.
- Add a generic self-describing `get_context` flow for third-party providers.
- Move connection and dispatch logic from provider implementations into an SDK.
- Keep current Figma tools unchanged in v0.

## Compatibility Research

This design is constrained by current coding-agent MCP support rather than the
ideal MCP feature set.

As of April 2026, mainstream coding agents do not expose MCP capabilities
uniformly:

| Host / agent                        | Observed MCP support                                                                                                                                                                                                                                | Design consequence                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                         | Supports stdio, Streamable HTTP, SSE, dynamic `list_changed`, resources through `@` references, prompts as slash commands, elicitation, and tool-search. It also applies MCP output limits and truncates tool descriptions and server instructions. | Claude Code can use the richer MCP surface, but v0 should still keep tool descriptions concise, keep outputs small, and avoid requiring resources/prompts for the core workflow. |
| OpenAI Codex CLI / IDE              | Supports configured MCP servers through Codex configuration and supports per-server/per-tool approval settings for MCP tools.                                                                                                                       | Treat tools as the portable interface. Do not require MCP resources, prompts, sampling, or dynamic top-level tools for v0.                                                       |
| VS Code / GitHub Copilot agent mode | VS Code supports MCP tools and now supports authorization, prompts, resources, and sampling. It also has explicit tool pickers, approval controls, and a maximum enabled-tool count per request.                                                    | The design can offer optional MCP resources, but the default path should be a small stable tool surface to avoid tool-count and approval friction.                               |
| GitHub Copilot cloud agent          | Repository-configured MCP support is tool-only; resources and prompts are not supported, and configured tools may be used autonomously without per-call approval.                                                                                   | Do not expose provider activation as a normal MCP tool. Keep `get_context` read-only, and support tool allowlisting.                                                             |
| Cursor                              | Native MCP configuration is supported and the agent uses configured MCP tools when relevant; users can enable or disable tools.                                                                                                                     | Tool descriptions and agent/project instructions must be enough for the model to discover the workflow. Resources cannot be the only path.                                       |
| Gemini CLI                          | MCP discovery primarily registers tools; docs explicitly say Gemini CLI primarily focuses on tool execution and closes connections that provide no usable tools. Tool results can include rich content blocks and resource links.                   | A resource-only provider would fail or be ignored. `get_context` must be a tool, and it must carry enough self-description for the model to use without MCP resources.           |
| Cline                               | MCP tools and resources are surfaced in Cline's system prompt. Tools are invoked through `use_mcp_tool`; resources through `access_mcp_resource`.                                                                                                   | Tool-first design works, and optional resource exposure can improve UX.                                                                                                          |
| Continue                            | MCP servers only work in Agent mode and are used to give the agent more tools.                                                                                                                                                                      | Treat MCP tools as the dependable integration path.                                                                                                                              |

Sources:

- MCP specification: tools, resources, prompts, capability negotiation, resource
  links, and optional `listChanged` support:
  https://modelcontextprotocol.io/specification/2025-06-18/basic/index,
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools,
  https://modelcontextprotocol.io/specification/2025-06-18/schema
- Claude Code MCP documentation:
  https://code.claude.com/docs/en/mcp
- OpenAI Codex MCP configuration:
  https://developers.openai.com/codex/config-reference
- VS Code MCP and agent-tool documentation:
  https://code.visualstudio.com/blogs/2025/06/12/full-mcp-spec-support,
  https://code.visualstudio.com/docs/copilot/agents/agent-tools
- GitHub Copilot cloud agent MCP documentation:
  https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/extend-cloud-agent-with-mcp
- Cursor MCP documentation:
  https://docs.cursor.com/advanced/model-context-protocol
- Gemini CLI MCP documentation:
  https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
- Cline MCP documentation:
  https://docs.cline.bot/mcp/mcp-marketplace,
  https://docs.cline.bot/mcp/adding-and-configuring-servers
- Continue MCP documentation:
  https://docs.continue.dev/reference/continue-mcp

### Compatibility Conclusions

The v0 MCP surface must be tool-first.

MCP resources, prompts, subscriptions, elicitation, sampling, dynamic
`list_changed`, and resource links are useful enhancements, but at least one
important coding-agent host either does not support them or does not make them
model-initiated in the way this design needs.

Therefore:

- `get_context` is the only new third-party provider MCP tool in v0.
- Provider-owned resources may also be exposed through MCP resources when a host
  supports them, but every important resource must be reachable through
  `get_context`.
- Provider prompts may be added later, but no v0 workflow depends on them.
- Provider activation is user-mediated, not a normal agent tool.
- Top-level MCP tool names are stable; provider-specific context semantics are
  data returned by `get_context`.
- The tool count stays small to work in hosts with tool-count limits and to
  avoid noisy selection.
- Dynamic provider capability changes do not require dynamic MCP tool
  registration in v0.
- Large content is paged, linked, or expanded through provider-defined follow-up
  `get_context` input; inline tool outputs stay below conservative limits.
- Provider instructions and tool descriptions must be concise, with critical
  guidance first.

## MCP-Facing Layer

TemPad Dev MCP should expose a small stable tool surface to coding agents.

### v0 MCP Tools

All v0 MCP tools should be stable, low-count, and safe to expose in clients that
only support tools. Their descriptions should explicitly say that providers do
not parse natural language. The agent should ask for context, read the returned
self-description, and use any returned refs for follow-up expansion.

Safety profile:

- `get_context`: read-only, but may expose external/runtime data.

#### `get_context`

Returns a self-describing context package from the active provider.
This is the core third-party provider tool in v0.

`get_context` is not a natural-language query API. Providers should not be
expected to parse arbitrary agent prompts. The input may carry structured hints,
but providers may ignore them and return their current best self-description.

Input:

```ts
type GetContextInput = {
  input?: unknown
}
```

Rules:

- If there is no active provider, return a clear error telling the user to
  activate a provider from the TemPad or provider UI.
- The hub does not synthesize or summarize provider content in v0.
- `input` is provider-defined. The hub forwards it unchanged and does not
  validate provider-specific semantics.
- Calling `get_context` with no input asks the active provider for its default
  self-describing context package.
- Providers may use `input` for follow-up expansion, filtering, snapshot
  options, viewport choices, or provider-specific commands.
- Providers should keep the default response useful and bounded. They should
  include critical summary, instructions, warnings, and provider-defined refs for
  heavier data.

Output:

```ts
type GetContextOutput = {
  providerSessionId: string
  title: string
  context: ProviderContextPackage
  warnings?: string[]
}
```

```ts
type ProviderContextPackage = {
  provider: {
    manifestId: string
    title: string
    version?: string
  }
  scope?: Record<string, unknown>
  summary?: string
  instructions?: string
  items: ContextItem[]
  refs?: ContextRef[]
  warnings?: string[]
  generatedAt?: string
}

type ContextItem = {
  id: string
  title: string
  kind?: string
  mimeType?: string
  content?: ContextContent[]
  description?: string
  priority?: 'high' | 'medium' | 'low'
  freshness?: 'static' | 'snapshot' | 'live'
  tags?: string[]
}

type ContextRef = {
  id: string
  title: string
  description?: string
  kind?: string
  mimeType?: string
  tags?: string[]
  sizeHint?: 'small' | 'medium' | 'large'
  input?: unknown
}
```

`refs` are provider-defined follow-up handles, not public URI contracts. A ref
may include an `input` object that can be passed back to `get_context`.

### Activation Is User-Mediated

Provider activation is not a default MCP tool in v0. Activation grants access to
runtime context and should be user-visible.

Providers can be activated from:

- provider-side UI, such as "Connect to Agent"
- a TemPad Hub UI
- trusted first-party auto-activation policies

A future `providers_request_activation` MCP tool may ask the host UI to request
user approval, but agents should not silently activate providers themselves.

### Why Not Provider-Specific Actions in v0

Provider-specific actions may be useful later, but they are not required for the
third-party provider v0. A self-describing context package gives the agent a
simple and portable way to consume provider context without turning the provider
SDK into a generic RPC system.

Promoting provider actions into top-level MCP tools creates several problems:

- MCP tool space becomes noisy.
- Tool names can conflict across providers.
- Providers are pressured into over-designing action schemas.
- Some MCP clients do not handle tool list changes consistently across a live
  session.
- The hub's public contract becomes provider-dependent.

Wrapping every provider action behind one generic RPC tool has a different
problem: the model loses the native affordances of explicit tool names and
schemas, and host-level approvals become coarse.

The v0 design therefore keeps third-party providers focused on `get_context`.
Common actions can be added later only after they prove stable and broadly
useful.

## Provider-Facing Protocol

### Transport

v0 uses JSON-RPC 2.0 over WebSocket for external runtime providers.

Reasons:

- Browser runtimes can implement it easily.
- It supports request/response and notifications.
- It maps well to lifecycle events and context requests.
- It is easy to wrap in an SDK.

The hub may also support in-process provider adapters for built-in providers.
Those adapters should implement the same provider interface internally.

### WebSocket Endpoint

The hub listens on localhost using configured candidate ports. v0 should keep
the existing port candidate strategy and add a provider path if useful:

```txt
ws://127.0.0.1:<port>/provider
```

The current implementation does not require a path; v0 can maintain backwards
compatibility by accepting both root and `/provider`.

### Authentication and Pairing

Generic browser-based providers must not be trusted only because they can reach
localhost.

v0 should include a pairing token:

- The hub generates a random token at startup.
- Provider SDK sends the token during handshake.
- The hub rejects providers without a valid token.
- First-party extension distribution can hide token retrieval behind existing
  setup UI.
- Third-party providers can obtain the token from a user-visible pairing flow or
  local config.

The hub should also apply origin checks where available:

- allow known extension origins for first-party providers
- allow configured localhost origins for dev servers
- reject unexpected browser origins unless paired

### Provider Manifest

```ts
type ProviderManifest = {
  id: string
  title: string
  version?: string
  instructions?: string
  capabilities: {
    context?: boolean
    subscribe?: boolean
  }
  scopes?: PermissionScope[]
  metadata?: Record<string, unknown>
}
```

`id` identifies the provider implementation, not the connection. The hub assigns
a separate `providerSessionId` for each connection.

Examples:

- `tempad.chrome`
- `prototype.runtime`
- `storybook.local`
- `product-notes`

Provider-specific actions are intentionally not part of this v0 manifest.

### Permission Scopes

Recommended v0 scopes:

- `context:read`
- `runtime:inspect`

Reserved for later:

- `runtime:control`
- `filesystem:read`
- `network:read`

The default activation scope should be:

```txt
context:read
runtime:inspect
```

`runtime:control` should not be granted by default in v0.

## Provider Protocol Methods

### `provider.hello`

Provider registers itself with the hub.

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "provider.hello",
  "params": {
    "protocolVersion": "tempad-context-provider/0.1",
    "token": "<pairing-token>",
    "manifest": {
      "id": "tempad.chrome",
      "title": "TemPad Dev Chrome Extension",
      "version": "0.1.0",
      "instructions": "Provides runtime context from the active browser tab.",
      "capabilities": {
        "context": true,
        "subscribe": false
      }
    }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "providerSessionId": "provider-session-abc",
    "status": "registered",
    "requiresActivation": true,
    "assetServerUrl": "http://127.0.0.1:8128"
  }
}
```

### `provider.activate`

Hub asks the provider to become active for a consumer session.

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "provider.activate",
  "params": {
    "agentSession": {
      "id": "consumer-session-123",
      "projectRoot": "/Users/yiling/project"
    },
    "scopes": ["context:read", "runtime:inspect"]
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "status": "activated",
    "summary": "Active tab is a web prototype at http://localhost:5173/settings/mcp"
  }
}
```

### `provider.deactivate`

Hub asks the provider to leave the active pool for a consumer session.

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "provider.deactivate",
  "params": {
    "agentSession": {
      "id": "consumer-session-123"
    }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "status": "deactivated"
  }
}
```

### `provider.getContext`

Hub asks a provider for a self-describing context package. The request is
structured and providers should not parse natural-language prompts.

Request:

```ts
type ProviderGetContextRequest = {
  input?: unknown
}
```

Response:

```ts
type ProviderGetContextResponse = ProviderContextPackage
```

Provider guidance:

- Return a useful default package when `input` is omitted.
- Keep the default package concise and directly readable by a coding agent.
- Include self-describing titles, kinds, MIME types, summaries, warnings, and
  instructions where useful.
- Use provider-defined refs for heavier follow-up context instead of returning
  everything inline.
- Do not generate summaries from the agent's prompt.
- Treat `input` as provider-defined data. If the provider does not understand
  it, return a clear provider-level warning or fall back to the default package.

```ts
type ProviderContextPackage = {
  provider: {
    manifestId: string
    title: string
    version?: string
  }
  scope?: Record<string, unknown>
  summary?: string
  instructions?: string
  items: ContextItem[]
  refs?: ContextRef[]
  warnings?: string[]
  generatedAt?: string
}
```

### `provider.ping`

Health check. Either side may send a ping request.

Response:

```ts
type ProviderPingResponse = {
  ok: boolean
  timestamp: number
}
```

### `provider.capabilitiesChanged`

Provider notification. Sent when instructions, metadata, or capabilities change.

Notification:

```json
{
  "jsonrpc": "2.0",
  "method": "provider.capabilitiesChanged",
  "params": {
    "manifest": {
      "id": "prototype.runtime",
      "title": "Prototype Runtime",
      "capabilities": {
        "context": true
      }
    }
  }
}
```

The hub should update provider metadata. The hub does not need to create new
top-level MCP tools in v0.

### `provider.contextChanged`

Provider notification. Sent when current runtime context changes, such as route,
selection, story, or active frame.

Notification:

```json
{
  "jsonrpc": "2.0",
  "method": "provider.contextChanged",
  "params": {
    "summary": "Current route changed to /settings/mcp",
    "hints": {
      "route": "/settings/mcp"
    }
  }
}
```

v0 may record this state for debugging or provider UI, but does not need push
notifications to MCP clients.

### `provider.dispose`

Provider tells the hub it is intentionally disconnecting.

Notification:

```json
{
  "jsonrpc": "2.0",
  "method": "provider.dispose",
  "params": {
    "reason": "tab closed"
  }
}
```

## Context Content Model

The content model is a transport envelope, not a design schema.

```ts
type ContextContent = TextContent | JsonContent | ImageContent | ResourceContent

type TextContent = {
  type: 'text'
  text: string
  mimeType?: string
  title?: string
}

type JsonContent = {
  type: 'json'
  value: unknown
  title?: string
}

type ImageContent = {
  type: 'image'
  data?: string
  uri?: string
  mimeType: string
  title?: string
}

type ResourceContent = {
  type: 'resource'
  uri: string
  title?: string
  mimeType?: string
  description?: string
}
```

Rules:

- Prefer `resource` for large content.
- Avoid inline base64 images by default.
- Inline `image.data` may be allowed for small thumbnails, subject to hub limits.
- `json.value` is provider-defined.
- `text.mimeType` can be `text/markdown`, `text/plain`, `text/typescript`,
  `text/css`, or another useful type.
- Linked resources should be stable for the provider session.
- Provider-local follow-up context should normally use `ContextRef`, not
  `ResourceContent`.

### MCP Resources as an Optional Mirror

When the host supports MCP resources well, the hub may also expose provider
resources through MCP `resources/list`, `resources/read`, and resource
templates. This is an enhancement only.

The compatibility baseline remains:

- `get_context` returns the initial self-describing context package.
- `get_context({ input })` sends provider-defined follow-up input.

No provider should require the MCP host to support resources for basic use.

## Context Ref and Asset Design

Third-party provider follow-up context can use provider-defined refs returned
inside `ProviderContextPackage.refs`. A ref may include the exact input needed
to expand it.

Example:

```ts
{
  refs: [
    {
      id: 'current-page/mock-data',
      title: 'Mock data for current page',
      kind: 'mock-data',
      mimeType: 'application/json',
      sizeHint: 'medium',
      input: {
        ref: 'current-page/mock-data'
      }
    }
  ]
}
```

The agent expands a ref by calling:

```ts
get_context({ input: { ref: 'current-page/mock-data' } })
```

Refs are intentionally not a global resource URI system in v0. They are
provider-defined hints that are only meaningful when passed back to that
provider through `get_context`.

For asset bytes hosted by the hub, providers should upload assets to the hub's
asset server and return asset descriptors or HTTP URLs as `ContextContent`
resources. This keeps MCP tool results small and consistent with the existing
asset indirection strategy.

## Figma Tools Stay Separate in v0

The existing TemPad Dev Chrome extension and Figma MCP tools should not be
forced into the third-party provider SDK abstraction in v0.

Keep the current top-level Figma tools unchanged:

- `get_code`
- `get_structure`
- `get_screenshot` (internal or hidden where appropriate)
- `get_token_defs` (internal or hidden where appropriate)
- `get_assets` (hub-owned asset resolver)

Reasons:

- They are already high-value, stable, schema-rich MCP tools.
- They are already usable by current clients and instructions.
- Wrapping them behind a generic provider RPC would reduce tool-name and schema
  clarity for agents.
- The third-party provider SDK can be validated independently with simpler
  prototype/runtime providers.

Future work may add a Figma context provider that returns a self-describing
`get_context` package for the active selection, but that should be additive. It
should not replace or hide the current Figma MCP tools until the provider model
has proven useful.

## Activation Model

Activation is explicit and user-visible.

Connected providers are available. Activated providers are used by default for
the current MCP consumer session.

### Provider-Side Activation

A provider UI may expose actions such as:

- Connect to Agent
- Activate for TemPad MCP
- Use this prototype as context

Provider-side activation sends a provider notification or request to the hub. The
hub updates active state and broadcasts it to providers.

### Agent-Side Behavior

An agent should not silently activate providers through MCP in v0. It only calls
`get_context`. If no provider is active, the tool returns an actionable error
asking the user to activate a provider in the TemPad or provider UI.

### Auto Activation

The existing behavior of auto-activating the sole provider after a grace period
is useful for first-party flows. For generic providers, v0 should keep this
configurable:

- enabled by default for trusted first-party providers
- disabled or approval-gated for untrusted third-party providers

### Active Provider

v0 intentionally supports only one active provider for the MCP context-provider
flow. Multi-provider aggregation can be added later if real workflows need it.

## Provider SDK Design

### Package Name

Recommended package:

```txt
@tempad-dev/context-provider
```

Optional internal packages:

```txt
@tempad-dev/context-protocol
@tempad-dev/provider-ws
```

The public provider author experience should start with
`@tempad-dev/context-provider`.

### SDK Responsibilities

- WebSocket connection and reconnect.
- Port candidate probing.
- Pairing token handling.
- Provider handshake.
- Active state tracking.
- Activation and deactivation helpers.
- Context provider callback registration.
- JSON-RPC request/response handling.
- Error serialization.
- Timeout and cancellation handling.
- Asset upload helper.
- Capability update notifications.
- Context change notifications.
- Browser and Node transport adapters.

### Provider Author API

```ts
import { createContextProvider } from '@tempad-dev/context-provider'

const provider = createContextProvider({
  id: 'prototype.runtime',
  title: 'Local Prototype Runtime',
  version: '0.1.0',
  instructions: [
    'Provides context from the currently running prototype.',
    'Use this provider to understand visible UI, runtime state, mock data,',
    'interactions, screenshots, and implementation notes.',
    'Prototype code is reference behavior, not final architecture.'
  ].join('\n')
})

provider.getContext(async ({ input }) => {
  if (isObject(input) && input.ref === 'current-page/mock-data') {
    return {
      summary: 'Mock data used by the current prototype page.',
      items: [
        {
          id: 'current-page/mock-data',
          title: 'Mock data for current page',
          kind: 'mock-data',
          mimeType: 'application/json',
          content: [
            {
              type: 'text',
              mimeType: 'application/json',
              text: JSON.stringify(collectMockData(), null, 2)
            }
          ]
        }
      ]
    }
  }

  return {
    summary: 'Current page is the MCP server settings prototype.',
    instructions:
      'Use this context as implementation guidance. Prototype code is reference behavior, not final architecture.',
    items: [
      {
        id: 'current-page/overview',
        title: 'Current page implementation overview',
        kind: 'implementation-overview',
        mimeType: 'text/markdown',
        priority: 'high',
        content: [
          {
            type: 'text',
            mimeType: 'text/markdown',
            text: [
              'Implementation context:',
              '- Render configured servers from mock data.',
              '- Empty state shows an Add Server call to action.',
              '- Failed state keeps Retry visible.',
              '- Visual precision is less important than behavior for this task.'
            ].join('\n')
          }
        ]
      }
    ],
    refs: [
      {
        id: 'current-page/mock-data',
        title: 'Mock data for current page',
        kind: 'mock-data',
        mimeType: 'application/json',
        sizeHint: 'medium',
        input: {
          ref: 'current-page/mock-data'
        }
      }
    ]
  }
})

await provider.connect({
  ports: [6220, 7431, 8127],
  token: await getPairingToken()
})
```

The SDK should fill provider metadata, normalize returned packages, enforce size
budgets, and forward provider-defined follow-up input through the same
`getContext` callback.

### SDK Runtime Adapters

Core SDK logic should be environment-neutral. Transport adapters can cover:

- browser WebSocket
- Node WebSocket
- extension bridge
- in-process adapter for built-in providers

Vue/React-specific hooks should be thin wrappers, not part of the core protocol.

### Error API

Provider authors should be able to throw normal errors. The SDK serializes them
into protocol errors with stable error codes where possible.

Recommended error shape:

```ts
type ProviderErrorPayload = {
  code: string
  message: string
  retryable?: boolean
  details?: unknown
}
```

Common codes:

- `PROVIDER_NOT_ACTIVE`
- `CAPABILITY_NOT_SUPPORTED`
- `RESOURCE_NOT_FOUND`
- `PERMISSION_DENIED`
- `INVALID_ARGS`
- `TIMEOUT`
- `PAYLOAD_TOO_LARGE`
- `INTERNAL_ERROR`

## Hub SDK / Internal API Design

The hub should expose an internal provider registry API used by both WebSocket
transport and in-process adapters.

```ts
type ContextHub = {
  registerProvider(provider: ProviderConnection): ProviderSession
  unregisterProvider(providerSessionId: string): void
  activateProvider(input: ActivateProviderInput): Promise<ActivationResult>
  deactivateProvider(input: DeactivateProviderInput): Promise<void>
  getContext(input: HubGetContextInput): Promise<GetContextOutput>
}
```

Provider transports should plug into this registry:

```ts
const hub = createContextHubMcpServer({
  name: 'tempad-context',
  version: '0.1.0',
  instructions: GENERIC_CONTEXT_HUB_INSTRUCTIONS
})

hub.useProviderTransport(createWebSocketProviderTransport({ host: '127.0.0.1' }))
hub.registerProvider(createProductNotesProvider())
await hub.startMcpStdio()
```

This keeps WebSocket concerns separate from MCP tool implementation.

## Instructions and Skills

The generic MCP instructions should no longer be Figma-specific. They should
tell agents:

1. list providers when implementation context may exist
2. call `get_context` to retrieve a self-describing context package
3. expand returned refs only when needed
4. treat prototype code as reference behavior, not final architecture
5. preserve provider warnings and uncertainties in implementation planning

In the minimal v0, this guidance can live in the `get_context` tool
description, hub instructions, and provider companion skills. There is no
separate provider-listing tool.

An optional `tempad-context` skill can encode the recommended workflow for
Claude Code and similar agents.

## Security Model

v0 is local-first, but still needs explicit security controls.

### Threats

- Any local web page may attempt to connect to `127.0.0.1`.
- A malicious provider may claim a trusted id.
- A provider may expose sensitive runtime data.
- A future provider action may control runtime state.
- Large payloads may exhaust MCP client limits.

### Controls

- Pairing token required for provider handshake.
- Origin allowlist for browser providers where possible.
- Hub-assigned `providerSessionId` is authoritative.
- Provider manifest id is descriptive, not trusted identity by itself.
- Activation is explicit and user-visible.
- Permission scopes are checked before `get_context` calls.
- Default scopes are read/inspect only.
- Runtime control is out of scope for v0.
- Payload size limits and inline budgets are enforced at hub boundaries.
- Large binary content uses resource or asset indirection.
- Provider errors are sanitized before reaching MCP clients.

## Result Budgeting and Resources

The existing MCP inline budget strategy should apply to provider results.

Rules:

- The hub measures final MCP tool results before returning them.
- Providers may define their own size/budget hints inside `input`, but the hub
  does not standardize those hints in v0.
- Providers should return refs or asset URLs for large content.
- The hub should fail with a compact, actionable error if a result is still too
  large.
- Image and binary content should normally be returned by asset URL, not inline
  base64.

## Dynamic Capability Updates

Capabilities should be dynamic at the provider protocol layer.

v0 behavior:

- Providers can send `provider.capabilitiesChanged`.
- The hub updates provider metadata.
- MCP tool surface stays unchanged.
- Agents discover updated context behavior through `get_context` results or
  companion skills.

Future behavior:

- The hub may introduce stable provider actions later.
- The hub may notify MCP clients that tool metadata changed when client support
  is reliable enough.

## Provider Injection Modes

### Mode A: Runtime Provider over WebSocket

Best for:

- Chrome extension
- web prototype runtime
- browser playground
- local Storybook runtime
- Figma bridge

Flow:

1. Hub starts provider WebSocket endpoint.
2. Provider SDK connects.
3. Provider sends `provider.hello`.
4. Hub registers provider session.
5. User activates provider.
6. Agent retrieves context through `get_context`.

### Mode B: In-Process Provider Adapter

Best for:

- built-in providers
- local notes or docs
- mock API providers
- server-side adapters

Example:

```ts
hub.registerProvider({
  id: 'product-notes',
  title: 'Product Notes',
  instructions: 'Provides product requirements and edge cases.',
  capabilities: { context: true },
  async getContext(req) {
    return {
      summary: 'Product notes relevant to the current workspace.',
      items: [
        {
          id: 'product-notes/current',
          title: 'Relevant product notes',
          kind: 'product-notes',
          mimeType: 'text/markdown',
          content: [
            {
              type: 'text',
              mimeType: 'text/markdown',
              text: await readCurrentProductNotes()
            }
          ]
        }
      ]
    }
  }
})
```

### Mode C: Existing MCP Server Adapter

Future direction. An existing MCP server can be wrapped as a provider through an
adapter layer inside the hub. This is out of scope for v0.

## Package Layout

The repo can evolve in two phases.

### v0 Minimal Package Changes

Keep the current package layout and add abstractions inside existing packages:

```txt
packages/shared
  provider protocol schemas and types

packages/mcp-server
  context hub registry
  MCP kernel tools
  WebSocket provider transport

packages/extension
  TemPad Chrome provider implementation using provider SDK
```

This avoids a large package split before the design is validated.

### Future Package Split

After v0 proves useful, split public packages:

```txt
packages/context-protocol
  shared protocol types, method names, error codes

packages/context-provider
  public provider SDK for browser and Node runtimes

packages/provider-ws
  WebSocket transport implementation

packages/mcp-hub
  provider registry and MCP gateway helpers

packages/mcp-server
  actual CLI/server package built on mcp-hub

packages/claude-skill
  SKILL.md and usage examples
```

## Migration Plan

### Phase 1: Extract Generic Provider Protocol

- Add provider protocol schemas to shared.
- Keep existing extension message support for compatibility.
- Introduce `ProviderConnection` and `ProviderSession` terminology.
- Add `provider.hello` handshake.
- Keep current Figma tools operational.

### Phase 2: Add MCP Kernel Tools

- Add `get_context`.
- Keep activation user-mediated through provider-side or hub UI.
- Update MCP instructions to describe the generic context hub workflow.

### Phase 3: Build Provider SDK

- Extract connection/reconnect/activation/dispatch logic from the extension
  composable.
- Publish a browser-compatible SDK entry.
- Build a sample browser prototype provider with the SDK.
- Add tests for handshake, activation, get-context, ref expansion, and reconnect.

### Phase 4: Validate with Prototype Runtime

- Build a simple web prototype provider using `get_context`.
- Return current page summary, mock data follow-up refs, screenshot asset refs,
  and interaction notes.
- Validate with a coding agent implementing a real screen.

### Phase 5: Optional Figma Context Package

- Add an optional Figma `get_context` package only after the third-party
  provider flow is validated.
- Keep current Figma MCP tools operational.
- Do not hide Figma tool schemas behind generic provider RPC.

## Recommended v0 Scope

### Must Have

- WebSocket provider connection.
- Provider registration through `provider.hello`.
- User-mediated provider activation.
- One MCP tool: `get_context`.
- MCP gateway with small stable tool surface.
- Provider SDK.
- Generic MCP instructions and basic skill guidance.
- Pairing token or equivalent local security gate.

### Nice to Have

- Provider-originated context change notifications.
- Capability update notifications.
- In-process provider adapter.
- Asset upload helper in SDK.
- Provider listing or switching tools.
- Multiple active providers per MCP consumer session.

### Out of Scope for v0

- Universal context schema.
- Strict screen/component/token protocol.
- Auto-generation of provider-specific MCP tools.
- Complete visual comparison workflow.
- Runtime control actions.
- Provider-specific action RPC.
- Existing MCP server adapter.

## Open Questions

1. Should `get_context` ever inline small image data, or should all images use
   asset URLs?
2. What is the exact pairing token UX for browser prototypes that are not
   installed extensions?
3. How should trusted first-party providers be distinguished from third-party
   providers?
4. When, if ever, should provider-specific actions be added after v0?
5. Should provider capability updates be persisted across reconnects?

## One-Sentence Framing

TemPad Dev MCP should become an MCP-facing Context Hub, while third-party
runtimes integrate through a lightweight Context Provider Protocol and SDK, with
flexible context content and a stable provider contract.
