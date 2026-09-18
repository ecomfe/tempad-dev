# Releasing TemPad Dev

TemPad Dev has three independently distributed integration parts:

| Part              | Version source                     | Distribution                            |
| ----------------- | ---------------------------------- | --------------------------------------- |
| Browser extension | `packages/extension/package.json`  | Chrome Web Store; build with `pnpm zip` |
| MCP server        | `packages/mcp-server/package.json` | npm through `publish-mcp.yml`           |
| Agent Plugin      | `agent-plugin/src/plugin.json`     | Git marketplace on `main`               |

The first stable canvas-authoring release pairs extension **0.21.0**, MCP **0.8.0**, and Agent
Plugin **0.2.0**. `@tempad-dev/plugins` is the separate code-output SDK; its version remains
**0.6.2** and it does not need publication for this release.

## Prepare the candidate

1. Resolve the branch against current `main`, include all intended source files, and update the
   package changelogs and English/Chinese installation guidance. Obtain explicit authorization
   before creating commits, as required by the repository's agent guide.
2. Run `pnpm agent-plugin:build` after changing anything under `agent-plugin/src/`. Inspect the
   generated output under `agent-plugin/targets/`, `.agents/plugins/marketplace.json`, and
   `.claude-plugin/marketplace.json`. Release MCP configuration must use `@tempad-dev/mcp@latest`.
3. Run the checks in [TESTING.md](../TESTING.md), then `pnpm format:check`, `pnpm build`, and
   `pnpm zip`. Ordinary build must not change tracked agent-plugin files. The extension archive is
   written to `packages/extension/.output/tempad-dev-0.21.0-chrome.zip` for this release.
4. Remove `packages/mcp-server/dist` and rebuild before packing. A working tree that has been
   built repeatedly has been seen holding a stale hashed shared chunk even though `clean` is
   configured, and packing from it ships both copies. Then run `npm pack` in `packages/mcp-server`
   and inspect the tarball: the CLI, Hub, exactly one bundled shared chunk, package metadata, and
   both README languages must be present. Install it outside the
   workspace and verify MCP initialization and tool discovery on a supported Node.js runtime.
   Use separate runtime, log, and asset directories for the check so an active local Hub is
   unaffected. Restrict the smoke Hub's allowed extension origin to a dedicated test origin,
   remove inherited host task-identity variables from its child environment, and verify its
   runtime identity points at the installed tarball. Close the smoke client and confirm that
   only its isolated Hub exits. MCP 0.8.0 supports Node.js 22.x, 24.x, or 26+.
   Retain the package and extension archive hashes with the candidate revision; rebuild them
   if packaged source or documentation changes.
5. Before claiming full native host support, follow the
   [authoring evolution runbook](testing/agent-authoring-evolution.md) to verify the normal
   installed-plugin and extension path against the intended host version. Check Queue admission
   clears the submitted drafts and permits a second batch, queued input actually executes in the
   original conversation, Steer reaches the active response, and Stop prevents further writes
   while removing this task's remaining queued comments. Include reconnect/uncertain-admission
   recovery and preservation of unrelated queued messages. Record host/platform scope separately:
   a paused IPC admission/removal probe or package smoke test does not establish this full flow.
6. Push the authorized candidate and require its own `build` and `check-script-rewrite` CI results.
   An older branch revision's green checks do not validate the candidate. The rewrite check needs
   the repository's configured Figma credentials; keep them in CI secrets.

## Bridge protocol and release order

Every setup resolves `npx -y @tempad-dev/mcp@latest` on each launch, so moving the npm `latest`
tag upgrades the MCP server of every existing installation, while the extension waits for Chrome
Web Store review and staged rollout. `TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION` therefore decides the
order:

| Hub change                                        | Order                                                 |
| ------------------------------------------------- | ----------------------------------------------------- |
| Still announces the released extension's protocol | Publish `latest` any time; store release is unrelated |
| Dropped the released extension's protocol         | Publish `latest` at store publication, before rollout |

Keep the previous extension protocol in `TEMPAD_MCP_BRIDGE_SUPPORTED_PROTOCOL_VERSIONS` for at
least one store cycle so the first case stays the normal one. Extensions released before this rule
existed (0.20.0 and earlier) reject any Hub that announces a protocol version at all; only the
second ordering protects them.

## Publish the coordinated release

The Agent Plugin follows `main` and launches the npm `latest` tag. Make the required stable MCP
version available before exposing the new plugin on `main`.

1. Prepare the Chrome Web Store submission using the archive from the checked candidate. Retain
   its SHA-256 digest and the exact source revision.
2. Wait for the Chrome Web Store to publish extension 0.21.0. Do not publish MCP before that:
   0.8.0 stops serving the protocol of extension 0.20.0 and earlier, so an earlier `latest` breaks
   every installation that has not updated yet.
3. Once the store has published, dispatch `publish-mcp.yml` from that checked candidate ref with
   `tag=latest`, before the store rollout reaches users. Its `prepublishOnly` hook rebuilds the
   package before npm publication. Confirm that both `npm view @tempad-dev/mcp@0.8.0 version` and
   `npm view @tempad-dev/mcp@latest version` return `0.8.0`. If the dispatch cannot follow the
   publication promptly, publish `tag=next` first so support can pin an exact version, then
   dispatch `tag=latest`.
4. Merge the approved candidate so the marketplace serves Agent Plugin 0.2.0. Verify that the
   portable, Codex, and Claude manifests agree, and that each generated package carries only its
   own channel's manifests. Do not publish the Agent Plugin through `publish-plugins.yml`; that
   workflow owns the separate `@tempad-dev/plugins` SDK.
5. Check the installed extension version, npm dist-tag, and installed plugin/skill versions before
   announcing canvas-authoring availability. If a user-facing live authoring check is needed,
   follow [the authoring evolution runbook](testing/agent-authoring-evolution.md).

Use the [plugin upgrade guide](../agent-plugin/src/README.md#upgrading) for existing
installations. It covers the Node.js requirement, extension reload, plugin/skill update, stable MCP
configuration, client reconnection, and target-tab selection.
