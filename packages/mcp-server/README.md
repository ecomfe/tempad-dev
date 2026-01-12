# @tempad-dev/mcp

## Usage

```json
{
  "mcpServers": {
    "TemPad Dev": {
      "command": "npx",
      "args": ["-y", "@tempad-dev/mcp@latest"]
    }
  }
}
```

Quick setup helpers:

- VS Code / Cursor / TRAE: use the deep links in TemPad Dev (Preferences → MCP server).
- Windsurf: copy the JSON snippet from the same panel.
- CLI: `claude mcp add --transport stdio "TemPad Dev" -- npx -y @tempad-dev/mcp@latest` or `codex mcp add "TemPad Dev" -- npx -y @tempad-dev/mcp@latest`.

Supported tools/resources:

- `get_code`: Tailwind-first JSX/Vue markup plus assets and token references.
- `get_structure`: Hierarchy/geometry outline for the selection.
- `get_screenshot`: PNG capture with a downloadable asset link.
- `tempad-assets` resource template (`asset://tempad/{hash}`) for binaries referenced by tool responses.

Notes:

- Assets are ephemeral and tool-linked; `resources/list` is intentionally empty to avoid cross-session/design-file pollution. Use `resource_link` blocks from tool results and `resources/read` (or the HTTP fallback URL) to fetch bytes.
- The HTTP fallback URL uses `/assets/{hash}` and may include an image extension (for example `/assets/{hash}.png`). Both forms are accepted.

## Configuration

Optional environment variables:

- `TEMPAD_MCP_TOOL_TIMEOUT`: Tool call timeout in milliseconds (default `15000`).
- `TEMPAD_MCP_AUTO_ACTIVATE_GRACE`: Delay before auto-activating the sole connected extension (default `1500`).
- `TEMPAD_MCP_MAX_ASSET_BYTES`: Maximum upload size for captured assets/screenshots in bytes (default `8388608`).
- `TEMPAD_MCP_ASSET_TTL_MS`: Asset cleanup TTL in milliseconds based on last access; set `0` to disable (default `2592000000`).
- `TEMPAD_MCP_RUNTIME_DIR`: Override runtime directory (defaults to system temp under `tempad-dev/run`).
- `TEMPAD_MCP_LOG_DIR`: Override log directory (defaults to system temp under `tempad-dev/log`).
- `TEMPAD_MCP_ASSET_DIR`: Override asset storage directory (defaults to system temp under `tempad-dev/assets`).

## Requirements

- Node.js 18+
