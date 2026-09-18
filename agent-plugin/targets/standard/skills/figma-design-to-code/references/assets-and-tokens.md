# Translate assets and tokens

Read this reference only when `get_code` returns `assets` or `tokens`.

## Assets

Follow the project's established asset and icon policy before TemPad delivery
details.

- Download bytes only from a TemPad-provided `asset.url`. Never substitute a
  public internet asset.
- Treat assets as files to store or reference, not text evidence to parse.
- If project policy forbids storing them, reference TemPad URLs only when the
  user accepts the local-server dependency, and report it.
- Treat emitted `<svg data-src="...">` markup as design truth for structure,
  size, and instance color. Refactor delivery only through an existing project
  SVG path.
- If upload falls back to inline SVG, preserve that markup rather than
  resynthesizing the vector.
- `themeable: true` permits one contextual color channel, usually
  `currentColor`; drive it through the established wrapper or icon convention.
  Preserve internal palettes when `themeable` is absent.
- Do not invent a new SVG pipeline, multi-color props, or custom variables.

If a required asset cannot be retrieved or represented under project policy,
stop rather than draw or substitute it from memory.

## Tokens

Preserve token usage when the target project can carry or map it safely.
Token facts may be direct values or mode-specific values keyed by
`Collection:Mode`; preserve aliases between variables when present.

- Map to an existing project token only when value, reference behavior,
  semantics, and relevant mode agree. A similar name is insufficient.
- Preserve TemPad token references through the project's normal token workflow
  when that workflow can accept them.
- Add a token only when the project already defines how and this task calls for
  it.
- If landing location, mode, or mapping remains ambiguous, use the exact
  rendered value and report the fallback.
- Use hint metadata only while reasoning about a mode; never ship hint
  attributes.

When tokens and explicit rendered values disagree, do not silently choose.
Narrow the design evidence or ask the user which source expresses the intended
state.
