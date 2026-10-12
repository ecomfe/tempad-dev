# Deliver icons

Use this reference only after the composition selects an icon role. It does not
require icons, set an icon count, or choose a family or visual style.

Prefer permitted current-file, catalog, project, or user sources; otherwise use
a trustworthy brief-compatible source and record material license constraints.
When inspected evidence establishes a family or geometry, use that permitted
source or a compatible one. A general library is a fallback only when its
stroke or fill, optical weight, corners, negative space, and platform semantics
remain coherent. Do not diversify sources by quota.

Import exact SVG geometry. Never redraw a known icon from memory or replace an
icon role with Unicode, emoji, TEXT, or assembled primitives. A character,
shape, or cluster that communicates an affordance, object, or semantic category
is an icon role even when beside a worded label. Before markup, scan literal
text for pictographic Unicode, emoji, and symbols and route each qualifying mark
to a permitted vector source. Simple geometry remains valid only when it is
itself the intended status or data mark, divider, decoration, or brand shape.

Search results and snippets identify external candidates only; they establish
neither geometry nor license. Open the governing license once and fetch or open
every exact SVG used before markup. If either remains uninspected, omit an
optional icon or report a required gap instead of inventing one.

For Direct delivery, give the icon a childless `div` whose classes supply the
decided wrapper bounds. Declare the inspected SVG document in
`assets[assetKey]` with `type: "SVG"`, then set
`native[nodeKey].figma.svg.assetKey` to that alias. An optional `color` resolves
`currentColor`; omit it for explicit-color SVGs. Figma may import a Frame with
Vector children; treat that subtree as one opaque asset and never flatten or
reconcile it.

This complete Direct recipe demonstrates the required shape, not a design
default; its identifiers and values stand in for the already-decided role and
inspected source:

```json
{
  "mode": "create",
  "markup": "<div data-key=\"search-icon\" class=\"size-[24px]\"></div>",
  "assets": {
    "search": {
      "type": "SVG",
      "svg": "<svg viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><path d=\"m16 16 5 5\" fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"2\"/></svg>"
    }
  },
  "native": {
    "search-icon": {
      "figma": { "svg": { "assetKey": "search", "color": "#334155" } }
    }
  }
}
```

Omit `color` when it is not part of the selected source. A markup-only call
cannot deliver the SVG geometry. Once an icon source has been selected and
inspected, do not replace it with text or primitives merely to avoid the
`assets` and `native` mapping.

For larger exact SVG, declare a Hub asset using a full lowercase SHA-256:

```json
{ "type": "SVG", "assetHash": "<sha256>" }
```
