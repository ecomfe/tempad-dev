# @tempad-dev/mcp

<a href="./README.zh-Hans.md"><img src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87%E7%89%88%20%C2%BB-000" alt="前往中文版"></a>

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
  available font families and exact native styles without reading file resources.
- `apply_canvas`: Creates, updates, removes, or activates exact pages and managed roots using
  restricted HTML, deterministic Tailwind utilities, typed native state, SVG, and image assets.
  Variable utilities and named text-style classes bind existing resources or resources declared
  in the same call. Page-only operations and native-only updates can omit markup. The extension
  resolves, validates, diffs, applies, and structurally verifies the result.
- `upload_asset`: A bounded Hub-only bridge from a programmatically composed generated PNG/JPEG/GIF
  data URL to a content-addressed `assetHash` for `apply_canvas`; encoded bytes are never returned.
- `get_screenshot`: A bounded rendered PNG for selective visual validation.
- `get_structure`: Hierarchy/geometry outline for an exact node, page, or current selection, including stable authoring keys on
  TemPad-managed nodes and optional native mask, IMAGE paint, layout-grid, and frame-guide read-back.

Notes:

- Tool responses use a shared `64 KiB` inline budget measured on the `CallToolResult` body. When a selection is too large for the `get_code` budget, TemPad Dev may return a shell response instead of failing. The shell keeps the current node wrapper and lists omitted direct child ids in an inline code comment so agents can request them one by one. The accompanying warning stays lightweight and only points agents to that comment.
- `apply_canvas` is available whenever MCP access is enabled and the current Figma Design file is
  editable. Dev Mode and view-only files remain read-only.
- MCP **0.8.0** pairs with extension **0.21.0** and Agent Plugin **0.2.0**. Update the extension
  and installed skills, replace any alpha-pinned MCP configuration with `@tempad-dev/mcp@latest`,
  then reconnect the MCP client and start a new task. See the
  [upgrade guide](https://github.com/ecomfe/tempad-dev/tree/main/agent-plugins/tempad-dev#upgrading).
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
- `TEMPAD_MCP_APPLY_CANVAS_TIMEOUT`: `apply_canvas` slow-call warning threshold in milliseconds (default `120000`; falls back to `TEMPAD_MCP_TOOL_TIMEOUT` when that override is set). After the threshold, the Hub keeps waiting for a definitive result or extension disconnect so a completed mutation is never reported as a timeout.
- `TEMPAD_MCP_AUTO_ACTIVATE_GRACE`: Delay before auto-activating the sole connected extension (default `1500`).
- `TEMPAD_MCP_MAX_ASSET_BYTES`: Maximum upload size for captured assets/screenshots in bytes (default `8388608`).
- `TEMPAD_MCP_MAX_ASSET_STORE_BYTES`: Maximum aggregate size of the local asset store in bytes (default `268435456`).
- `TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS`: Maximum simultaneous asset uploads (default `4`).
- `TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS`: Maximum simultaneous browser extension connections to one Hub (default `16`).
- `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS`: Comma-separated exact `chrome-extension://...` origins allowed to connect. Invalid configured values fail startup rather than weakening the policy. When omitted, any syntactically valid Chrome extension origin is accepted for backward compatibility.
- `TEMPAD_MCP_ASSET_TTL_MS`: Asset cleanup TTL in milliseconds based on last access; set `0` to disable (default `2592000000`).
- `TEMPAD_MCP_RUNTIME_DIR`: Override runtime directory (defaults to system temp under `tempad-dev/run`).
- `TEMPAD_MCP_LOG_DIR`: Override log directory (defaults to system temp under `tempad-dev/log`).
- `TEMPAD_MCP_ASSET_DIR`: Override asset storage directory (defaults to system temp under `tempad-dev/assets`).

The hub accepts WebSocket handshakes only from Chrome extension origins on its root path. For a locked-down installation, configure `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS` with the TemPad Dev extension origin shown by the browser. This origin check and the per-process asset capability reduce cross-origin loopback abuse, but do not authenticate another process running as the same OS user; see the [local MCP threat model](../../docs/security/local-mcp-threat-model.md).

## Requirements

- Node.js 22.x, 24.x, or 26+. MCP 0.8.0 no longer supports Node.js 18 or 20 because its runtime
  dependencies require newer Node.js versions.
