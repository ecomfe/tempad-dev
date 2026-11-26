# Releasing TemPad Dev

TemPad Dev has three independently distributed integration parts:

| Part              | Version source                     | Distribution                            |
| ----------------- | ---------------------------------- | --------------------------------------- |
| Browser extension | `packages/extension/package.json`  | Chrome Web Store; build with `pnpm zip` |
| MCP server        | `packages/mcp-server/package.json` | npm through `publish-mcp.yml`           |
| Agent Plugin      | `agent-plugin/src/plugin.json`     | Git marketplace on `main`               |

`@tempad-dev/plugins` is the separate code-output SDK, published through `publish-plugins.yml`.
Use each package's changelog for release contents and the compatibility requirements below for
rollout decisions. Keep published extension entries even when the corresponding store artifacts
were prepared before their source changes were committed.

## Prepare the candidate

1. Resolve the branch against current `main`, include all intended source files, and update the
   package changelogs and English/Chinese installation guidance. Obtain explicit authorization
   before creating commits, as required by the repository's agent guide.
2. Bump `agent-plugin/src/plugin.json` and update its changelog whenever released skills, hooks,
   or manifests change. Run `pnpm agent-plugin:build` after changing any authored input. Inspect the
   generated output under `agent-plugin/targets/`, `.plugin/marketplace.json`,
   `.agents/plugins/marketplace.json`, and `.claude-plugin/marketplace.json`. Run
   `pnpm agent-plugin:check-installer` to verify marketplace routing and MCP discovery with
   the actual installer. Release MCP configuration must use `@tempad-dev/mcp@latest`.
   CI runs `pnpm agent-plugin:check-version <base>` against committed source and target payloads,
   requiring a stable `x.y.z` increase; package-root README and changelog edits alone are exempt.
3. Run the checks in [TESTING.md](../TESTING.md), then `pnpm format:check`, `pnpm build`, and
   `pnpm zip`. Ordinary build must not change tracked agent-plugin files. The extension archive is
   written to `packages/extension/.output/` with the version from the extension package.
   ZIP packaging rejects checkout profiles; unset `TEMPAD_MCP_DEV_CHECKOUT` before packaging.
   The build log prints the selected profile.
4. Run `pnpm mcp:prepare-release-dependencies` with network access to cache and verify the exact
   frozen production dependency graph without running package scripts. A workspace install alone
   may leave its offline verification metadata incomplete. Use the same pnpm cache for preparation
   and packaging; the temporary deployment is removed and no release artifact is created.
   Prepare the reviewed MCP policy below, then run
   `pnpm mcp:prepare-release --output <absolute-new.tgz> --verify-baseline`.
   It uses an offline, script-free hoisted deploy from the frozen workspace lock, verifies the
   complete dependency closure, and probes the packaged runtime outside the workspace.
   Plain workspace `npm pack` can include pnpm store paths outside the package and is not a
   publishable runtime. Inspect the verified tarball and its `.tgz.json` manifest/integrity receipt.
   The tarball includes source locations for Node's `--enable-source-maps`. To inspect embedded
   source text, use the full `dist/*.mjs.map` from that build (CI archives `tempad-mcp.maps.tgz`).
   Match each full map against `fullSourceMapHashes` in the receipt for the installed tarball.
   Check MCP initialization and tool discovery on supported Node.js versions.
   Run `node packages/mcp-server/scripts/check-bridge-compatibility.mjs <installed-package-directory>`
   against the unpacked archive to verify the frozen extension contracts using the exact shipped
   Hub and CLI; the publication workflow repeats this check before publishing.
   Run `node packages/mcp-server/scripts/check-log-transport.mjs <installed-package-directory>`
   from the checkout to check the shipped logging worker with its installed dependencies.
   Use separate runtime, state, log, and asset directories for the check so an active local Hub is
   unaffected. Restrict the smoke Hub's allowed extension origin to a dedicated test origin,
   remove inherited host task-identity variables from its child environment, and verify its
   runtime identity points at the installed tarball. Close the smoke client and confirm that
   only its isolated Hub exits. Test the Node.js versions declared by the package's `engines` field.
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

Release setup launches `npx -y @tempad-dev/mcp@latest`. Moving the npm `latest` tag affects
subsequent launches. Before MCP 1.0.0, running CLI and Hub processes do not update themselves;
a newly launched CLI reuses an existing Hub, and an older CLI can restart its own packaged Hub.
Migrating that runtime requires disconnecting all TemPad MCP clients once before restarting
their MCP servers. New clients defer enrollment while that legacy Hub remains alive and keep
using its byte bridge; ordinary MCP startup must not fail merely because older work is ongoing.
The extension separately waits for Chrome Web Store review and staged rollout. Neither npm nor
store publication establishes that users are running the update or have reloaded Figma.

Verified MCP 1.0.0 releases default to stable runtime updates on macOS, Linux and Windows. Agent Plugin
1.0.0 and shared installation snippets also select `--runtime-updates=stable` explicitly.
Publish the verified MCP release before shipping these plugin targets or setup instructions.
Checkout and unverified builds never acquire release updates. Compatible Hub updates activate for initialized MCP sessions
with negotiated waiting support at an idle boundary. Claude additionally requires a verified
session with receipt/retry-capable hooks; `off` and
`pinned` policies remain available. See the [runtime design](engineering/mcp-runtime-updates.md).

MCP 2.0 supports TemPad Dev extension **1.0.0 and later**. Extension 1.0.0 uses the
`tempad-mcp` WebSocket subprotocol and declares protocol 15 in its runtime hello. Select
capabilities such as terminal receipts from the wire handshake. A compatible handshake from
an older build does not extend the supported
version range.

1. Run `pnpm mcp:check-bridge` against the built Hub and unpacked release. Exercise the
   minimum supported extension's receiving contract as well as the candidate's optional features.
   Verify reads, writes, task fences, assets and reconnects. Reject unversioned connections
   and unsupported protocol versions before admitting tool calls.
2. Verify a managed upgrade from the published baseline and a rollback after the last client
   disconnects. For this boundary, run
   `node packages/mcp-server/scripts/check-bridge-migration.mjs <verified-2.x.tgz> <published-1.0.5.tgz>`
   with the candidate's packaging receipt beside its archive. Verify preservation of private
   state and task fences across normal startup and explicit rollback. A stable CLI from
   2.0.1 upgrades a fully stopped 1.x runtime and lets active 1.x sessions finish.
3. Verify the 1.0.0 extension and current candidate in an isolated browser profile. Complete
   installed-host acceptance before publishing. Update any pre-1.0 browser installations and
   reload Figma before migrating their Hub.

Older extensions install both standalone skills with a single name filter. The installer
accepts a partial match, so retain the `figma-canvas-authoring` migration notice in the
standalone target. It gives users the exact command for installing `design-in-figma`.

Preserve `figma.js`, `figma.json`, and `figma.comply.json` at their existing `gh-pages` URLs.
Published extensions used these URLs before rewrite resources were bundled. Some also persist
the remote script redirect across Chrome restarts. Users recover by updating the extension
and reloading Figma. Keep the upgrade fixture for direct updates that skip intermediate versions.

## Publish the coordinated release

The Agent Plugin follows `main` and launches the npm `latest` tag. Make the required stable MCP
version available before exposing the new plugin on `main`.

For the initial MCP 1.0.0 rollout, the reviewed branch already contains the dependent plugin.
Keep its release PR in draft while the candidate passes the build, rewrite, Windows runtime,
and installed-archive checks. A release maintainer can then publish the exact verified MCP
tarball from an authenticated environment with
`npm publish <verified.tgz> --ignore-scripts --access public --tag latest`.
Verify the registry version, dist-tag, and integrity against its `.tgz.json` receipt before merging
the candidate to `main`. This one-time bootstrap preserves the reviewed commit history and avoids
exposing the plugin early; it does not relax any artifact or compatibility check. Subsequent
releases use the main-only publication workflow below, with dependent plugin changes held back
until their runtime is available.

1. Prepare the Chrome Web Store submission using the archive from the checked candidate. Retain
   its SHA-256 digest and the exact source revision.
2. Resolve the bridge migration requirement above and the installed-host feedback acceptance
   findings before scheduling publication. Record the compatible version combinations and
   rollout/recovery procedure against the checked candidate. Store availability alone is not
   sufficient. The current Codex findings are tracked in the
   [IPC report](engineering/codex-desktop-ipc.md#original-installed-host-findings), including
   the later acceptance evidence preceding the original findings.
3. For later runtime releases, merge the checked MCP change to `main` before dispatching `publish-mcp.yml`
   with `tag=latest`; publication workflows reject other branches. Keep plugin changes that
   require that runtime in a separate follow-up until publication is verified. The workflow publishes
   only the verified tarball with scripts disabled; directory publication is rejected by
   `prepublishOnly`. Confirm the published integrity, exact package version, and
   `npm view @tempad-dev/mcp@latest version` match the checked package manifest. A `next` publication may be used for
   isolated candidate testing; it neither completes the migration nor changes release plugin
   configurations away from `latest`.
4. Merge the approved candidate so the marketplace serves the checked Agent Plugin version. Verify that the
   standard, plugins-CLI, Codex, and Claude manifests agree, and that each generated package
   carries only its own channel's manifests. Do not publish the Agent Plugin through `publish-plugins.yml`; that
   workflow owns the separate `@tempad-dev/plugins` SDK.
5. Check the installed extension version, npm dist-tag, and installed plugin/skill versions before
   announcing canvas-authoring availability. If a user-facing live authoring check is needed,
   follow [the authoring evolution runbook](testing/agent-authoring-evolution.md).

Use the [plugin upgrade guide](../agent-plugin/src/README.md#upgrading) for existing
installations. It covers the Node.js requirement, extension reload, plugin/skill update, stable MCP
configuration, client reconnection, and target-tab selection.

## Runtime release policy

The release maintainer owns `packages/mcp-server/runtime-policy.json`. PRs identify guidance
impact in review; release preparation aggregates it into one decision, rationale, candidate
version, and current stable baseline version/integrity. Review the cumulative set of shipped
instructions and descriptions sharing the epoch, including behavior changes with unchanged
text. Keep the epoch only if that guidance remains valid; otherwise increase it. Never reuse
an earlier epoch after reverting text. Hash equality cannot establish semantic compatibility.

After review and final source formatting, obtain the candidate hash with
`node packages/mcp-server/scripts/prepare-runtime-release.mjs --source-hash` and record it in
`guidanceReview.sourceHash`. Any covered source/contract/lock change invalidates the review.
The packager derives wire/presentation and file hashes from the built runtime, checks compiled
control/extension protocol declarations, validates the complete dependency closure and Node
requirements, and verifies the baseline against npm `latest`. Missing historical manifests are
allowed only for the first epoch; that release requires a coordinated restart. CI archives the
exact tarball and manifest receipt, then confirms npm serves that same integrity.

Each same-epoch release promises compatibility with all earlier presentations in that epoch,
including skipped releases. Session wire hashes and epochs must match, state must remain readable
in both directions, and the released extension adapters must remain available. The current control
protocol is 2; unpublished protocol 1 fixtures must restart in a new isolated runtime root.
Stable 0.11.0 predates managed control, so this does not retire a released protocol. Retirement
of a released protocol is blocked by the packager and needs a separate migration
review: retain the current and previous stable generations and at least 90 days after a successor
becomes stable. Breaking boundaries are 0.x minor changes, 1.0, and later major changes.

Explicit switches require interactive `--update-runtime <exact-version>` confirmation of that
artifact's version and integrity; approval never bypasses compatibility or attached-client policy.
Enrolled, initialized MCP sessions may automatically activate a compatible stable candidate within the
same breaking-release boundary after five idle seconds. All edges must acknowledge bounded
pre-dispatch waiting; old edges and unverified or legacy Claude hooks keep candidates staged. Automatic
shutdown rechecks readiness and defers immediately if work arrives, without waiting through a
long drain or killing work. Verified releases default to this stable policy; generated plugin
arguments and shared installation snippets make it explicit with `--runtime-updates=stable`.
Use `--runtime-updates=off` to disable acquisition and automatic switching, or `pinned` to enforce
the installed artifact. Checkout configurations must never carry release enrollment. Publish
MCP 1.0.0 before Agent Plugin 1.0.0 and the updated installation guidance. An old cached CLI
may ignore the flag; that does not prove enrollment, which requires the runtime's status evidence.

Publish the compatible hook receiver before Agent Plugin 1.0.0's receipt/retry payload. Current
bindings must demonstrate v2 capability; plugin version or elapsed rollout time is not evidence.
Legacy/unknown Claude bindings defer switching. Retain the legacy 750 ms hook path and downgrade
only on an explicit unsupported-version reply. The acquisition fixture and Phase 2 fault matrix
are publication checks, but do not replace Phase 4 installed Codex/Claude acceptance.

The publish workflow requires the Windows matrix in the [runtime workflow](../.github/workflows/runtime.yml)
to pass all Node 22 and 24 suites at the same commit before publishing a manifest that includes
`win32`. It exercises real ACL checks, named pipes and processes across acquisition, switching and
recovery; it does not establish Windows desktop-host acceptance. Preserve its logs with the release
evidence.
