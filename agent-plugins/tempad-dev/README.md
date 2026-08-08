# TemPad Dev Agent Plugin

[简体中文](./README.zh-Hans.md)

This directory is the portable TemPad Dev integration for compatible coding agents and IDEs. It
bundles:

- `figma-design-to-code` for turning Figma evidence into project-consistent UI code
- `figma-canvas-authoring` for grounded native Figma design with accessible component definitions,
  file resources, and progressive style guidance
- the TemPad Dev MCP server configuration for design evidence and MCP-gated canvas authoring

The root `plugin.json`, `skills/`, and `mcp.json` follow
[Agent Plugins 1.0](https://agent-plugins.org/) and are the canonical package contents.

## Install the portable plugin

Install into every compatible agent detected on your machine:

```bash
npx plugins add ecomfe/tempad-dev
```

To install into one agent only, pass a target such as:

```bash
npx plugins add ecomfe/tempad-dev --target codex
npx plugins add ecomfe/tempad-dev --target cursor
npx plugins add ecomfe/tempad-dev --target claude-code
npx plugins add ecomfe/tempad-dev --target vscode
```

The installer reads the portable package first and adapts it only when the selected client needs a
client-specific layout.

## Client-specific fallbacks

Use these native marketplace flows only when the portable installer is unavailable or client
policy requires the native path.

### Codex

```bash
codex plugin marketplace add ecomfe/tempad-dev --ref main
codex plugin add tempad-dev@tempad-dev
```

You can also install **TemPad Dev** from the Codex app plugin directory after adding the
marketplace.

### Claude Code and Claude Desktop

```bash
claude plugin marketplace add ecomfe/tempad-dev
claude plugin install tempad-dev@tempad-dev
```

The plugin appears in Claude Desktop after the marketplace is added.

For clients without Agent Plugin support, follow the direct MCP and standalone skill setup in the
[complete setup guide](../../README.md#agent-integration).

## Usage

Before using the integration, open TemPad Dev in Figma, then open **Preferences → Agent
integration** and enable **MCP access**. Canvas authoring is available while the active Figma
Design file is editable.

## Packaging source of truth

- Edit `plugin.json`, `skills/`, and `mcp.json` for portable content.
- `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, and `.mcp.json` are compatibility
  wrappers. Their shared metadata and MCP entries are synchronized from the portable files by
  `pnpm agent-plugin:dev`.
- Codex-only interface metadata remains in `.codex-plugin/plugin.json` and is preserved during
  synchronization.
