# TemPad Dev Agent Plugin

[English](./README.md)

在你的 coding agent 或 IDE 中读取、编辑和实现 Figma 设计。这个插件包含：

- `figma-canvas-authoring`：创建和修改原生 Figma 设计，按任务需要复用可访问的组件、变量和样式。
- `figma-design-to-code`：读取 Figma 设计信息，结合项目已有组件和约定实现 UI。
- TemPad Dev MCP server 配置：连接浏览器中打开的 Figma 文件。

需要安装 TemPad Dev 浏览器扩展。画布编辑还需要 Figma Design 文件的编辑权限。手动检查设计和输出插件的完整说明见 [使用指南](https://github.com/ecomfe/tempad-dev/blob/main/README.zh-Hans.md)。

本插件遵循 [Agent Plugins 1.0](https://agent-plugins.org/)，并从同一份内容源发布一个标准包
（供自行适配该标准的客户端使用）、一个 `plugins` CLI 兼容包，以及每个原生宿主各一个包。Codex 与 Claude 请优先使用原生安装。
Codex App 通过 MCP 元数据和原生 IPC 绑定任务，其插件不注册生命周期 hooks。

## Cursor 和 VS Code 安装

Cursor 和 VS Code 请指定对应的 target：

```bash
npx plugins add ecomfe/tempad-dev --target cursor
npx plugins add ecomfe/tempad-dev --target vscode
```

安装器读取 `.plugin/marketplace.json`，安装生成的 `plugins-cli` 兼容包，其中包含两个 skill
和 MCP 配置，不包含生命周期 hooks。此路径已通过 `plugins@1.3.4` 验证。支持 Agent Plugins 1.0
的客户端可使用独立的 `agent-plugin/targets/standard` 标准包；当前 `plugins` CLI 不读取该格式。

## Codex 和 Claude 安装

使用以下原生 marketplace 流程。Claude 提示时，请检查并信任插件的生命周期 hooks；Codex 不注册 hooks。
`--sparse` 将检出范围限制为对应宿主的 marketplace 和生成包，包含所需的 skill 及 hooks。
Codex 为每个路径重复指定 `--sparse`；Claude 在一个 `--sparse` 后接受多个路径。
Cursor 和 VS Code 使用的 `plugins` CLI 没有对应参数。

### Codex

```bash
codex plugin marketplace add ecomfe/tempad-dev --ref main --sparse .agents --sparse agent-plugin/targets/codex
codex plugin add tempad-dev@tempad-dev
```

添加 marketplace 后，也可以从 Codex 应用的插件目录安装 **TemPad Dev**。

### Claude Code 和 Claude Desktop

```bash
claude plugin marketplace add ecomfe/tempad-dev --sparse .claude-plugin agent-plugin/targets/claude
claude plugin install tempad-dev@tempad-dev
```

添加 marketplace 后，该插件也会出现在 Claude Desktop 中。

不支持 Agent Plugin 的客户端，请按照
[完整配置指南](https://github.com/ecomfe/tempad-dev/blob/main/README.zh-Hans.md#agent-集成)直接配置 MCP 并安装独立 skill。

## 使用

使用前，请在 Figma 中打开 TemPad Dev，然后进入 **Preferences → Agent integration**
并启用 **MCP access**。启用后，只要当前 Figma Design 文件可编辑，即可进行画布创作。

设计任务的状态栏显示 agent 状态、Stop/Done 和评论入口。Stop 会立即阻止当前任务继续写入，
在执行中的操作结束后永久取消该任务；重新连接也不会恢复它。后续设计工作需要明确开始新任务。

评论目前仅支持通过兼容 Codex App 的原生会话通道发送。Queue 将整批评论交给宿主的原生队列，
等待会话可以执行时再处理。宿主确认接收后，TemPad Dev 会清空本批评论和标记、停止发送指示，
并允许继续输入下一批；这表示已接收，不表示 agent 已完成修改。如果原生入队不可用，
Queue 会在 Hub 中等待已有排队消息清空、会话能接收新回复，此时发送指示会保留到确认接收。
如果无法确认队列状态，会保留评论并报告发送错误。兼容宿主也支持原生服务端队列入队，
这些消息可能会在 Codex 下一次刷新队列时才显示。
Steer 会将评论追加到正在执行的回复，空闲时直接开始新回复。投递失败或结果不确定时保留草稿，
结果不确定的评论不会自动重发，也不会回退到 hooks。

| 编辑位置           | Enter 或点击提交按钮 | Command/Ctrl+Enter 或 Command/Ctrl+点击  |
| ------------------ | -------------------- | ---------------------------------------- |
| 元素评论           | 保存当前评论，不发送 | Save & Queue：保存当前评论并排队整批评论 |
| 状态栏中的总体评论 | 排队整批评论         | 使用 Steer 发送整批评论                  |

整批评论包含全部已保存的元素评论和总体评论；两个编辑器中都可以用 Shift+Enter 换行。
草稿按文件、会话和任务隔离，关闭标签页后仍保留，恢复草稿不会自动发送。

Codex App 的任务绑定和状态同步使用 MCP 元数据及原生 IPC，不依赖 hooks。Stop 还会请求中断
对应的 Codex 回合，迟到的 Stop 不会中断较新的回合。Stop 和 Done 会移除当前任务尚未执行的
原生队列评论，保留其它消息；清理失败后会在重新连接时重试，已被宿主取走的输入无法撤回。
宿主不可用时，本地取消仍然生效。Claude 保留生命周期和 Stop 通知 hooks；Claude、Codex CLI
等尚未接入原生投递的客户端提供任务状态和 Stop/Done，但不显示评论入口，已有草稿不会删除。

原生适配器在 macOS/Linux 上使用 Unix socket，在 Windows 上使用 Codex 的本机 Named Pipe。
已在 macOS Codex App 26.908.70816 上实测 Steer，以及暂停状态下的原生队列入队和移除。
自动执行和完整的已安装插件/Figma UI 流程仍待实测；Windows/Linux 的证据限于源码检查和
自动化测试，尚不能据此宣称完整宿主支持。

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

所有内容只在 `agent-plugin/src/` 下编写一次，由 `pnpm agent-plugin:build` 生成各个产物。
所有产物都是生成的，请勿直接编辑。

| 路径                               | 作用                                   |
| ---------------------------------- | -------------------------------------- |
| `agent-plugin/src/plugin.json`     | 标准清单，拥有全部公共 metadata        |
| `agent-plugin/src/mcp.json`        | 标准 MCP 配置                          |
| `agent-plugin/src/skills/`         | 两个 skill                             |
| `agent-plugin/src/clients/claude/` | Claude 生命周期 hooks                  |
| `agent-plugin/src/clients/codex/`  | Codex 目录展示信息（`interface.json`） |
| `agent-plugin/src/clients/shared/` | 宿主共用的 hook 传输脚本               |
| `agent-plugin/targets/standard`    | 生成产物，同时是独立 skills 的安装地址 |
| `agent-plugin/targets/plugins-cli` | 为 `plugins` CLI 生成的兼容包          |
| `agent-plugin/targets/codex`       | 生成的 Codex marketplace 包            |
| `agent-plugin/targets/claude`      | 生成的 Claude marketplace 包           |

每个产物只携带自己的安装方式会读取的内容。标准客户端会自行把 `plugin.json` 适配到宿主，
因此在它旁边放置宿主清单会让同一个包出现第二个事实来源；两个宿主产物同理省略标准清单
以及对方宿主的目录。只有 Claude 会加载生命周期 hooks，因此只有 `targets/claude` 携带 `clients/`。
`plugins-cli` 包使用 `.plugin/plugin.json` 和 `.mcp.json`，由独立生成的 marketplace 入口路由，
避免 CLI 选中 Claude 包。修改封装后运行 `pnpm agent-plugin:check-installer`，验证实际 CLI 的发现结果。
