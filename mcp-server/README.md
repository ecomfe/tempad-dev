# @tempad-dev/mcp

## Usage

```json
{
  "mcpServers": {
    "TemPad Dev": {
      "command": "npx",
      "args": ["@tempad-dev/mcp"]
    }
  }
}
```

## Configuration

Optional environment variables:

- `TEMPAD_MCP_TOOL_TIMEOUT`: Tool call timeout in milliseconds (default `15000`).
- `TEMPAD_MCP_RUNTIME_DIR`: Override runtime directory (defaults to system temp under `tempad-dev/run`).
- `TEMPAD_MCP_LOG_DIR`: Override log directory (defaults to system temp under `tempad-dev/log`).

## Requirements

- Node.js 18+
