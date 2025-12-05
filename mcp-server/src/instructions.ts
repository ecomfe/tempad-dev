export const MCP_INSTRUCTIONS = `
## MCP Server Instructions (Design to Code)

### P0 (must)

- Do not output \`data-hint*\` attributes. They are guidance only.
- For SVG/vector assets: use the exact provided asset (preserve \`path\` data and \`viewBox\`). Never redraw or approximate vectors.

### P1 (policy)

- Prefer calling \`get_structure\` early to understand hierarchy and layout intent.
- Treat \`get_code\` as the implementation baseline; refine it to match the current project’s conventions.

### Layout uncertainty (\`data-hint-auto-layout\`)

- If \`data-hint-auto-layout\` is \`none\` or \`inferred\`, treat layout as uncertain.
- Use \`get_structure\` geometry (positions, sizes, gaps, alignment, bounds) to choose layout. Prefer flex/grid when patterns support it; use absolute only when necessary.

### Component intent (\`data-hint-component\`)

- If \`data-hint-component\` suggests a reusable component/variant and repetition supports it, factor it into a component API (props/variants). Do not preserve the hint string in output.

### Assets and tokens

- If \`get_code\` references assets, call \`get_assets\`, save with semantic stable names, and rewrite to local relative paths.
- Treat \`usedTokens\` as intent signals. Follow project convention: map to existing tokens when appropriate, keep inline values when that is the style, and add new tokens only when it fits convention and improves reuse.

### Verification

- Use \`get_screenshot\` only when structure and hints cannot resolve major ambiguities, or to sanity-check the final result.
`.trim()
