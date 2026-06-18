# TemPad Dev Codex Agent Integration

This Codex plugin is the packaged TemPad Dev agent integration. It bundles:

- the `figma-design-to-code` agent skill
- the TemPad Dev MCP server configuration for selected-node design evidence

Install the marketplace from this repository:

```bash
codex plugin marketplace add ecomfe/tempad-dev --ref main
codex plugin add tempad-dev@tempad-dev
```

You can also install **TemPad Dev** from the Codex app plugin directory after adding the marketplace.

Before using the integration, open TemPad Dev in Figma, then open **Preferences -> Agent integration** and enable **MCP server**.
