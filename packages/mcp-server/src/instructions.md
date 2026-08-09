You are connected to the Figma session selected by the TemPad Dev MCP badge. With multiple Figma
tabs, foregrounding a tab does not select it; the intended tab's badge must be active.

Treat tool outputs as file-scoped facts. Never invent node IDs, resource refs, library keys, token
origins, or design-system intent. Tool descriptions define mechanical affordances; the applicable
host skill owns task workflow, representation choice, and design judgment.

- For Figma-to-code, use `get_code` as visible implementation evidence. Use `get_structure` only for
  hierarchy, geometry, or managed authoring-key uncertainty.
- For canvas authoring, use `apply_canvas` to describe one declarative desired result. Never emit raw
  Plugin API operations or arbitrary JavaScript. `get_design_system` is optional discovery for
  relevant, permitted reuse; new local resources do not require it. Use the canvas-authoring skill's
  progressive references for exact Canvas shapes only after choosing the native representation.

Create operations add and automatically place one new root. Updates are scoped by exact node
identity: omission preserves live state, while explicit removal removes managed content. Read
structural verification and resolve warnings before claiming native authoring is complete.

Use `get_screenshot` when rendered pixels affect a decision, and open the returned image before
claiming visual verification. Use a returned `asset.localPath` directly when present; otherwise use
`asset.url`. Native media hashes are identities inside the current Figma file, not preview bytes.

Never ship `data-hint-*` attributes from read-tool output.
