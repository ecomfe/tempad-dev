# Releasing TemPad Dev

TemPad Dev has three independently distributed integration parts:

| Part              | Version source                         | Distribution                            |
| ----------------- | -------------------------------------- | --------------------------------------- |
| Browser extension | `packages/extension/package.json`      | Chrome Web Store; build with `pnpm zip` |
| MCP server        | `packages/mcp-server/package.json`     | npm through `publish-mcp.yml`           |
| Agent Plugin      | `agent-plugins/tempad-dev/plugin.json` | Git marketplace on `main`               |

The first stable canvas-authoring release pairs extension **0.21.0**, MCP **0.8.0**, and Agent
Plugin **0.2.0**. `@tempad-dev/plugins` is the separate code-output SDK; its version remains
**0.6.2** and it does not need publication for this release.

## Prepare the candidate

1. Resolve the branch against current `main`, include all intended source files, and update the
   package changelogs and English/Chinese installation guidance. Obtain explicit authorization
   before creating commits, as required by the repository's agent guide.
2. Run `pnpm agent-plugin:dev` after changing plugin inputs. Inspect synchronized release files
   under `agent-plugins/tempad-dev`, `.agents/plugins/marketplace.json`, and
   `.claude-plugin/marketplace.json`. Release MCP configuration must use `@tempad-dev/mcp@latest`.
3. Run the checks in [TESTING.md](../TESTING.md), then `pnpm format:check`, `pnpm build`, and
   `pnpm zip`. Ordinary build must not change tracked agent-plugin files. The extension archive is
   written to `packages/extension/.output/tempad-dev-0.21.0-chrome.zip` for this release.
4. Run `npm pack` in `packages/mcp-server` and inspect the tarball: the CLI, Hub, bundled shared
   code, package metadata, and both README languages must be present. Install it outside the
   workspace and verify MCP initialization and tool discovery on a supported Node.js runtime.
   Use separate runtime, log, and asset directories for the check so an active local Hub is
   unaffected. MCP 0.8.0 supports Node.js 22.x, 24.x, or 26+.
5. Push the authorized candidate and require its own `build` and `check-script-rewrite` CI results.
   An older branch revision's green checks do not validate the candidate. The rewrite check needs
   the repository's configured Figma credentials; keep them in CI secrets.

## Publish the coordinated release

The Agent Plugin follows `main` and launches the npm `latest` tag. Make the required stable MCP
version available before exposing the new plugin on `main`.

1. Prepare the Chrome Web Store submission using the archive from the checked candidate. Retain
   its SHA-256 digest and the exact source revision.
2. Dispatch `publish-mcp.yml` from that checked candidate ref with `tag=latest`. Its
   `prepublishOnly` hook rebuilds the package before npm publication. Confirm that both
   `npm view @tempad-dev/mcp@0.8.0 version` and `npm view @tempad-dev/mcp@latest version` return
   `0.8.0`.
3. Make extension 0.21.0 available through the Chrome Web Store, and merge the approved candidate
   so the marketplace serves Agent Plugin 0.2.0. Verify the portable, Codex, and Claude manifests
   agree. Do not publish the Agent Plugin through `publish-plugins.yml`; that workflow owns the
   separate `@tempad-dev/plugins` SDK.
4. Check the installed extension version, npm dist-tag, and installed plugin/skill versions before
   announcing canvas-authoring availability. If a user-facing live authoring check is needed,
   follow [the authoring evolution runbook](testing/agent-authoring-evolution.md).

Use the [plugin upgrade guide](../agent-plugins/tempad-dev/README.md#upgrading) for existing
installations. It covers the Node.js requirement, extension reload, plugin/skill update, stable MCP
configuration, client reconnection, and target-tab selection.
