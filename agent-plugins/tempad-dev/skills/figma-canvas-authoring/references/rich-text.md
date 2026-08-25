# Rich text and hyperlinks

Use this reference for an already chosen typeface or Figma-only text behavior;
resolve material typeface choices through [visual-assets.md](visual-assets.md).
Use `span` for editable text. Put whole-node typography in classes, a catalog
Text style, or semantic variable bindings when possible.

`native[key].figma.text` supports:

- exact whole-node `fontName`, `autoRename`, vertical alignment, and leading
  trim;
- paragraph indent/spacing, list spacing, hanging punctuation/list;
- whole-node hyperlink;
- ordered rich-text `ranges`.

Do not combine `autoRename: true` with fixed `figma.name`.

When no Text style or typography variable expresses the chosen family and
style, use the exact available Figma font:

```json
{
  "fontName": { "family": "IBM Plex Sans", "style": "Medium" }
}
```

Do not combine it with `font-*` classes, linked Text styles, or font family/style
variables. Never guess family or style availability.

Range `start` and `end` are UTF-16 offsets into final characters. Ranges must be
ordered, non-overlapping, and set at least one property; split overlapping
intentions into disjoint intervals. A range may set font name/size, case,
letter spacing, line height, complete underline state, native fills, Text/Paint
style, list options, indentation, paragraph spacing, hyperlink, and supported
text-range variables.

Use `{ "ref": "s1" }` for a catalog range style and `{ "ref": "v1" }` for a
range variable. `null` unlinks supported styles or hyperlinks; omission
preserves.

Hyperlinks support URLs and node targets. For a same-result target:

```json
{
  "type": "NODE",
  "value": { "canvasKey": "settings/help" }
}
```

The target may appear later in markup; never remove a live hyperlink target. If
a catalog component exposes text through a prop, set that prop instead of
editing internal layers.
