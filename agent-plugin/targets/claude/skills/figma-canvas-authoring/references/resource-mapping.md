# Use resources in Canvas classes

Keep layout and visual composition in markup. Put a reusable value's native
identity in the catalog or a call-scoped `theme`, then reference it by class.
Variables remain bound Figma variables, including mode changes. A `type-*`
class binds an entire native TextStyle. Ordinary utilities such as `gap-4` and
`text-base` remain literals and do not create or discover resources.

## Existing system

When the applicable system permits reuse, discover it with `get_design_system`.
Use returned variable `cssName` and TEXT-style `className` with its `catalogId`:
`bg-(--surface)`, `gap-(--spacing-content)`, `type-body`. These are examples of
names, not assumed resources. Read a style's exact ref when its font, metrics,
or bindings affect the choice.

The catalog uses valid WEB code syntax when available, otherwise derives a
name. It disambiguates collisions and keeps the resulting alias tied to one
exact identity for that catalog's lifetime. Use the returned name unchanged;
never derive identity from equal values, similar names, or another catalog.

For task-specific names, add `theme.variables: { "--surface": { "ref": "v1" } }`
or `theme.textStyles: { "type-body": { "ref": "s1" } }`. Use returned refs. An
alias cannot replace another catalog alias with a different resource. A stable
authoring key and catalog ref for the same native identity may share an alias.

## New system

When the deliverable includes a design system, define the selected variables
and styles through `variableCollections` and `styles`. Map their stable keys in
`theme` and consume them in the same call. A primitive draft without a system
still uses ordinary classes; repetition alone does not require resource creation.

This complete recipe illustrates the relationship. Change the design facts,
namespace resource keys for the product, and confirm the font family/style in
the environment before authoring it.

```json
{
  "mode": "create",
  "markup": "<div data-key=\"card\" class=\"flex flex-col w-[320px] h-[200px] p-6 gap-(--content-gap) bg-(--surface)\"><span data-key=\"card/title\" class=\"w-full h-fit type-body text-[#17212B]\">Account settings</span></div>",
  "theme": {
    "variables": {
      "--surface": { "variableKey": "product/color/surface" },
      "--content-gap": { "variableKey": "product/space/content" }
    },
    "textStyles": { "type-body": { "styleKey": "product/type/body" } }
  },
  "variableCollections": {
    "product/theme": {
      "name": "Product/Theme",
      "modes": { "light": { "name": "Light" }, "dark": { "name": "Dark" } },
      "variables": {
        "product/color/surface": {
          "name": "Surface",
          "type": "COLOR",
          "codeSyntax": { "WEB": "var(--surface)" },
          "values": {
            "light": { "r": 1, "g": 1, "b": 1 },
            "dark": { "r": 0.08, "g": 0.09, "b": 0.11 }
          }
        },
        "product/space/content": {
          "name": "Space/Content",
          "type": "FLOAT",
          "values": { "light": 16, "dark": 16 }
        }
      }
    }
  },
  "styles": {
    "product/type/body": {
      "type": "TEXT",
      "name": "Product/Typography/Body",
      "fontName": { "family": "Inter", "style": "Regular" },
      "fontSize": 16,
      "lineHeight": { "unit": "PIXELS", "value": 24 }
    }
  }
}
```

On later calls, retain the small `theme` mapping and omit resource definitions
unless changing them. The stable keys resolve the same native resources. The
mapping is local to the call, so different screens can use different aliases
without changing the file's naming. Authoring keys and native identities
persist; aliases do not create a second resource registry.

Use [variables.md](variables.md) for modes, aliases, scopes, and resource updates;
use [local-styles.md](local-styles.md) for style definitions. A TextStyle may
bind selected typography primitives through its `variables` fields when those
values must change together. Do not create font-family, size, or weight tokens
solely to express a single named text role: the TextStyle can hold those facts.

## Supported variable utilities

Both `gap-(--space)` and `gap-[var(--space)]` work. Explicit type hints resolve
ambiguous Tailwind prefixes, for example `text-(length:--body-size)` versus
`text-(color:--foreground)`.

| Utility                                                                | Native value                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| `bg-(--surface)`, `text-(--foreground)`, `border-(--border)`           | COLOR fill or stroke; border still needs a width        |
| `w/h/size/min-w/max-w/min-h/max-h-(--value)`                           | FLOAT dimensions, in pixels                             |
| `gap/gap-x/gap-y-(--value)`                                            | FLOAT layout gaps, in pixels; axes follow flex or grid  |
| `p/px/py/pt/pr/pb/pl-(--value)`                                        | FLOAT padding, in pixels                                |
| `rounded/rounded-tl/rounded-tr/rounded-br/rounded-bl-(--value)`        | FLOAT corner radius, in pixels                          |
| `border-(length:--width)`                                              | FLOAT stroke width, in pixels                           |
| `text-(length:--size)`, `leading-(--leading)`, `tracking-(--tracking)` | FLOAT font size, line height, letter spacing, in pixels |
| `font-(family-name:--family)`                                          | STRING font family                                      |
| `font-(--weight)`                                                      | FLOAT font weight, 1–1000                               |
| `opacity-(--opacity)`                                                  | FLOAT opacity, 0–1                                      |

The tool reads an initial native value itself and retains the variable binding;
do not add a second literal fallback class. Native node, layout, and scope rules
still apply. This is a bounded mapping to Figma fields, not a CSS engine: no
`calc()`, var fallbacks, arbitrary expressions, or cascade. FLOAT metrics use
the native units above, not unitless CSS line-height multipliers.

## Typography ownership

`type-body` consumes the whole TextStyle. Keep color, sizing, alignment, and
wrapping classes on the text node as needed; omit font, weight, size, leading,
tracking, case, and decoration overrides owned by that style. Choose another
style or explicitly unlink the style for a deliberate local treatment. Composite
typography has no single Figma variable type, so `type-*` is an explicit custom
utility convention rather than a Tailwind default or a fabricated CSS variable.

Inline `data-var-*`, `data-style-*`, and `native` bindings remain available for
fields outside this subset, exact native fonts/styles, and explicit unlinking.
Use one mechanism per property. Unknown names, conflicting declarations,
incompatible types, and cyclic variable aliases require correction; the tool
does not guess a replacement.

Updates preserve omitted native state. Removing a resource class or replacing
it with a literal does not unlink the existing binding: explicitly clear the
variable/style with its `data-var-*="none"`, `data-style-*="none"`, or supported
`native` null binding when that is the intended change.
