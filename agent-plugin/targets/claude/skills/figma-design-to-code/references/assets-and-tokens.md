# Translate assets and tokens

Read the relevant section when implementing returned assets or token-dependent
code, including references whose token metadata is missing.

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
pause the work that depends on it; do not draw or substitute it from memory.

## Tokens

Preserve token usage when the target project can carry or map it safely.
`resolveTokens` controls code output; `tokens` always describes definitions,
including literals, aliases, and mode maps keyed by `Collection:Mode`. Reading
consumer literals does not decide whether the implementation should use tokens.
An alias target can belong to a different collection with independently selected
modes. Preserve alias relationships; do not substitute the target's default mode
or assume it shares the source collection's mode.

- Map to an existing project token only when value, reference behavior,
  semantics, and relevant mode agree. A similar name is insufficient.
- Preserve TemPad token references through the project's normal token workflow
  when that workflow can accept them.
- Add a token only when the project already defines how and this task calls for
  it.
- If no project-token mapping is justified, use a verified consumer literal
  when compatible with the user's requirements and project policy, and report
  the fallback. If token representation is required, resolve the mapping
  decision before implementing the affected part.
- Root mode hints include inheritance from outside the exported subtree;
  descendant hints describe explicit overrides. Use them to interpret the
  relevant consumer, and never ship hint attributes.

If a needed consumer value is unknown, make a targeted `get_code` read with
`resolveTokens: true` for its exact node or a subtree containing it, preserving
the session/task scope and other read options. Retain the original composition;
use the extra read for the missing value. Verify that the value actually became
a literal and inspect warnings. `get_token_defs` supplies definitions without a
consuming node and cannot establish that node's actual value.

Definitions and a consumer's rendered value need not have the same literal
representation. If they still contradict after accounting for aliases and
effective modes, narrow the design evidence or ask which state is intended.
For unavailable or ambiguous facts, follow the token warnings in
[recovery.md](recovery.md#incomplete-get_code-results).
