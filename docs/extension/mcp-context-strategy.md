# MCP context strategy

This document records the current context-control strategy for TemPad Dev MCP outputs.

## Goals

- Reduce tool outputs that trigger upstream client/model truncation.
- Keep the model-visible tool count and call flow stable; prefer compact additive metadata on
  existing read tools over new retrieval tools.
- Prefer lightweight metadata in MCP responses; avoid shipping large image payloads through context.

## Decisions

1. Always-on context contains only universal routing and safety rules.
   - Tool descriptions explain when to call a tool and its essential contract.
   - Explicit user requirements override workflow defaults; design-system discovery is conditional,
     not a required authoring preflight.
   - Design-system authoring is a separate progressive branch entered only on an explicit user
     request; an empty file or ordinary composition never triggers it.
   - Material visual invention must have a grounded direction. Explicit user and project evidence
     come first, then an applicable installed skill; only an unresolved style loads the targeted
     research reference. Familiar or authoritative sources remain unverified candidates until they
     pass a task-, domain-, and platform-relevance gate. The agent retains a brief under ten
     lines instead of page dumps or a mood board.
   - Task-specific workflows, syntax, examples, and advanced native features live in skills and
     their progressive references.
   - Tool results carry factual recovery instructions only when that condition occurs.
2. `get_code` keeps existing API but uses a shared inline budget guard.
   - Budget is computed on the final `CallToolResult` UTF-8 bytes (`64 KiB` default).
   - If over budget, prefer a shell response that preserves the current node wrapper and omits direct children.
   - Warnings stay lightweight (`type + message` only); shell continuation lives in the inline omitted-child comment, and depth-cap recovery relies on returned `data-hint-id` values.
   - A bounded descendant-text preflight enters a root-only shell path when UTF-8 text alone proves
     the response cannot fit, avoiding descendant variables, plugins, collection, assets, and full
     rendering. Other overflow causes still reuse full-tree context for correctness.
   - Only fail fast when a usable shell cannot be generated.
3. `get_structure` keeps the same call shape and compacts output by default.
   - Limit total nodes.
   - Normalize/trim long names.
   - Round geometry values.
   - Include `authoringKey` only on TemPad-managed nodes, allowing later sessions to resume updates
     without retaining an earlier apply response.
   - Iteratively reduce node cap until the formatted result enters the shared inline budget.
4. `get_screenshot` is visible but selective.
   - It returns one bounded PNG through an MCP `resource_link` to the existing capability URL.
   - When the local Hub owns the bytes, the descriptor also exposes the same ephemeral file through
     `asset.localPath`, avoiding a loopback download from sandboxed local clients.
   - Normally use one final check for a new composition or material visual change; skip mechanical
     text, token, prop, and hierarchy-only edits.
5. Image/SVG bytes do not enter tool JSON.
   - Read-tool outputs expose a temporary `asset.localPath` when local bytes are available and retain
     `asset.url` as the capability-bearing fallback; asset resources are not exposed via MCP
     `resources/read`.
   - Canvas inputs use small inline SVG or a full Hub SHA-256 hash. Hash-addressed bytes cross only
     the bounded extension bridge.
6. `get_design_system` returns a deterministic immutable catalog rather than a file dump.
   - It is called only when existing-resource reuse is permitted and relevant; direct or new local
     resource authoring does not require it.
   - Normal discovery targets 16 KiB and uses short catalog-scoped refs.
   - It reads definitions only and performs no canvas-usage, text, semantic, or relevance retrieval.
   - Components, variables, and styles are interleaved before advanced collections and shaders.
   - Component discovery uses optimized type-filtered queries on already-accessible pages and never
     loads a page; variables, styles, and shaders use their file-level definition APIs.
   - Omitted counts and a cursor expose the remaining immutable catalog without another read.
   - An exact component ref returns a bounded usage contract with valid variants, default layout,
     semantic anatomy, and a node id for selective visual inspection; every exact result remains
     under the shared 64 KiB limit.
7. `apply_canvas` always performs structural verification without adding a read call.
   - The public schema exposes stable outer object boundaries but keeps the full native schema out of
     always-on context.
   - Complete, executable variable/style and component recipes live in matching progressive skill
     references and are contract-tested against the public and resolved schemas.
   - Visual verification is one explicit `get_screenshot` call after new or materially changed
     visual work, not an automatic response payload or iterative loop.
   - Resolved native-schema failures return at most four actionable field paths and bounded
     messages.
8. Every tool declares MCP read-only, destructive, idempotence, and open-world hints.
   - The hints improve client planning but never replace deterministic write controls.

## Why

- Different agent clients apply their own MCP/tool output limits before model context limits.
- Repeating task workflows in server instructions, tool descriptions, skills, and every response
  spends attention without adding evidence.
- Leaving advanced fields completely untyped gives a private dialect no usable model prior; fully
  expanding the native schema overwhelms the task. Stable outer types plus on-demand executable
  examples preserve both callability and attention.
- Partial/truncated code increases hallucination risk in downstream agents.
- Shell responses preserve parent composition facts without relying on arbitrary string truncation.
- Character-only truncation does not map well to tool response byte budgets.
- Image and SVG payloads are high-context-cost and do not need to be embedded in model input.
- An unreliable relevance heuristic is worse than explicit deterministic paging because it can hide
  valid design-system facts while presenting its output as task-specific.
- Style is contextual judgment rather than protocol state. Keeping its evidence and synthesis in a
  progressive skill reference avoids a permanent style taxonomy while preventing an unspecified
  request from collapsing to the model's highest-probability visual defaults. The reference frames
  requirements before candidate names, creates contrast when a salient default could materially
  fixate the result, and keeps coherence after selection; it does not prescribe a rotating catalog
  of aesthetics or mandatory research ceremony.

## Non-goals

- No chunked `get_code` protocol.
- No artifact manifests or additional retrieval abstractions.
- No separate style-definition or pagination tools; continuation and exact-ref lookup reuse the
  same immutable catalog and tool.
- No `style` field, fixed domain-to-aesthetic map, or automatic reference payload in MCP.
