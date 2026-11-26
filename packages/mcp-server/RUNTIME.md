# TemPad Dev MCP runtime reference

[简体中文](RUNTIME.zh-Hans.md)

## Runtime update controls

Run these commands in a terminal with the same environment overrides as the MCP client.

| Action                                                                      | Command                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| See active and staged versions, compatibility blockers, and search progress | `npx -y @tempad-dev/mcp@latest --runtime-update-status`    |
| Find the newest compatible stable release at or below the npm `latest` tag  | `npx -y @tempad-dev/mcp@latest --check-runtime-update`     |
| Confirm an exact version and its integrity before a compatible switch       | `npx -y @tempad-dev/mcp@latest --update-runtime <version>` |

Verified releases default to `--runtime-updates=stable` on macOS, Linux, and Windows. If an older
unmanaged Hub is still running, disconnect all TemPad MCP clients once and reconnect to enroll.
Task and asset storage carry over. Checkout and unverified local builds stay on their bundled
runtime and reject explicit enrollment.

Switching requires compatible tool contracts and guidance, initialized clients on the stable
policy, and completed operations. Older Claude hooks can prevent switching. Automatic activation
also requires clients that can wait through a switch. Connected Claude clients need verified
sessions with hooks that support acknowledgments and retries. The supervisor rechecks eligibility
after five seconds without calls, transfers, or native actions. Undispatched requests can wait up to
ten seconds. Already dispatched writes are never replayed. The current Hub keeps serving while busy
or during download failures. A compatible switch preserves each client's tool descriptions. Figma
reconnects, and design tasks may need to resume and read back the canvas. The CLI, supervisor,
Node.js, extension, and host plugin still use their normal upgrade or restart procedures.

- Use `--runtime-updates=off` to stop background checks once the last enrolled client disconnects.
- Use `--runtime-updates=pinned` with an exact npm version to enforce the launch package version. If it conflicts with the active Hub, disconnect its clients before restarting.

## Migrate or roll back a managed Hub

With the standard `@latest` setup, MCP 2.0.1 upgrades a managed 1.x Hub on the first launch after all
MCP clients disconnect and both the Hub and supervisor exit. If another host is still connected,
both hosts continue to use 1.x for that session. Tasks, assets, and write restrictions from Stop
actions or unconfirmed operations carry over. Update any extension older than 1.0.0 and reload the
Figma tabs that use MCP before migrating.

To roll back to a retained 1.0.5 release, disconnect every TemPad MCP client and wait for the Hub and
supervisor to exit. Then run the migration command.

```sh
npx -y @tempad-dev/mcp@2.0.1 --migrate-runtime 1.0.5
```

Enter `update 1.0.5` and verify the active version before reconnecting. Substitute the actual retained
version in the command and confirmation if it differs. A rollback with 2.0.1 persists across normal
launches. To upgrade again, disconnect every client and use the same command to select the installed
2.x version. If you rolled back with 2.0.0, pin the host to the retained 1.x package before its next
launch to stay on 1.x.

## Configuration

### Tool timeouts

All values are in milliseconds. A valid `TEMPAD_MCP_TOOL_TIMEOUT` override replaces the specialized
defaults below. A valid override for a specific tool takes precedence.

| Variable                               |  Default | Applies to                                                                                                                        |
| -------------------------------------- | -------: | --------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPAD_MCP_TOOL_TIMEOUT`              |  `15000` | General calls, including node and selection structure reads                                                                       |
| `TEMPAD_MCP_GET_CODE_TIMEOUT`          |  `30000` | `get_code`                                                                                                                        |
| `TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT` |  `45000` | Initial `get_design_system` resource discovery. Continuation, exact-reference, font, and page-list reads use the general timeout. |
| `TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT`    |  `45000` | `get_structure` with an explicit page ID or key, which may need to load a cold page                                               |
| `TEMPAD_MCP_APPLY_CANVAS_TIMEOUT`      | `120000` | `apply_canvas` slow-call warning threshold. At twice this threshold, the Hub reports an unknown outcome.                          |

An unknown write outcome requires definitive completion or session recovery and a successful read
of the affected file before further writes. Read back at least one structure root or code result, or
an exact `get_structure` page snapshot, including an empty page. `CANVAS_APPLY_FAILED` also requires
readback because rollback is unconfirmed, including failures within the undo boundary and those
reported by older extensions. `CANVAS_APPLY_ABORTED` means preparation failed before writing, so the
task can continue without an extra read. The readback requirement survives Hub restarts. Inspect
the canvas before continuing and avoid replaying the write.

### Runtime timing

Use matching settings for processes sharing a runtime. All values are in milliseconds. Writer lock,
control lease, and update idle window overrides accept positive integers up to `2147483647`. Invalid
values use the defaults. Reducing only the expiry or lease also reduces the default heartbeat or
renewal interval to fit.

| Variable                          | Default | Applies to                                                         |
| --------------------------------- | ------: | ------------------------------------------------------------------ |
| `TEMPAD_MCP_AUTO_ACTIVATE_GRACE`  |  `1500` | Delay before automatically selecting the sole connected extension  |
| `TEMPAD_MCP_HUB_LOCK_STALE_MS`    | `60000` | Writer lock expiry, at least `2000`                                |
| `TEMPAD_MCP_HUB_LOCK_UPDATE_MS`   | `10000` | Writer lock heartbeat, at least `1000` and at most half the expiry |
| `TEMPAD_MCP_CONTROL_LEASE_MS`     | `10000` | Runtime control lease, at least `100`                              |
| `TEMPAD_MCP_CONTROL_RENEW_MS`     |  `2000` | Control lease renewal, at most half the lease                      |
| `TEMPAD_MCP_RUNTIME_AUTO_IDLE_MS` |  `5000` | Idle window before an eligible runtime update activates            |

### Extension connections and assets

| Variable                                  |                           Default | Applies to                                                                                                                            |
| ----------------------------------------- | --------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS`    |                              `16` | Simultaneous browser extension connections per Hub                                                                                    |
| `TEMPAD_MCP_MAX_PAYLOAD_BYTES`            |                         `4194304` | Incoming extension WebSocket message size in bytes. Overrides can only lower the protocol ceiling. An invalid value uses the default. |
| `TEMPAD_MCP_MAX_ASSET_BYTES`              |                         `8388608` | Size limit in bytes for captured assets and screenshots                                                                               |
| `TEMPAD_MCP_MAX_ASSET_STORE_BYTES`        |                       `268435456` | Total local asset storage in bytes                                                                                                    |
| `TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS` |                               `4` | Simultaneous asset uploads                                                                                                            |
| `TEMPAD_MCP_ASSET_TTL_MS`                 |                      `2592000000` | Cleanup age in milliseconds since last access. Set `0` to disable.                                                                    |
| `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS`    | Any valid Chrome extension origin | Comma-separated list of exact `chrome-extension://...` origins. Invalid values prevent startup.                                       |

The Hub accepts WebSocket handshakes on the root path from Chrome extension origins. To restrict
access to your installation, set `TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS` to the TemPad Dev extension
origin shown in the browser. Origin checks and per-process asset capabilities reduce cross-origin
loopback abuse. For local-process risks, including another OS user binding the port first, see the
[local MCP threat model](../../docs/security/local-mcp-threat-model.md).

### Directories

| Variable                 | Release default                                                       | Used for                        |
| ------------------------ | --------------------------------------------------------------------- | ------------------------------- |
| `TEMPAD_MCP_RUNTIME_DIR` | `run` under the temporary root                                        | Local runtime files             |
| `TEMPAD_MCP_STATE_DIR`   | `~/.tempad-dev/state`, or `state` under an explicit runtime directory | Durable task and feedback state |
| `TEMPAD_MCP_LOG_DIR`     | `log` under the temporary root                                        | Process and startup logs        |
| `TEMPAD_MCP_ASSET_DIR`   | `assets` under the temporary root                                     | Local asset store               |

The Hub exclusively locks both state and asset directories until it exits, even when Hubs use
different runtime directories. Older releases predate these storage locks. Give concurrently
running versions separate stores. On Unix, all overridden directories must be owned by the
current user, allow only that user access (for example, mode `0700`), and be real directories.

## Startup and connection diagnosis

- **A client cannot connect.** Check stderr first. Transient failures before the first connection
  can retry for the orphaned Hub lock lease (60 seconds by default) plus startup time. Once the
  bridge has worked, transient failures keep retrying. Permission, trust, and invalid-bridge failures
  stop the CLI after three consecutive attempts. Fix the reported cause, then reconnect.
- **The Hub does not become ready.** Look for `startup-mcp-*.log` in the log directory. Each file
  records verification, cache writes, lock waits, and runtime startup up to readiness or failure
  (1 MiB per process). It starts after any `npx` download. The ordinary process logs retain the
  newest 10 MiB per file, mark truncated entries, and are cleaned up seven days after the last
  write for exited processes.
- **Linux reports an untrusted or conflicting runtime path.** The default temporary root is
  `<system temp>/tempad-dev` when the current user owns it and its mode is `0700`. If the legacy
  root is unsafe, the runtime selects `<system temp>/tempad-dev-<uid>` and continues to prefer it
  after it has been created. Active Hub files in both roots or an unsafe root containing active
  Hub files block automatic migration. Shut down existing runtimes and fix ownership and permissions.
  Unix clients and lifecycle hooks check the socket type, owner, and private permissions before
  connecting. Other platforms use `<system temp>/tempad-dev`. Explicit directory overrides take priority.
- **Windows rejects the default runtime root.** Managed storage and named pipes require ACLs that
  restrict access to the current user, SYSTEM, and Administrators. If the current user owns the
  default release root and all grants to other accounts are inherited, MCP can rename it to
  `tempad-dev.legacy` and create a private directory at the original path. Existing files stay in
  the backup. A runtime lock or existing backup blocks this recovery. If startup asks you to
  rename the directory manually, stop all TemPad MCP clients first, then rename it and reconnect.

## Task storage recovery

### A write may still be running

The file stays write-blocked across Hub restarts until the original execution is resolved. Reconnect
the original Figma browser to let the Hub verify completion, tab closure, or document replacement.
Read back the file before writing again. If that browser cannot reconnect, inspect the file and
executor and resolve the block from an interactive terminal.

```sh
npx -y @tempad-dev/mcp@latest --runtime-status
npx -y @tempad-dev/mcp@latest --resolve-runtime-block <block-id>
```

Confirm only after closing the original execution environment. The command retires the execution
and preserves Stop fences. It requires explicit task resume and readback afterward. It cannot stop
remote code, replay the request, or reset task storage.

### A task snapshot cannot be read

If a newer Hub wrote the snapshot, upgrade the runtime and reconnect all clients. If the current Hub
still rejects it, the error identifies the affected path. Reads stay available, while canvas writes
remain blocked across restarts to protect Stop fences. The Hub preserves unreadable state in a
`.corrupt` file when possible.

To restore a backup, disconnect all MCP clients and wait for the Hub to exit. Keep copies of the
original snapshot and any `.corrupt` file. Verify that the replacement is complete and contains the
latest Stop fences, then atomically replace the snapshot at its original path and reconnect.
A `.corrupt` file quarantined by an older Hub may be a valid newer snapshot after upgrade. Verify its
contents and recency before restoring it. Older backups and leftover `.tmp` files may predate a Stop action.

If you have no trustworthy complete snapshot, disconnect all clients and wait for the Hub to exit before running recovery.

```sh
npx -y @tempad-dev/mcp@latest --recover-task-storage
```

Pass the same `TEMPAD_MCP_STATE_DIR` and `TEMPAD_MCP_RUNTIME_DIR` overrides as the MCP client. The
command resolves its path from the terminal environment and reports the snapshot path even when
it refuses recovery. Check that it points to the affected storage. Recovery refuses an active
writer or readable storage. It saves the original files to the reported backup directory and
starts a new task generation. Keep the backups and any quarantine marker.

Every old task stays retired. Old comments cannot resume execution, and writes still require a task.
Every subsequent `begin` must supply `recoveryGeneration`, including in new sessions and after Hub
restarts. Rejected begins disclose the value in `_meta.recoveryGeneration` and in the error text.
Each new task must read its target before writing. The new generation starts with empty task history.
Use a verified snapshot or this recovery procedure to preserve Stop fences.
