# TemPad Dev Agent Plugin

[简体中文](./README.zh-Hans.md)

This plugin packages the TemPad Dev agent integration for Codex and Claude Code. It bundles:

- `figma-design-to-code` for turning Figma evidence into project-consistent UI code
- `figma-canvas-authoring` for grounded native Figma design with accessible component definitions,
  file resources, and progressive style guidance
- the TemPad Dev MCP server configuration for design evidence and MCP-gated canvas authoring

## Installation

### Codex

```bash
codex plugin marketplace add ecomfe/tempad-dev --ref main
codex plugin add tempad-dev@tempad-dev
```

You can also install **TemPad Dev** from the Codex app plugin directory after adding the marketplace.

### Claude Code and Claude Desktop

```bash
claude plugin marketplace add ecomfe/tempad-dev
claude plugin install tempad-dev@tempad-dev
```

The plugin appears in Claude Desktop after the marketplace is added. Both clients use the same
skill and MCP server configuration from this directory.

## Usage

Before using the integration, open TemPad Dev in Figma, then open **Preferences -> Agent
integration** and enable **MCP access**. Canvas authoring is then available when the active Figma
Design file is editable.

For app, CLI, direct MCP, and manual fallbacks, see the [complete setup guide](../../README.md#agent-integration).
