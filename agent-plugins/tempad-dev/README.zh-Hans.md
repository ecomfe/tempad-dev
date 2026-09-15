# TemPad Dev Agent Plugin

[English](./README.md)

在你的 coding agent 或 IDE 中读取、编辑和实现 Figma 设计。这个插件包含：

- `figma-canvas-authoring`：创建和修改原生 Figma 设计，按任务需要复用可访问的组件、变量和样式。
- `figma-design-to-code`：读取 Figma 设计信息，结合项目已有组件和约定实现 UI。
- TemPad Dev MCP server 配置：连接浏览器中打开的 Figma 文件。

需要安装 TemPad Dev 浏览器扩展。画布编辑还需要 Figma Design 文件的编辑权限。手动检查设计和输出插件的完整说明见 [使用指南](../../README.zh-Hans.md)。

`agent-plugins/tempad-dev/` 是遵循 [Agent Plugins 1.0](https://agent-plugins.org/) 的内容源。
Codex 和 Claude marketplace 使用生成的 `agent-plugins/tempad-dev-native/` 包。
这两个客户端应使用原生安装。Codex App 通过 MCP 元数据和原生 IPC 工作，不注册生命周期 hooks。

## 安装可移植插件

Cursor 和 VS Code 请指定对应的 target：

```bash
npx plugins add ecomfe/tempad-dev --target cursor
npx plugins add ecomfe/tempad-dev --target vscode
```

安装器会优先读取可移植 package，仅在目标客户端需要时转换为客户端专用目录结构。

## Codex 和 Claude 安装

使用以下原生 marketplace 流程。Claude 提示时，请检查并信任插件的生命周期 hooks；Codex 不注册 hooks。

### Codex

```bash
codex plugin marketplace add ecomfe/tempad-dev --ref main
codex plugin add tempad-dev@tempad-dev
```

添加 marketplace 后，也可以从 Codex 应用的插件目录安装 **TemPad Dev**。

### Claude Code 和 Claude Desktop

```bash
claude plugin marketplace add ecomfe/tempad-dev
claude plugin install tempad-dev@tempad-dev
```

添加 marketplace 后，该插件也会出现在 Claude Desktop 中。

不支持 Agent Plugin 的客户端，请按照
[完整配置指南](../../README.zh-Hans.md#agent-集成)直接配置 MCP 并安装独立 skill。

## 使用

使用前，请在 Figma 中打开 TemPad Dev，然后进入 **Preferences → Agent integration**
并启用 **MCP access**。启用后，只要当前 Figma Design 文件可编辑，即可进行画布创作。

评论目前仅支持通过 Codex App 的原生会话通道发送，不再通过 hooks 注入。目标会话忙碌时，
默认 Queue 会等待当前回复结束；按住 Command 或 Ctrl 发送则使用 Steer，将评论追加到正在执行的回复，
空闲时直接开始新回复。投递失败时保留草稿。Claude、Codex CLI 等尚未接入原生投递的
客户端暂不显示评论入口，已有草稿不会删除。Codex App 的任务绑定和状态同步也不依赖 hooks。
Figma Stop 会立即取消当前设计任务，并请求中断对应的 Codex 回合；即使宿主断线，旧任务也不能继续修改画布。
Claude 保留任务绑定、生命周期和 Stop 通知 hooks。

原生适配器在 macOS/Linux 上使用 Unix socket，在 Windows 上使用 Codex 的本机 Named Pipe。
Windows 连接适配已覆盖自动化回归测试，仍需使用 Windows 原生 Codex App 实机验证。

## 升级

本次画布创作版本应配套使用 Agent Plugin **0.2.0**、TemPad Dev 扩展 **0.21.0** 和 MCP
server **0.8.0**。MCP server 要求 Node.js **22.x、24.x 或 26+**。

1. 更新浏览器扩展，并重新加载 Figma 标签页。
2. 通过原先使用的客户端或安装器更新 plugin。独立配置时，请同时更新
   `figma-design-to-code` 和 `figma-canvas-authoring`。
3. 正式版 MCP 配置使用 `@tempad-dev/mcp@latest`；请替换旧的 `@alpha` 或固定 alpha 版本。
   重新连接 MCP client 并新建任务，以加载更新后的工具和 skill。若提示 Hub 过期，请先关闭
   使用旧 MCP server 的任务，再重新连接。
4. 打开 TemPad Dev 并启用 **MCP access**；需要选择会话时，点击目标 Figma 标签页内的 MCP
   badge。实际接收工具调用的文件由该 badge 选择。

## 封装内容源

- 可移植内容请修改 `plugin.json`、`skills/` 和 `mcp.json`。
- `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 和 `.mcp.json` 是兼容封装；
  `pnpm agent-plugin:dev` 会从可移植文件同步公共 metadata 与 MCP 配置。
- 生成器也会生成 `agent-plugins/tempad-dev-native/` 和忽略的本地开发包；它们省略根目录
  `plugin.json` 和 `mcp.json`，保留两个客户端清单、相同的 skills 和生命周期脚本。请勿直接编辑生成的副本。
- Codex 专用的 interface metadata 仍保存在 `.codex-plugin/plugin.json` 中，并会在同步时保留。
