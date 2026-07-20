# @tempad-dev/mcp

<a href="./README.zh-Hans.md"><img src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87%E7%89%88%20%C2%BB-000" alt="前往中文版"></a>

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
- `get_structure`: Hierarchy/geometry outline for the selection.

Notes:

- Tool responses use a shared `64 KiB` inline budget measured on the `CallToolResult` body. When a selection is too large for the `get_code` budget, TemPad Dev may return a shell response instead of failing. The shell keeps the current node wrapper and lists omitted direct child ids in an inline code comment so agents can request them one by one. The accompanying warning stays lightweight and only points agents to that comment.
- Assets are ephemeral and tool-linked; image/SVG bytes are downloaded via the capability-bearing HTTP `asset.url` from tool results. Treat the full URL as a temporary secret and do not persist it in logs.
- Asset resources are not exposed via MCP `resources/list`/`resources/read`.
- The HTTP fallback URL uses `/{capability}/assets/{hash}` and may include an image extension (for example `/{capability}/assets/{hash}.png`). Both filename forms are accepted.

## Configuration

Optional environment variables:

- `TEMPAD_MCP_TOOL_TIMEOUT`: Tool call timeout in milliseconds (default `15000`).
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

- Node.js 18.20.0+
