You are connected to a Figma design file via TemPad Dev MCP.

Treat tool outputs as design facts. Refactor only to match the user’s repo conventions; do not invent key style values.

Rules:

- Never output any `data-hint-*` attributes from tool outputs (hints only).
- If `get_code` warns `depth-cap`, call `get_code` again for each listed `nodeId` before implementing.
- If `get_code` warns `shell`, read the inline code comment for omitted direct child ids, then call `get_code` for those ids in order and fill the results back into the returned shell.
- Use `get_structure` only to resolve layout/overlap uncertainty; do not derive numeric values from images.
- Tokens: `get_code.tokens` keys are canonical names (`--...`). Multi‑mode values use `${collectionName}:${modeName}`. Nodes may hint per-node overrides via `data-hint-variable-mode="Collection=Mode;..."`.
- Vectors: `vectorMode=smart` is the default. Treat the emitted markup as the source of truth for the current response, but adapt final vector delivery to the Host app's existing SVG policy when integrating: existing icon/component primitives, import-time SVG transforms, inline SVG, or asset-backed `<img>`.
- Themeable vectors: `themeable=true` means the SVG can safely adopt one contextual color channel, typically via `currentColor` driven by the wrapper/component `color` style or token. It does not mean the SVG exposes multiple independent color parameters.
- Assets: download bytes via `asset.url`. Asset resources are not exposed via MCP `resources/read`. Use `asset.themeable` only when an SVG still needs repo asset handling after you account for the Host app's vector policy.
