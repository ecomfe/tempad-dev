# Rich text and hyperlinks

Use this reference to encode an already chosen typeface or Figma-only text
behavior. Resolve a material typeface choice through
[visual-assets.md](visual-assets.md) first. Use a `span` for editable text;
whole-node typography normally belongs in classes, a catalog Text style, or
semantic variable bindings.

`native[key].figma.text` carries Figma-only state:

- exact whole-node `fontName`, `autoRename`, vertical alignment, leading trim;
- paragraph indent/spacing, list spacing, hanging punctuation/list;
- whole-node hyperlink;
- ordered rich-text `ranges`.

Do not combine `autoRename: true` with a fixed `figma.name`.

Use an exact whole-node font when no catalog Text style or typography variable
expresses the intended family and style:

```json
{
  "fontName": { "family": "IBM Plex Sans", "style": "Medium" }
}
```

Do not combine it with `font-*` classes, a linked Text style, or font family or
style variables. Figma must have the exact family and style available.

Range `start` and `end` are UTF-16 offsets into the final span characters.
Ranges must be ordered, non-overlapping, and contain at least one actual
property. Split overlapping intentions into non-overlapping intervals.

A range can set:

- font name/size, case, letter spacing, line height;
- complete underline state;
- native fills;
- Text/Paint style;
- list options, indentation, and paragraph spacing;
- hyperlink;
- supported text-range variables.

Use `{ "ref": "s1" }` for a catalog range style and `{ "ref": "v1" }` for
a range variable. `null` unlinks a supported style or hyperlink; omission
preserves live state.

Hyperlinks support URL and node targets. For a same-result node target, use:

```json
{
  "type": "NODE",
  "value": { "canvasKey": "settings/help" }
}
```

The target may appear later in markup. Do not remove a node that remains a
hyperlink target.

If a component exposes text through a catalog prop, set the component prop
instead of reaching into its internal text layers.
