# Choose and apply fonts

Use this reference when selecting or changing fonts, delivering a required
family/style, or resolving uncertainty about the text's scripts. Availability
can change a provisional choice; query before committing when that matters.

Start from applicable Text styles, typography variables, project fonts, or
supplied references. Preserve established font identities for ordinary edits.
For a new direction, form candidates from the language, text roles, density,
and visual intent. A portable `font-sans|serif|mono` category does not establish
an exact family or suitable coverage for the actual text.

## Query what can change the choice

`get_design_system` with `scope: "fonts"` reads the environment without scanning
file resources. It is valid for direct composition, reuse, and an independent
system, including a blank page.

- With candidate family names, use `families: ["Noto Sans SC"]` to inspect
  exact native style names and missing families in one call; batch candidates.
- Use `query: "Noto"` when the family name itself needs discovery. This searches
  names, not language coverage or visual suitability.
- Continue `nextCursor` with the same filters only when more results could
  affect the choice. Reuse current evidence rather than querying per text node.

Use returned or source-established native names. For an unavailable provisional
candidate, reconsider the choice. For a required font, preserve the requirement
and disclose the delivery gap rather than silently substituting another family.

## Apply the selected typography

Reuse the applicable TextStyle or font variables. If a new design system is in
scope, define the selected text roles as TextStyles and consume their `type-*`
classes through [resource-mapping.md](resource-mapping.md). Font selection alone
does not require creating styles or tokens.

For direct composition, `font-[family-name:Noto_Sans_SC] font-semibold` fixes
the family and chooses its closest available weight. Underscores encode spaces;
`\_` preserves an underscore. Use `native[key].figma.text.fontName` with exact
`{ family, style }` when the native style identity matters; see
[rich-text.md](rich-text.md). Weight matching is approximate. For variable-driven
typography, consider the family/weight/style combinations in the delivered modes.

Inspect representative real content in the composition, including relevant
scripts, numbers, punctuation, and wrapping. Availability and successful loading
do not prove glyph coverage; a correct-looking screenshot alone does not prove
native font identity or current editability. Reopen the font choice when the
observed text challenges it, without requiring a separate specimen board.
