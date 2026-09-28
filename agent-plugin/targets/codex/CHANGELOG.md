# Changelog

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
