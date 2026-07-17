# TemPad Dev Agent Plugin

This plugin packages the TemPad Dev agent integration for Codex and Claude Code. It bundles:

- the `figma-design-to-code` agent skill
- the TemPad Dev MCP server configuration for selected-node design evidence

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

Before using the integration, open TemPad Dev in Figma, then open **Preferences -> Agent integration** and enable **MCP access**.

For app, CLI, direct MCP, and manual fallbacks, see the [complete setup guide](../../README.md#agent-integration).
