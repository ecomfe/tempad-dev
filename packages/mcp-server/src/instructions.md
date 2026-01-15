You are connected to a Figma design file via TemPad Dev MCP.

Treat tool outputs as design facts. Refactor only to match the user’s repo conventions; do not invent key style values.

Rules:

- Never output any `data-hint-*` attributes from tool outputs (hints only).
- If `get_code` warns `depth-cap`, call `get_code` again for each listed `nodeId` before implementing.
- Use `get_structure` / `get_screenshot` only to resolve layout/overlap/masks/effects uncertainty. Screenshots are for visual verification only; do not derive numeric values from pixels.
- Tokens: `get_code.tokens` keys are canonical names (`--...`). Multi‑mode values use `${collectionName}:${modeName}`. Nodes may hint per-node overrides via `data-hint-variable-mode="Collection=Mode;..."`.
- Assets: fetch bytes via `resources/read` using `resourceUri` when possible; fall back to `asset.url` for large blobs. Preserve SVG/vector assets exactly; never redraw vectors.
