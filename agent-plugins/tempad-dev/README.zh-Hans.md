# TemPad Dev Agent Plugin

[English](./README.md)

此目录是面向兼容 coding agent 和 IDE 的可移植 TemPad Dev 集成，其中包括：

- `figma-design-to-code`：根据 Figma 证据实现符合项目约定的界面代码
- `figma-canvas-authoring`：利用可访问的组件定义、文件资源和渐进式风格指引，在
  Figma 中创作原生设计
- TemPad Dev MCP 服务器配置，用于读取设计证据以及通过 MCP 控制画布创作

根目录的 `plugin.json`、`skills/` 和 `mcp.json` 遵循
[Agent Plugins 1.0](https://agent-plugins.org/)，并作为 canonical package 内容。

## 安装可移植插件

安装到本机检测到的所有兼容 agent：

```bash
npx plugins add ecomfe/tempad-dev
```

如果只安装到一个 agent，请指定 target，例如：

```bash
npx plugins add ecomfe/tempad-dev --target codex
npx plugins add ecomfe/tempad-dev --target cursor
npx plugins add ecomfe/tempad-dev --target claude-code
npx plugins add ecomfe/tempad-dev --target vscode
```

安装器会优先读取可移植 package，仅在目标客户端需要时转换为客户端专用目录结构。

## 客户端专用回退

仅当可移植安装器不可用，或客户端策略要求使用原生流程时，才使用以下 marketplace
安装方式。

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

## 封装内容源

- 可移植内容请修改 `plugin.json`、`skills/` 和 `mcp.json`。
- `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json` 和 `.mcp.json` 是兼容封装；
  `pnpm agent-plugin:dev` 会从可移植文件同步公共 metadata 与 MCP 配置。
- Codex 专用的 interface metadata 仍保存在 `.codex-plugin/plugin.json` 中，并会在同步时保留。
