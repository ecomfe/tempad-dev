# Rich text and hyperlinks

Use this reference for native font application or Figma-only text behavior;
use [typefaces.md](typefaces.md) when font selection or availability needs resolving.
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

Numeric font size, line height, and letter spacing can also affect a `\n`
immediately after a range. Give adjacent ranges explicit, consistent ownership.
If an error identifies a retained Text style at that boundary, keep the earlier
range unchanged or explicitly replace the affected style only when that is the
intended design; expanding a range can overwrite the next range's formatting.
Do not retry an unchanged request that reports this native limitation.

Variable `null` is verified after application. Paragraph indent and spacing apply
to the affected paragraphs, even when the requested range covers only part of
their text. Figma may retain a paragraph alias after unlinking; TemPad tries to
preserve its current literal value without changing the next paragraph. If no
safe fallback exists, including on an empty paragraph, it reports failure rather
than claiming the binding was cleared. Follow the returned readback requirement
and inspect affected text and resources before another write. Then preserve the
binding or explicitly replace the affected paragraph as the intended design requires.

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
