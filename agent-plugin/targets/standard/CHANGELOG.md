# Changelog

## 0.5.10

- Enable verified runtime downloads and compatible Hub updates between operations. Claude keeps candidates staged pending lifecycle acceptance; Windows and development checkouts keep their bundled runtime.

## 0.5.9

- Retry interrupted Claude lifecycle messages without repeating their effects, including while the runtime is switching.

## 0.5.8

- Kept development Claude hooks connected to their own checkout when a release runtime is also running.

## 0.5.7

- Preserved Unicode text in Claude lifecycle messages and tolerated malformed Hub replies.
- Corrected component sizing examples and guidance for asset storage and shadow inspection.

## 0.5.6

- Clarified safe recovery after failed edits and native text binding limits.

## 0.5.5

- Clarified recovery after uncertain canvas writes and browser compatibility for token-based CSS.

## 0.5.4

- Clarified that unsupported text entity warnings require extension 0.23.5 or later.

## 0.5.3

- Explained warnings for unsupported text entities and clarified Chinese setup guidance.

## 0.5.2

- Clarified supported text entities and recovery after a canvas write fails.
- Aligned upgrade requirements and Chinese Stop guidance.

## 0.5.1

- Fixed Claude session binding so Figma Stop reaches the correct conversation.
- Retained the `figma-canvas-authoring` alias for standalone installs for one extension release
  cycle. New invocations should use `design-in-figma`.
- Corrected design, code-export, and extension upgrade guidance.
- Increased Codex's tool timeout to allow slow canvas operations to report their outcome.

## 0.5.0

- Renamed `figma-canvas-authoring` to `design-in-figma` to match its **Design in Figma**
  display name. Claude invocations now use `tempad-dev:design-in-figma`.
- Updated installation commands and skill previews. Update saved invocations and remove the
  old skill after updating standalone installations. `figma-design-to-code` is unchanged.
- Retained the existing extension and MCP requirements; no runtime upgrade is needed for the rename.

## 0.4.0

- Updated design-to-code guidance for multiple selected roots, per-node results and errors, and
  exact-ID continuation without losing each root's composition or read options.
- Distinguished token definitions from consumer values, with targeted resolved reads for inherited
  modes and cross-collection aliases and explicit recovery for missing or ambiguous token facts.
- Allowed independent work to continue when only part of the requested scope lacks reliable evidence.
- Pairs with extension 0.23.0 and MCP 0.11.0 for the new capabilities. MCP 0.11.0 continues serving
  extension 0.22.0 during the store rollout. Update the plugin and reconnect the MCP client;
  every installation channel continues to use `@tempad-dev/mcp@latest`.

## 0.3.0

- Updated canvas-authoring guidance and Claude lifecycle binding for the unified
  `manage_design_task` tool. Requires MCP 0.10.0 or later; reconnect the client
  to refresh its tool list when updating the plugin.
- Retained compatibility with extension 0.22.0 and `@tempad-dev/mcp@latest` in every release
  installation channel. No extension update is needed for this lifecycle consolidation.

## 0.2.1

- Updated design-to-code recovery to select a connected Figma file by exact session ID instead
  of requiring a manual MCP badge switch.
- Updated design-system reuse guidance to discover page IDs and load a specific component page
  when an unscoped catalog is incomplete.
- Paired this release with extension 0.22.0 and MCP 0.9.0, retaining `@tempad-dev/mcp@latest`
  in every release installation channel.

## 0.2.0

- Routed the `plugins` CLI through its own hook-free compatibility package and marketplace,
  with installer discovery checks for both skills and MCP configuration.
- Added design-task lifecycle guidance and Stop/Done controls. Codex App uses MCP metadata and
  native IPC without hooks; Claude uses installed lifecycle and Stop hooks.
- Documented native Codex App comments, Queue/Steer timing, and element-editor Save & Queue
  shortcuts. Other clients retain task controls without comment delivery.
- Added `figma-canvas-authoring` for creating and editing native Figma designs, alongside the
  existing `figma-design-to-code` skill.
- Added progressive references for native authoring, fonts, images, icons, resource bindings,
  and scoped editing. Direct, Reuse, and Author workflows keep resource decisions tied to the task.
- Grounded new compositions in inspectable evidence and required inspection of the rendered result
  plus relevant native facts, with focused repair of observed defects.
- Made the portable Agent Plugins 1.0 bundle the shared source for installation, with synchronized
  Codex and Claude compatibility manifests and refreshed icons.
- Paired the plugin with extension 0.21.0 and MCP 0.8.0 through `@tempad-dev/mcp@latest`.
  The MCP server requires Node.js 22.x, 24.x, or 26+.
