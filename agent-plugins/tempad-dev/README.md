# TemPad Dev Agent Plugin

This plugin packages the TemPad Dev agent integration for Codex and Claude Code. It bundles:

- `figma-design-to-code` for turning Figma evidence into project-consistent UI code
- `figma-canvas-authoring` for grounded native Figma design with accessible component definitions,
  file resources, and progressive style guidance
- the TemPad Dev MCP server configuration for design evidence and MCP-gated canvas authoring

This tracked directory is the source used by the Git marketplace. Its MCP configuration pins an
exact published `@tempad-dev/mcp` version, so installing the plugin never follows a movable npm
dist-tag. The agent plugin itself is not published to npm.

`pnpm agent-plugin:dev` is the only agent-plugin build command. It synchronizes the shared skill,
icons, and exact MCP package version into this directory, then creates an ignored
`tempad-dev-dev` marketplace under `.dev/`. The development plugin points directly at the current
checkout's MCP build. Its ignored MCP configuration therefore contains a machine-local absolute
path; this is what lets an installed plugin use the latest workspace build without being rebuilt or
reinstalled. Ordinary `pnpm build` does not modify either plugin.

Run `pnpm dev` while developing. It watches the extension, shared package, and MCP server. MCP-only
changes are picked up when Codex starts a new task or Claude Code reloads plugins; rerun
`pnpm agent-plugin:dev` only when the skills, manifests, icons, or marketplace metadata change.

Add the development marketplace and plugin once for each client:

```bash
codex plugin marketplace add ./.dev
codex plugin add tempad-dev-dev@tempad-dev-dev

claude plugin marketplace add ./.dev
claude plugin install tempad-dev-dev@tempad-dev-dev --scope local
```

After rebuilding the agent plugin, refresh Codex with
`codex plugin add tempad-dev-dev@tempad-dev-dev` and start a new task. Refresh Claude Code with
`claude plugin marketplace update tempad-dev-dev && claude plugin update tempad-dev-dev@tempad-dev-dev --scope local`,
then run `/reload-plugins`.

The release order is: publish the exact MCP package version from the release commit, then merge the
same commit so the Git marketplace exposes the plugin that pins that version.

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
integration** and enable **MCP access**. Canvas authoring is then available when the active Figma
Design file is editable.

For app, CLI, direct MCP, and manual fallbacks, see the [complete setup guide](../../README.md#agent-integration).
