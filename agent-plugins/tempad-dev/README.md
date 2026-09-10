# TemPad Dev Agent Plugin

[简体中文](./README.zh-Hans.md)

Read, edit, and implement Figma designs through your coding agent or IDE. This plugin includes:

- `figma-canvas-authoring`: create and revise native Figma designs, reusing accessible components, variables, and styles as needed.
- `figma-design-to-code`: use Figma design context to implement UI with your project’s components and conventions.
- The TemPad Dev MCP server configuration: connect to the Figma file open in your browser.

Requires the TemPad Dev browser extension. Canvas editing also requires edit access to the Figma Design file. For manual inspection and output plugins, see the full [user guide](../../README.md).

The root `plugin.json`, `skills/`, and `mcp.json` follow [Agent Plugins 1.0](https://agent-plugins.org/); client-specific manifests are compatibility wrappers.

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

## Upgrading

The canvas-authoring release pairs Agent Plugin **0.2.0**, TemPad Dev extension **0.21.0**, and
MCP server **0.8.0**. Node.js **22.x, 24.x, or 26+** is required for the MCP server.

1. Update the browser extension and reload the Figma tab.
2. Update the installed plugin through the client or installer used originally. With standalone
   setup, update both `figma-design-to-code` and `figma-canvas-authoring`.
3. Keep the release MCP configuration on `@tempad-dev/mcp@latest`; replace any previous
   `@alpha` or fixed alpha version. Reconnect the MCP client and start a new task so it loads the
   updated tools and skills. If a stale Hub is reported, close tasks using the old MCP server
   before reconnecting.
4. Open TemPad Dev, enable **MCP access**, and click the MCP badge in the intended Figma tab when
   a session choice is needed. The badge selects the file receiving tool calls.

## Packaging source of truth

- Edit `plugin.json`, `skills/`, and `mcp.json` for portable content.
- `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, and `.mcp.json` are compatibility
  wrappers. Their shared metadata and MCP entries are synchronized from the portable files by
  `pnpm agent-plugin:dev`.
- Codex-only interface metadata remains in `.codex-plugin/plugin.json` and is preserved during
  synchronization.
