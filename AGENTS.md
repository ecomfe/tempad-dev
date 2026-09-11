# Tempad Dev — agent guide (root)

## Purpose

Use this file as the repo-wide router and source of global invariants. Read only
the package guide and conditional runbook required by the task; do not preload
every linked document.

## Repository routing

| Work area                     | Read next                       | Responsibility                                                                   |
| ----------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `packages/extension/`         | `packages/extension/AGENTS.md`  | Figma extension, UI, codegen, browser runtime, and MCP tool implementation       |
| `packages/mcp-server/`        | `packages/mcp-server/AGENTS.md` | MCP server, Hub, transport, and tool exposure                                    |
| `packages/shared/`            | `packages/shared/AGENTS.md`     | Shared schemas, types, and contracts                                             |
| `packages/plugins/`           | `packages/plugins/AGENTS.md`    | Plugin transforms and sandboxed plugin-side code                                 |
| `skill/` and `agent-plugins/` | This guide                      | Shared agent skills, manifests, compatibility wrappers, and marketplace metadata |

For a cross-package change, read the guides for every affected package. For a
repo-wide documentation, configuration, or release task, this root guide is the
default authority unless a routed document says otherwise.

## Repo-wide invariants

- Package manager: `pnpm`. Prefer repo-level scripts unless a package guide
  explicitly requires a filtered command.
- Keep changes minimal and consistent with existing style. Do not add global
  dependencies without explicit approval.
- When a tool schema or shared contract changes, update `packages/shared` first,
  then `packages/mcp-server`, then `packages/extension`.
- Generated artifacts are not source. Follow the owning workflow and never edit
  ignored or generated output to simulate a source change.
- Do not create or amend commits unless explicitly requested. When creating a
  commit, use Conventional Commits.
- Keep pull request descriptions concise. Do not add a validation section unless
  explicitly requested.

## Agent plugin invariants

- `agent-plugins/tempad-dev/` is the tracked release source shared by Codex and
  Claude. The plugin is distributed through the Git marketplace, not npm.
- Edit `skill/` for `figma-design-to-code`; the development generator copies it
  into the tracked release plugin. Edit the tracked
  `agent-plugins/tempad-dev/skills/figma-canvas-authoring/` source directly.
- The portable `plugin.json` and `mcp.json` own shared manifest and MCP fields.
  `pnpm agent-plugin:dev` synchronizes client compatibility wrappers, the copied
  design-to-code skill, derived icons, and shared marketplace metadata; do not
  hand-edit those derived fields or copies.
- `.dev/plugins/tempad-dev-dev/` is the ignored local build. Generate it with
  `pnpm agent-plugin:dev`; never edit it directly.
- Run `pnpm agent-plugin:dev` after a change to any generator input, inspect all
  tracked synchronized outputs, and include the intended release-source changes.
  Ordinary `pnpm build` must not modify agent-plugin artifacts.
- Keep Codex and Claude development support equivalent. Both manifests must
  launch the same working-tree MCP runtime.
- Release MCP configuration must use `@tempad-dev/mcp@latest`, never an alpha
  tag, fixed version, or local path.
- Before preparing, running, reviewing, or asking the user to test an end-to-end
  Figma authoring task, read `docs/testing/agent-authoring-evolution.md`. It is
  the sole detailed runbook for runtime refresh, plugin replacement, clean-task
  identity, evidence review, fix placement, and candidate promotion.

## Core commands

Run these from the repo root:

| Task                              | Command                       |
| --------------------------------- | ----------------------------- |
| Development                       | `pnpm dev`                    |
| Build all packages                | `pnpm build`                  |
| Typecheck                         | `pnpm typecheck`              |
| Lint / auto-fix                   | `pnpm lint` / `pnpm lint:fix` |
| Test once                         | `pnpm test:run`               |
| Coverage                          | `pnpm test:coverage`          |
| Format                            | `pnpm format`                 |
| Generate development agent plugin | `pnpm agent-plugin:dev`       |

Use package-owned commands from the applicable package guide when a narrower
check is sufficient.

## Conditional documentation

| Task                                                    | Read first                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| Test selection, required checks, or troubleshooting     | `TESTING.md`                                                    |
| Test runtime or coverage architecture                   | `docs/testing/architecture.md`                                  |
| End-to-end authoring evolution or live agent evaluation | `docs/testing/agent-authoring-evolution.md`                     |
| Extension implementation or MCP behavior                | `packages/extension/AGENTS.md`, then its routed design document |
| Public agent-plugin installation or usage documentation | `agent-plugins/tempad-dev/README.md`                            |
| Marketing screenshot work                               | `docs/marketing-screenshots.md`                                 |

## Verification

Follow `TESTING.md` and every affected package guide. The default repository
checks are:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test:run`

Add build, browser, packaging, rewrite, coverage, or live Figma checks only when
the routed guidance and change risk require them. Browser runtime tests must use
Playwright; do not introduce jsdom-based tests.
