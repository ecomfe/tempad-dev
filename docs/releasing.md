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
   generated output under `agent-plugin/targets/`, `.plugin/marketplace.json`,
   `.agents/plugins/marketplace.json`, and `.claude-plugin/marketplace.json`. Run
   `pnpm agent-plugin:check-installer` to verify marketplace routing and MCP discovery with
   the actual installer. Release MCP configuration must use `@tempad-dev/mcp@latest`.
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
Web Store review and staged rollout. Store publication does not establish that existing users
have installed the update or reloaded their running extension and Figma tab.

| Hub change                                          | Release requirement                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Still serves the released extension's wire contract | Verify old-extension/new-Hub interoperability before publishing `latest`.                                     |
| Drops the released extension's wire contract        | Block `latest` until a tested compatibility transition or an explicitly approved breaking migration is ready. |

Keep the previous extension protocol in `TEMPAD_MCP_BRIDGE_SUPPORTED_PROTOCOL_VERSIONS` for at
least one store cycle so the first case stays the normal one. Listing a version is a promise about
the bytes. For versioned peers, an added hub-to-extension _envelope_
field is tolerated by the schemas, but a field added inside a payload object (`task`, `route`,
`result`) is not, so such a change must either preserve the older payload shape or follow a
separate migration plan. An entry in the support list is not itself compatibility evidence.

Extension 0.20.0 strictly rejects versioned registration. MCP 0.8.0 now selects a separate legacy
wire path before the first frame: no WebSocket subprotocol selects the released read-only contract;
`tempad-mcp` selects versioned registration. Do not add the unversioned client to the numeric version
list. See the [gateway design](extension/mcp-browser-gateway-design.md#released-unversioned-extensions)
for argument restrictions and collision-safe legacy asset uploads.

### Compatible rollout

| Extension | Hub                   | Behavior and recovery                                                                                                                                                                                                                                                                         |
| --------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.20.0    | 0.8.0                 | Existing taskless code, structure, and screenshot reads and asset exports continue working. Authoring and new read options explain how to update the extension and reload Figma.                                                                                                              |
| 0.21.0    | 0.8.0                 | Versioned session routing, runtime identity, and task fences apply.                                                                                                                                                                                                                           |
| 0.21.0    | 0.7.1 already running | Registration is rejected with instructions to restart the agent's MCP connection using `@tempad-dev/mcp@latest`. Close other agents keeping the old shared Hub alive, then restart. Reloading Figma alone does not upgrade the Hub. The extension reconnects automatically after replacement. |

1. Run `pnpm mcp:check-bridge` against the candidate. It builds and launches a real isolated Hub
   and uses the frozen 0.20.0 receiving schema and released result fixtures to check reads, short-hash
   uploads/downloads, reconnects, upgrade errors, and isolation of task-bound calls. Broker tests
   cover rejection of an old Hub and automatic recovery after replacement. These are deterministic
   protocol checks; they do not attest to a live store-installed Figma runtime or host controls.
2. Complete the installed-host acceptance gates and record the exact candidate artifacts. Verify
   the released 0.20.0 extension's read/export workflow against the candidate Hub in an isolated
   browser profile before publication, and verify the new extension against that same Hub.
3. Publish the backward-compatible MCP to `latest` first, then release the new extension and
   expose the new Agent Plugin on `main`. Existing extension installations must continue working
   throughout the store rollout. Keep the independent native-host acceptance requirement.
4. Retain the legacy path for at least one store cycle. Removing it is a separate breaking
   release decision with a documented recovery path, not an automatic consequence of store
   publication or elapsed time.

Publishing to the store alone does not retire old installations. Keep the adapter and its fixture
checks throughout the rollout; never treat store availability as evidence that every user updated.

## Publish the coordinated release

The Agent Plugin follows `main` and launches the npm `latest` tag. Make the required stable MCP
version available before exposing the new plugin on `main`.

1. Prepare the Chrome Web Store submission using the archive from the checked candidate. Retain
   its SHA-256 digest and the exact source revision.
2. Resolve the bridge migration requirement above and the installed-host feedback acceptance
   findings before scheduling publication. Record the compatible version combinations and
   rollout/recovery procedure against the checked candidate. Store availability alone is not
   sufficient. The current Codex findings are tracked in the
   [IPC report](engineering/codex-desktop-ipc.md#release-blocking-installed-host-findings).
3. Follow that verified transition when dispatching `publish-mcp.yml` from the checked candidate
   ref with `tag=latest`. Its `prepublishOnly` hook rebuilds the
   package before npm publication. Confirm that both `npm view @tempad-dev/mcp@0.8.0 version` and
   `npm view @tempad-dev/mcp@latest version` return `0.8.0`. A `next` publication may be used for
   isolated candidate testing; it neither completes the migration nor changes release plugin
   configurations away from `latest`.
4. Merge the approved candidate so the marketplace serves Agent Plugin 0.2.0. Verify that the
   standard, plugins-CLI, Codex, and Claude manifests agree, and that each generated package
   carries only its own channel's manifests. Do not publish the Agent Plugin through `publish-plugins.yml`; that
   workflow owns the separate `@tempad-dev/plugins` SDK.
5. Check the installed extension version, npm dist-tag, and installed plugin/skill versions before
   announcing canvas-authoring availability. If a user-facing live authoring check is needed,
   follow [the authoring evolution runbook](testing/agent-authoring-evolution.md).

Use the [plugin upgrade guide](../agent-plugin/src/README.md#upgrading) for existing
installations. It covers the Node.js requirement, extension reload, plugin/skill update, stable MCP
configuration, client reconnection, and target-tab selection.
