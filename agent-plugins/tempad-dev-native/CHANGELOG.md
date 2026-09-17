# Changelog

## 0.2.0

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
