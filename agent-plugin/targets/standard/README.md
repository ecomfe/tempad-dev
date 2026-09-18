# TemPad Dev Agent Plugin

[Simplified Chinese](./README.zh-Hans.md)

Read, edit, and implement Figma designs through your coding agent or IDE. This plugin includes:

- `figma-canvas-authoring`: create and revise native Figma designs, reusing accessible components, variables, and styles as needed.
- `figma-design-to-code`: use Figma design context to implement UI with your project’s components and conventions.
- The TemPad Dev MCP server configuration: connect to the Figma file open in your browser.

Requires the TemPad Dev browser extension. Canvas editing also requires edit access to the Figma Design file. For manual inspection and output plugins, see the full [user guide](https://github.com/ecomfe/tempad-dev/blob/main/README.md).

This plugin follows [Agent Plugins 1.0](https://agent-plugins.org/) and is published from one
source as a standard package, for clients that project the standard themselves, plus a package per
native host. Prefer native installation on Codex and Claude. Codex App binds tasks over MCP
metadata and native IPC, so its plugin registers no lifecycle hooks.

## Install the standard plugin

For Cursor and VS Code, select the corresponding target:

```bash
npx plugins add ecomfe/tempad-dev --target cursor
npx plugins add ecomfe/tempad-dev --target vscode
```

The installer reads the standard package and adapts it to the selected client itself.

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
[complete setup guide](https://github.com/ecomfe/tempad-dev/blob/main/README.md#agent-integration).

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

Everything is authored once under `agent-plugin/src/` and published by
`pnpm agent-plugin:build`. Every target is generated; never edit one.

| Path                               | Role                                            |
| ---------------------------------- | ----------------------------------------------- |
| `agent-plugin/src/plugin.json`     | Standard manifest; owns all shared metadata     |
| `agent-plugin/src/mcp.json`        | Standard MCP configuration                      |
| `agent-plugin/src/skills/`         | Both skills                                     |
| `agent-plugin/src/clients/claude/` | Claude lifecycle hooks                          |
| `agent-plugin/src/clients/codex/`  | Codex directory presentation (`interface.json`) |
| `agent-plugin/src/clients/shared/` | Hook transport shared by hosts                  |
| `agent-plugin/targets/standard`    | Generated; also the standalone skills URL       |
| `agent-plugin/targets/codex`       | Generated Codex marketplace package             |
| `agent-plugin/targets/claude`      | Generated Claude marketplace package            |

Each target carries only what its own installer reads. A standard consumer projects `plugin.json`
onto the host itself, so shipping a host layout beside it would create a second source of truth for
the same package; each host target likewise omits the standard manifests and the other host's
directory. Only Claude loads lifecycle hooks, so only `targets/claude` carries `clients/`.

## Task controls and client enhancements

Design tasks can pause and resume across turns. Figma's canvas status bar shows the
source client, a Stop control, and a counted comment entry. Stop permanently cancels
the current task; subsequent design work explicitly begins a fresh task. Lifecycle pauses can resume
with a new lease epoch and require a fresh canvas read before writing. See the
[task and client design](https://github.com/ecomfe/tempad-dev/blob/main/docs/extension/mcp-design-tasks.md).

The normal setup is the TemPad Dev extension configuration followed by this plugin's
installation. There are no control
addresses, environment variables, or helper services for users to configure.

Codex App binds tasks from host-supplied MCP metadata and follows native conversation
state through the existing IPC connection. Claude retains lifecycle and Stop hooks.
Comments are delivered only through native conversation messages on compatible Codex App
hosts. TemPad Dev discovers the original conversation through the App's existing local
connection. Queue submits the batch to the host's native queue, where it waits until the
conversation is ready. As soon as the host confirms admission, TemPad Dev clears the submitted
comments and markers, stops the sending indicator, and allows another batch. This confirmation
means the host received the comments, not that the agent finished the requested changes.
If the native queue snapshot is unavailable, Queue waits in the Hub until the conversation can
accept a new response. The sending indicator remains until that admission is confirmed.
Steer adds comments to an active response or starts a response when the conversation is idle.
Failed or uncertain delivery retains drafts; uncertain delivery is not automatically resent.
Comments never fall back to hooks.

| Editor                            | Enter or click the submit button | Command/Ctrl+Enter or Command/Ctrl+click |
| --------------------------------- | -------------------------------- | ---------------------------------------- |
| Element comment                   | Save the comment without sending | Save & Queue the whole batch             |
| General comment in the status bar | Queue the whole batch            | Steer the whole batch                    |

A batch includes all saved element comments and the general comment. Shift+Enter inserts a
newline in either editor. Saving an element comment alone does not send it.

Claude, Codex CLI, and other clients currently provide task status and Stop/Done without
comment controls. Previously saved drafts remain in extension-local storage.

Stop immediately blocks further writes from the current task and permanently cancels it
once an executing operation drains. The cancelled task cannot resume. The agent respects
Stop without automatically replacing it; necessary or user-requested design work can
explicitly begin a fresh task. No separate Figma unlock is needed. Codex App Stop also
requests native interruption of the exact bound turn; a delayed Stop cannot interrupt a
newer turn. Stop and Done also remove this task's comments that are still in the native queue,
leaving unrelated messages intact. Failed cleanup is retried after reconnection; already consumed
input cannot be recalled. Local cancellation remains effective if the host is unavailable. Claude
conveys Stop at the next hooked tool boundary. Native Codex delivery is enabled
only after the exact conversation owner reports support; no manual connection setup
is required. See the task and client design for the current validation scope.

The native adapter uses Unix sockets on macOS/Linux and Codex's local named pipe on Windows.
macOS Steer and paused native queue admission/removal have been exercised against Codex App
26.908.70816. Automatic queue execution and the complete installed-plugin/Figma UI flow still
require live verification. Windows and Linux coverage is limited to source inspection and
automated tests; it does not establish complete host support.

With a supported connection, select an element, save its feedback draft, then send the
numbered batch from the canvas status bar. Drafts can be edited or deleted and survive
navigation and closed tabs in extension-local storage, isolated by file, agent conversation, and task.
Successful delivery clears the submitted markers together; restoring drafts never sends them.

The agent reports the result and its Figma link in the conversation, where users can
continue with follow-up requests. Task tools return text and structured data.
