# Reuse an existing design system

Use this reference only when reuse is allowed and relevant. If the user rejects
a design system, use Direct.

## Discover definitions

Call `get_design_system` without arguments. Its immutable deterministic catalog
contains:

- a `catalogId` scoping all short refs;
- component tags, props, source pages, and native sizes;
- variables, collections, modes, styles, and shaders as refs such as `v1`,
  `k1`, `m1_2`, `s1`, and `h1`;
- `omitted` and `nextCursor` when more definitions remain.

The catalog neither scans usage nor loads pages or ranks resources. Select from
returned names, pages, summaries, props, types, scopes, and defaults. Continue a
cursor or inspect an exact ref only until evidence is sufficient.

Prefer, in order: catalog component, supported component prop, matching native
style, semantic variable, then primitive or literal for a real gap.

When variants, anatomy, layout, or semantic meaning affect the result, inspect
the exact `ref` with the same `catalogId`. Use its `previewNodeId` with
`get_screenshot` only when appearance affects selection. Read an existing
composition with `get_code` or `get_screenshot`; catalogs do not reveal usage
conventions. Never invent refs, IDs, keys, props, or variant values.

## Apply catalog resources

Component tags are childless, include returned `data-ref`, and use exact props.
Omit size classes to preserve native size. Bind common variables and styles with
`data-var-<field>="vN"` and `data-style-<field>="sN"`; put collection modes or
strict native links under `native[data-key]`.

Replace every illustrative ref in this contract with one from the active
catalog:

```json
{
  "mode": "create",
  "catalogId": "ds_example",
  "markup": "<div data-key=\"settings\" class=\"flex flex-col w-[320px] h-[200px] gap-[16px] p-[24px] bg-[#FFFFFF]\"><span data-key=\"settings/title\" data-var-font-size=\"v1\" data-style-text=\"s1\" class=\"w-fit h-fit text-[16px]\">Team settings</span><Button data-key=\"settings/save\" data-ref=\"c1\" label=\"Save\" disabled=\"false\" tone=\"Primary\" /></div>",
  "native": {
    "settings": {
      "variableModes": { "k1": "m1_1" }
    }
  }
}
```

If a mandatory component is absent, ask the user to open its definition page;
otherwise use the normal primitive fallback. An empty canvas does not block
catalog reuse. When reuse is unavailable, create a small coherent primitive
draft—never a token or component library solely for one screen.
