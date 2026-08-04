# Reuse an existing design system

Read this reference only when reuse is allowed and relevant to the requested
result. If the user rejects a design system, use the Direct path instead.

## Discover definitions

Call `get_design_system` without arguments. It returns an immutable,
deterministic catalog of definitions already accessible to Figma:

- `catalogId` scopes all short refs;
- components provide a tag, props, source page, and native size;
- variables, collections, modes, styles, and shaders use short refs such as
  `v1`, `k1`, `m1_2`, `s1`, and `h1`;
- `omitted` and `nextCursor` mean more definitions remain in the same catalog.

The catalog does not scan canvas usage, load pages, or rank resources for the
task. Select only from names, source pages, summaries, props, types, scopes,
and default values. Continue a cursor or inspect an exact ref only until enough
evidence exists.

Use this preference order:

1. real catalog component;
2. supported component prop;
3. matching native style;
4. semantic variable;
5. primitive or literal for a real gap.

When valid variants, component anatomy, layout, or semantic meaning affects
the result, call `get_design_system` again with the exact `ref` and same
`catalogId`. Use its `previewNodeId` with `get_screenshot` only when visual form
affects the choice. Read an existing composition with `get_code` or
`get_screenshot`; the catalog cannot infer usage conventions.

Do not invent refs, native IDs, keys, component props, or variant values.

## Apply catalog resources

Component tags are childless, include the returned `data-ref`, and use exact
returned prop names and values. Omitted size classes preserve native component
size. Bind common variables and styles beside the affected element with
`data-var-<field>="vN"` and `data-style-<field>="sN"`. Put collection modes or
strict native links in `native[data-key]`.

This complete example illustrates the contract; replace every illustrative ref
with one returned by the active catalog:

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

If an exact required component is absent, do not assume it exists on an
unloaded page. Ask the user to open its definition page when that design system
is mandatory; otherwise use the normal primitive fallback.

An empty canvas is not a blocker. Reuse discoverable definitions when allowed;
otherwise create a small coherent primitive draft. Do not create a token or
component library merely to make one screen.
