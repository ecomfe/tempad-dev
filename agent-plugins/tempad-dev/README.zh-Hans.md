# TemPad Dev Agent Plugin

[English](./README.md)

此插件为 Codex 和 Claude Code 提供 TemPad Dev Agent 集成，其中包括：

- `figma-design-to-code`：根据 Figma 证据实现符合项目约定的界面代码
- `figma-canvas-authoring`：利用可访问的组件定义、文件资源和渐进式风格指引，在
  Figma 中创作原生设计
- TemPad Dev MCP 服务器配置，用于读取设计证据以及通过 MCP 控制画布创作

## 安装

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

添加 marketplace 后，该插件也会出现在 Claude Desktop 中。两个客户端使用此目录中的
同一套 skill 和 MCP 服务器配置。

## 使用

使用前，请在 Figma 中打开 TemPad Dev，然后进入 **Preferences -> Agent integration**
并启用 **MCP access**。启用后，只要当前 Figma Design 文件可编辑，即可进行画布创作。

应用内配置、CLI、直接配置 MCP 和手动配置等其它方式，请参阅
[完整配置指南](../../README.zh-Hans.md#agent-集成)。
