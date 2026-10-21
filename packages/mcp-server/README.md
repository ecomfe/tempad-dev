# @tempad-dev/mcp

<a href="./README.zh-Hans.md"><img src="https://img.shields.io/badge/Simplified%20Chinese%20%C2%BB-000" alt="Read in Simplified Chinese"></a>

The TemPad Dev MCP server connects coding agents to the Figma file open in your browser. It provides design context for UI implementation and tools to create and edit native Figma layers.

Requires the TemPad Dev extension, an open panel, and **MCP access** enabled. Canvas writes also require edit access to the Figma Design file. See the [user guide](../../README.md#agent-integration) for setup and workflows.

## Usage

```json
{
  "mcpServers": {
    "tempad-dev": {
      "command": "npx",
      "args": ["-y", "@tempad-dev/mcp@latest"]
    }
  }
}
```

For agent-specific setup, open TemPad Dev's **Preferences → Agent integration → Set up agents**. It provides guided paths for Codex, Cursor, Claude Code, Gemini, VS Code, OpenCode, and TRAE, plus **Other** for compatible clients not listed.

Supported tools/resources:

- `get_code`: Tailwind-first JSX/Vue markup plus assets and token references.
- `get_design_system`: An immutable, deterministic catalog. It returns compact pages of component
  definitions on accessible pages plus local or directly referenced variable, collection/mode,
  style, and shader definitions without inspecting canvas usage. Cursor continuation exposes
  omitted definitions; exact-ref lookup returns one bounded definition. `scope: "fonts"` queries
  available font families and exact native styles without reading file resources. `scope: "pages"`
  lists page IDs without scanning components; a resource call with `pageId` scans only that page's
  components while retaining file-wide variable, style, and shader definitions.
- `manage_design_task` (`begin`, `resume`, `complete`, `cancel`) and `set_design_anchor`: Bind canvas writes to
  a design task, resume a paused task, place its status controls, and finish or cancel the task.
  Stop permanently fences the old task across reconnects. Native Codex App comments support Queue
  and Steer; confirmed admission clears submitted drafts before execution finishes. See the
  [comment guide and host validation scope](https://github.com/ecomfe/tempad-dev/tree/main/agent-plugin/src#task-controls-and-client-enhancements).
- `get_design_task`: Read the task state and current write lease.
- `list_design_sessions`: List connected Figma files for exact-session reads.
- `apply_canvas`: Creates, updates, removes, or activates exact pages and managed roots using
  restricted HTML, deterministic Tailwind utilities, typed native state, SVG, and image assets.
  Variable utilities and named text-style classes bind existing resources or resources declared
  in the same call. Page-only operations and native-only updates can omit markup. The extension
  resolves, validates, diffs, applies, and structurally verifies the result.
- `upload_asset`: A bounded Hub-only bridge from a programmatically composed generated PNG/JPEG/GIF
  data URL to a content-addressed `assetHash` for `apply_canvas`; encoded bytes are never returned.
- `get_screenshot`: A bounded rendered PNG per requested node for selective visual validation.
- `get_structure`: Hierarchy/geometry outline for an exact node, page, or one or more visible selected nodes, including stable authoring keys on
  TemPad-managed nodes and optional native mask, IMAGE paint, layout-grid, and frame-guide read-back.

Notes:

- `get_code`, `get_structure`, and `get_screenshot` accept `nodeIds` or the current multi-selection.
  Single `nodeId` calls retain their existing result shape. Code and screenshots return independent
  `{ nodeId, result }` or `{ nodeId, error }` entries for batches; continue `remainingNodeIds` with
  exact `nodeIds` and unchanged options. Structure retains exact roots, reports failed roots in
  `errors`, and supports `options.depth: 0` for roots only. Node-set reads require matching Hub and
  extension builds using bridge protocol 15; older peers cannot silently ignore the new selectors.
- `get_code.resolveTokens` controls code only. Both settings return token definitions with all
  modes and aliases. Enabled resolution uses each actual consumer's effective Figma modes;
  unresolved references remain in code with `token-resolution` warnings. Missing or ambiguous
  definitions produce `token-definition` warnings. Warnings are bounded per node result.
  This replaces older responses that flattened `tokens` when resolution was enabled; legacy
  extensions must upgrade to use `resolveTokens: true`.
- Tool responses use a shared `64 KiB` inline budget measured on the `CallToolResult` body. When a selection is too large for the `get_code` budget, TemPad Dev may return a shell response instead of failing. The shell keeps the current node wrapper and lists omitted direct child ids in an inline code comment so agents can request them one by one. The accompanying warning stays lightweight and only points agents to that comment.
- `apply_canvas` is available whenever MCP access is enabled and the current Figma Design file is
  editable. Dev Mode and view-only files remain read-only.
- The node-set and token-definition semantics above require matching protocol 15 Hub and extension
  builds. Extension 0.22.0 remains supported through protocol 13 for existing reads, sessions,
  tasks, and canvas writes. New read options prompt an upgrade, and responses identify older
  selection/token semantics. Update the extension and reload Figma for the new capabilities, update
  the plugin or installed skills, replace any alpha-pinned MCP configuration with `@tempad-dev/mcp@latest`,
  then reconnect the MCP client and start a new task. For minimum versions and update steps, see the
  [upgrade guide](https://github.com/ecomfe/tempad-dev/tree/main/agent-plugin/src#upgrading).
- Assets are ephemeral and tool-linked. Local stdio clients receive `asset.localPath` when the Hub
  has the bytes and can open it without a loopback download; other clients use the
  capability-bearing HTTP `asset.url`. Treat the full URL as a temporary secret and do not persist
  it in logs.
- Canvas authoring may refer to content already in the local asset store by its full SHA-256 digest;
  bytes stay inside the extension bridge and never enter the tool payload.
- Asset resources are not exposed via MCP `resources/list`/`resources/read`.
- The HTTP fallback URL uses `/{capability}/assets/{hash}` and may include an image extension (for example `/{capability}/assets/{hash}.png`). Both filename forms are accepted.

## Configuration

Optional environment variables:

- `TEMPAD_MCP_TOOL_TIMEOUT`: General tool call timeout in milliseconds (default `15000`).
- `TEMPAD_MCP_GET_CODE_TIMEOUT`: `get_code` timeout in milliseconds (default `30000`; falls back to `TEMPAD_MCP_TOOL_TIMEOUT` when that override is set).
- `TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT`: Initial `get_design_system` resource-discovery timeout in milliseconds (default `45000`; continuation, exact-ref, font, and page-list reads use the general timeout). Falls back to `TEMPAD_MCP_TOOL_TIMEOUT` when that override is set.
- `TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT`: `get_structure` timeout for an explicit page ID or key, which may require loading a cold Figma page (default `45000` milliseconds; node and selection reads use the general timeout). Falls back to `TEMPAD_MCP_TOOL_TIMEOUT` when that override is set.
- `TEMPAD_MCP_APPLY_CANVAS_TIMEOUT`: `apply_canvas` slow-call warning threshold in milliseconds (default `120000`; falls back to `TEMPAD_MCP_TOOL_TIMEOUT` when that override is set). At twice this threshold, the Hub reports an unknown outcome. Further writes require both definitive completion or session recovery and a read of that file returning at least one structure root or code result, or an exact `get_structure` page snapshot (including an empty page). Empty selections and failed node reads do not count. Internal canvas failures also require readback because their error code cannot prove rollback succeeded. The read requirement survives Hub restarts. Inspect the canvas before continuing; do not replay the write.
- `TEMPAD_MCP_AUTO_ACTIVATE_GRACE`: Delay before auto-activating the sole connected extension (default `1500`).
- `TEMPAD_MCP_MAX_ASSET_BYTES`: Maximum upload size for captured assets/screenshots in bytes (default `8388608`).
- `TEMPAD_MCP_MAX_ASSET_STORE_BYTES`: Maximum aggregate size of the local asset store in bytes (default `268435456`).
- `TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS`: Maximum simultaneous asset uploads (default `4`).
- `TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS`: Maximum simultaneous browser extension connections to one Hub (default `16`).
- `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS`: Comma-separated exact `chrome-extension://...` origins allowed to connect. Invalid configured values fail startup rather than weakening the policy. When omitted, any syntactically valid Chrome extension origin is accepted for backward compatibility.
- `TEMPAD_MCP_ASSET_TTL_MS`: Asset cleanup TTL in milliseconds based on last access; set `0` to disable (default `2592000000`).
- `TEMPAD_MCP_RUNTIME_DIR`: Override runtime directory (defaults to `run` under the temporary root described below).
- `TEMPAD_MCP_STATE_DIR`: Override durable task and feedback storage (defaults to `~/.tempad-dev/state`, or `state` under an explicitly overridden runtime directory). Isolated Hub checks set this to temporary storage.
- `TEMPAD_MCP_LOG_DIR`: Override log directory (defaults to `log` under the temporary root).
- `TEMPAD_MCP_ASSET_DIR`: Override asset storage directory (defaults to `assets` under the temporary root).

The Hub exclusively locks its state and asset directories before loading either store, even
when another Hub uses a different runtime directory. These locks remain held until process
exit so shutdown writes cannot overlap a replacement Hub. Older releases do not honor these
additional locks; do not run them against shared storage concurrently with this version.

On Unix, overridden runtime, state, log, and asset directories must belong to the current
user, must not be symlinks, and must deny group and other access (for example, mode `0700`).

Before its first connection, transient connection failures get a bounded recovery window
covering the Hub's 60-second orphan-lock lease plus startup time. Other failures stop after
three attempts. The CLI reports exhausted retries on stderr; resolve the reported problem
and reconnect the MCP client to retry.
After a working bridge, transient connection failures continue retrying without a limit;
three consecutive permission, trust, or invalid-bridge failures still stop the CLI.

Each process log is capped at 10 MiB. Crossing the limit discards older entries in that file;
oversized entries are truncated with a marker. Logs from exited processes are removed after
seven days without writes. This is a per-file limit, not an aggregate directory quota.

On Linux, the runtime claims `<system temp>/tempad-dev` with mode `0700` when absent, or reuses
that directory when owned by the current user with mode `0700`. This keeps older installed hooks
working after a reboot and upgrading clients connected to the same Hub and lifecycle locks. An
unsafe legacy root, including one owned by another user, selects `<system temp>/tempad-dev-<uid>`
instead. An existing private UID root remains selected if the legacy root disappears or an empty
legacy root appears later. If both roots contain a socket or Hub lock, or a current-user root
contains those files with unsafe permissions, startup refuses automatic migration. Shut down the
existing runtimes and correct ownership/permissions before reconnecting. Other platforms retain
`<system temp>/tempad-dev`. Explicit directory overrides take precedence. Unix clients and lifecycle
hooks check the socket inode, ownership, and private permissions before connecting; an untrusted
socket is rejected without launching a replacement Hub. Correct its ownership/permissions or shut
down the old runtime before reconnecting. Windows retains the released fixed named-pipe path;
per-user pipe isolation is not yet implemented.

The hub accepts WebSocket handshakes only from Chrome extension origins on its root path. For a locked-down installation, configure `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS` with the TemPad Dev extension origin shown by the browser. This origin check and the per-process asset capability reduce cross-origin loopback abuse, but do not authenticate local processes, including another OS user's process that binds the port first; see the [local MCP threat model](../../docs/security/local-mcp-threat-model.md).

## Task storage recovery

An incompatible saved task may have been written by a newer Hub. Upgrade the MCP runtime and
reconnect all clients first. The recovery command deliberately refuses readable storage; do not
delete it to bypass a version mismatch.

If task storage cannot be read safely, the error names the affected snapshot. Reads remain
available, but canvas writes stay blocked across restarts because the snapshot may contain
permanent Stop fences. The Hub preserves unreadable state in a `.corrupt` file when possible.

To recover, disconnect all MCP clients and wait for the Hub to exit before changing its state.
Keep copies of the snapshot and any `.corrupt` file. Restore a verified complete snapshot
that includes the latest Stop fences to the original path using an atomic replacement, then
reconnect a client. A valid restored snapshot is accepted while the `.corrupt` evidence remains.
After upgrading from a version that quarantined newer data, `.corrupt` may itself be valid.
Verify that it is the latest complete snapshot before restoring it; its filename alone is not proof.

An older backup or leftover `.tmp` file may predate a Stop action. Without a trustworthy complete
snapshot, disconnect all MCP clients and run `npx -y @tempad-dev/mcp@latest --recover-task-storage`.
Run it with the same `TEMPAD_MCP_STATE_DIR` and `TEMPAD_MCP_RUNTIME_DIR` environment overrides
as the MCP client configuration; the command does not read that configuration. It prints the
resolved snapshot path even when recovery is refused. Confirm that it names the affected storage.
The command refuses an active writer or readable storage, preserves the original files in the
reported backup directory, and starts a new task generation. Every old task stays retired:
old reviews cannot restore execution, and taskless writes remain blocked. Every subsequent begin
must include `recoveryGeneration`, including in new sessions and after Hub restarts. A rejected
begin supplies it to clients in `_meta.recoveryGeneration` and to agents in the error text. Each new task
must read its target before writing. This requirement does not expire. Reads remain available.
Keep the backups; this operation does not recover task history.
Do not delete the quarantine marker or replace the snapshot with empty state to bypass the fence.

## Requirements

- Node.js 22.x, 24.x, or 26+. MCP 0.8.0 no longer supports Node.js 18 or 20 because its runtime
  dependencies require newer Node.js versions.
