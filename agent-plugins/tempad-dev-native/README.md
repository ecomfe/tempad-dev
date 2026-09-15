# TemPad Dev Agent Plugin

[Simplified Chinese](./README.zh-Hans.md)

Read, edit, and implement Figma designs through your coding agent or IDE. This plugin includes:

- `figma-canvas-authoring`: create and revise native Figma designs, reusing accessible components, variables, and styles as needed.
- `figma-design-to-code`: use Figma design context to implement UI with your project’s components and conventions.
- The TemPad Dev MCP server configuration: connect to the Figma file open in your browser.

Requires the TemPad Dev browser extension. Canvas editing also requires edit access to the Figma Design file. For manual inspection and output plugins, see the full [user guide](../../README.md).

The canonical source at `agent-plugins/tempad-dev/` follows [Agent Plugins 1.0](https://agent-plugins.org/).
Native Codex and Claude marketplaces use the generated `agent-plugins/tempad-dev-native/` package.
Use native installation for these hosts. Codex App uses MCP metadata and native IPC;
its plugin registers no lifecycle hooks.

## Install the portable plugin

For Cursor and VS Code, select the corresponding target:

```bash
npx plugins add ecomfe/tempad-dev --target cursor
npx plugins add ecomfe/tempad-dev --target vscode
```

The installer reads the portable package first and adapts it only when the selected client needs a
client-specific layout.

## Codex and Claude installation

Use these native marketplace flows for Codex and Claude. Claude's lifecycle hooks require
the host's normal trust review; Codex does not register hooks.

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

- Edit `agent-plugins/tempad-dev/plugin.json`, `skills/`, and `mcp.json` for canonical content.
- `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, and `.mcp.json` are compatibility
  wrappers. Their shared metadata and MCP entries are synchronized from the portable files by
  `pnpm agent-plugin:dev`.
- That generator also creates `agent-plugins/tempad-dev-native/` and the ignored local development
  package. These native packages omit root `plugin.json` and `mcp.json`, retain both host manifests,
  and include the same skills and lifecycle scripts. Never edit these generated copies.
- Codex-only interface metadata remains in `.codex-plugin/plugin.json` and is preserved during
  synchronization.

## Task controls and client enhancements

Design tasks can pause and resume across turns. Figma's canvas status bar shows the
source client, a Stop control, and a counted comment entry. Stop permanently cancels
the current task; subsequent design work explicitly begins a fresh task. Lifecycle pauses can resume
with a new lease epoch and require a fresh canvas read before writing. See the
[task and client design](../../docs/extension/mcp-design-tasks.md).

The normal setup is the TemPad Dev extension configuration followed by this plugin's
installation. There are no control
addresses, environment variables, or helper services for users to configure.

Codex App binds tasks from host-supplied MCP metadata and follows native conversation
state through the existing IPC connection. Claude retains lifecycle and Stop hooks.
Comments are delivered only through native conversation messages on compatible Codex App
hosts. TemPad Dev discovers the original conversation through the App's existing local
connection. Idle conversations start immediately; busy conversations wait for the current
response to finish. Native active-turn Steer is not yet available. Waiting comments remain
saved until delivery is confirmed, and failures never fall back to hooks.
Claude, Codex CLI, and other clients currently provide task status and Stop/Done without
comment controls. Previously saved drafts remain in extension-local storage.

Stop immediately blocks further writes from the current task and permanently cancels it
once an executing operation drains. The cancelled task cannot resume. The agent respects
Stop without automatically replacing it; necessary or user-requested design work can
explicitly begin a fresh task. No separate Figma unlock is needed. Codex App Stop also
requests native interruption of the exact bound turn; a delayed Stop cannot interrupt a
newer turn. Local cancellation remains effective if the host is unavailable. Claude conveys
Stop at the next hooked tool boundary. Native Codex delivery is enabled
only after the exact conversation owner reports support; no manual connection setup
is required. See the task and client design for the current validation scope.

With a supported connection, select an element, save its feedback draft, then send the
numbered batch from the canvas status bar. Drafts can be edited or deleted and survive
navigation and closed tabs in extension-local storage, isolated by file, agent conversation, and task.
Successful delivery clears the submitted markers together; restoring drafts never sends them.

The agent reports the result and its Figma link in the conversation, where users can
continue with follow-up requests. Task tools return text and structured data.
