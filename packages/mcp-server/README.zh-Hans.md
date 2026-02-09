# @tempad-dev/mcp

## 用法

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

快速配置方式：

- VS Code / Cursor / TRAE：使用 TemPad Dev（Preferences → MCP server）中的深链接。
- Windsurf：从同一面板复制 JSON 片段。
- CLI：`claude mcp add --transport stdio "TemPad Dev" -- npx -y @tempad-dev/mcp@latest` 或 `codex mcp add "TemPad Dev" -- npx -y @tempad-dev/mcp@latest`。

支持的工具和资源：

- `get_code`：以 Tailwind 优先的 JSX/Vue 标记输出，并附带资源和变量引用。
- `get_structure`：当前选中节点的层级/几何结构信息。
- `get_screenshot`：PNG 截图，包含可下载的资源链接。
- `tempad-assets` 资源模板（`asset://tempad/{hash}`），用于读取工具返回中引用的二进制资源。

说明：

- 资源是临时且与工具调用关联的；`resources/list` 故意保持为空，以避免跨会话/跨设计文件污染。请使用工具结果中的 `resource_link`，再通过 `resources/read`（或 HTTP 回退 URL）获取二进制内容。
- HTTP 回退 URL 使用 `/assets/{hash}`，也可能带图片扩展名（例如 `/assets/{hash}.png`），两种形式都支持。

## 配置

可选环境变量：

- `TEMPAD_MCP_TOOL_TIMEOUT`：工具调用超时时间（毫秒，默认 `15000`）。
- `TEMPAD_MCP_AUTO_ACTIVATE_GRACE`：仅一个扩展连接时自动激活前的延迟（默认 `1500`）。
- `TEMPAD_MCP_MAX_ASSET_BYTES`：截图/资源捕获的最大上传体积（字节，默认 `8388608`）。
- `TEMPAD_MCP_ASSET_TTL_MS`：资源基于最近访问时间的清理 TTL（毫秒）；设置为 `0` 表示禁用（默认 `2592000000`）。
- `TEMPAD_MCP_RUNTIME_DIR`：运行时目录覆盖（默认在系统临时目录下的 `tempad-dev/run`）。
- `TEMPAD_MCP_LOG_DIR`：日志目录覆盖（默认在系统临时目录下的 `tempad-dev/log`）。
- `TEMPAD_MCP_ASSET_DIR`：资源存储目录覆盖（默认在系统临时目录下的 `tempad-dev/assets`）。

## 要求

- Node.js 18+
