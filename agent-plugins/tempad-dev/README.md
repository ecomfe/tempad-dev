# TemPad Dev Agent Plugin

This plugin packages the TemPad Dev agent integration for Codex and Claude Code. It bundles:

- `figma-design-to-code` for turning Figma evidence into project-consistent UI code
- `figma-canvas-authoring` for designing in Figma with the active file's components and variables
- the TemPad Dev MCP server configuration for design evidence and opt-in canvas authoring

Install it for Codex:

```bash
codex plugin marketplace add ecomfe/tempad-dev --ref main
codex plugin add tempad-dev@tempad-dev
```

You can also install **TemPad Dev** from the Codex app plugin directory after adding the marketplace.

Install it for Claude Code CLI and Desktop:

```bash
claude plugin marketplace add ecomfe/tempad-dev
claude plugin install tempad-dev@tempad-dev
```

The plugin appears in Claude Desktop after the marketplace is added. Both clients use the same
skill and MCP server configuration from this directory.

Before using the integration, open TemPad Dev in Figma, then open **Preferences -> Agent
integration** and enable **MCP access**. Enable **Canvas writes** separately only when the agent
should modify the active Figma file.

For app, CLI, direct MCP, and manual fallbacks, see the [complete setup guide](../../README.md#agent-integration).
