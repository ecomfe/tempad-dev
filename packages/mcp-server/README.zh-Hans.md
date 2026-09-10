# @tempad-dev/mcp

TemPad Dev 的 MCP server 将 coding agent 连接到浏览器中打开的 Figma 文件，支持读取设计信息、创建和编辑原生图层，并为项目中的 UI 实现提供上下文。

需要安装 TemPad Dev 扩展，保持面板打开并启用 **MCP access**。画布写入还需要 Figma Design 文件的编辑权限。完整配置与使用说明见 [使用指南](../../README.zh-Hans.md#agent-集成)。

## 用法

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

如需针对不同 agent 配置，请打开 TemPad Dev 的 **Preferences → Agent integration → Set up agents**。界面提供 Codex、Cursor、Claude Code、Gemini、VS Code、OpenCode 和 TRAE 的引导路径；未列出的兼容客户端可选择 **Other**。

支持的工具和资源：

- `get_code`：以 Tailwind 优先的 JSX/Vue 标记输出，并附带资源和变量引用。
- `get_design_system`：创建不可变、确定性的紧凑目录，按资源类型平衡分页返回可访问页面的
  组件定义，以及本地或被定义直接引用的变量、集合/模式、样式和 shader 定义，不扫描画布
  中的使用情况。游标可继续读取遗漏定义；使用同一目录精确查询某个引用时，返回该资源的
  有界定义。使用 `scope: "fonts"` 可查询当前可用字体家族和精确原生样式，不读取文件资源。
- `apply_canvas`：使用受限 HTML、可确定转换的 Tailwind utility、类型化原生状态、SVG 和图片资源，
  对精确页面或托管根节点执行创建、更新、删除或激活。变量 utility 和命名文字样式 class 可绑定
  既有资源或同次调用中声明的资源；仅操作页面或更新 native 状态时可省略标记。
  扩展会在本地解析、验证、计算与实时画布的差异、应用修改并校验结构。
- `upload_asset`：Hub 内的受限桥梁，把程序化串联生成的 PNG/JPEG/GIF data URL 存成供
  `apply_canvas` 使用的 content-addressed `assetHash`，且不会返回编码后的图片字节。
- `get_screenshot`：返回一张有大小限制的渲染 PNG，用于按需视觉验证。
- `get_structure`：精确节点、页面或当前选中节点的层级/几何结构信息，并返回 TemPad 已管理节点的稳定 authoring key；
  还可按需读回原生遮罩、IMAGE paint、布局网格与画框参考线。

说明：

- 工具响应共用 `64 KiB` 的 inline budget，按 `CallToolResult` 整体响应体积计算。若选区过大而超出 `get_code` 的预算，TemPad Dev 可能返回 shell response 而不是直接失败。shell 会保留当前节点的包裹结构，并在内联代码注释中列出被省略的直接子节点 id，方便 agent 逐个继续拉取；配套 warning 只保留最小化的提示信息，用来指向这条注释。
- 启用 MCP access 且当前 Figma Design 文件可编辑时，`apply_canvas` 即可使用；Dev Mode 和
  只读文件仍不可写。
- MCP **0.8.0** 应配套使用扩展 **0.21.0** 和 Agent Plugin **0.2.0**。请更新扩展和已安装的 skill，
  将固定 alpha 版本的 MCP 配置改为 `@tempad-dev/mcp@latest`，然后重新连接 MCP client 并新建任务。
  详见[升级指南](https://github.com/ecomfe/tempad-dev/blob/main/agent-plugins/tempad-dev/README.zh-Hans.md#升级)。
- 资源是临时且与工具调用关联的。本地 stdio client 在 Hub 持有字节时会收到
  `asset.localPath`，可直接打开而不必经过 loopback 下载；其他 client 使用带 capability 的
  HTTP `asset.url`。完整 URL 应视作临时密钥，不要持久化到日志中。
- 画布创作可通过完整 SHA-256 摘要引用本地资源仓库中已有的内容；字节只经过扩展内部桥接，
  不会进入工具参数。
- MCP 不再暴露 `resources/list` / `resources/read` 用于 asset 内容读取。
- HTTP 回退 URL 使用 `/{capability}/assets/{hash}`，也可能带图片扩展名（例如 `/{capability}/assets/{hash}.png`），两种文件名形式都支持。

## 配置

可选环境变量：

- `TEMPAD_MCP_TOOL_TIMEOUT`：常规工具调用超时时间（毫秒，默认 `15000`）。
- `TEMPAD_MCP_GET_CODE_TIMEOUT`：`get_code` 超时时间（毫秒，默认 `30000`；设置 `TEMPAD_MCP_TOOL_TIMEOUT` 时以其作为回退值）。
- `TEMPAD_MCP_APPLY_CANVAS_TIMEOUT`：`apply_canvas` 慢调用告警阈值（毫秒，默认 `120000`；设置 `TEMPAD_MCP_TOOL_TIMEOUT` 时以其作为回退值）。超过阈值后，Hub 会继续等待明确结果或扩展断开，避免把已经完成的画布变更误报为超时。
- `TEMPAD_MCP_AUTO_ACTIVATE_GRACE`：仅一个扩展连接时自动激活前的延迟（默认 `1500`）。
- `TEMPAD_MCP_MAX_ASSET_BYTES`：截图/资源捕获的最大上传体积（字节，默认 `8388608`）。
- `TEMPAD_MCP_MAX_ASSET_STORE_BYTES`：本地资源存储总量上限（字节，默认 `268435456`）。
- `TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS`：资源并发上传上限（默认 `4`）。
- `TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS`：单个 Hub 同时允许的浏览器扩展连接上限（默认 `16`）。
- `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS`：允许连接的精确 `chrome-extension://...` Origin，以逗号分隔。配置值无效时启动会直接失败，而不会弱化策略；未配置时为了向后兼容会接受所有格式合法的 Chrome 扩展 Origin。
- `TEMPAD_MCP_ASSET_TTL_MS`：资源基于最近访问时间的清理 TTL（毫秒）；设置为 `0` 表示禁用（默认 `2592000000`）。
- `TEMPAD_MCP_RUNTIME_DIR`：运行时目录覆盖（默认在系统临时目录下的 `tempad-dev/run`）。
- `TEMPAD_MCP_LOG_DIR`：日志目录覆盖（默认在系统临时目录下的 `tempad-dev/log`）。
- `TEMPAD_MCP_ASSET_DIR`：资源存储目录覆盖（默认在系统临时目录下的 `tempad-dev/assets`）。

Hub 仅接受来自 Chrome 扩展 Origin、且目标为根路径的 WebSocket 握手。如需收紧安装环境，请将浏览器中显示的 TemPad Dev 扩展 Origin 写入 `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS`。Origin 校验与每次进程启动生成的 asset capability 可以降低跨 Origin 的 loopback 滥用，但不能认证以同一操作系统用户运行的其他进程；详见[本地 MCP 威胁模型](../../docs/security/local-mcp-threat-model.md)。

## 要求

- Node.js 22.x、24.x 或 26+。MCP 0.8.0 的运行时依赖要求较新的 Node.js 版本，已不再支持
  Node.js 18 或 20。
