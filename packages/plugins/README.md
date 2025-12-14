# @tempad-dev/plugins

<a href="./README.zh-Hans.md"><img src="https://img.shields.io/badge/%E4%B8%AD%E6%96%87%E7%89%88%20%C2%BB-000" alt="前往中文版"></a>

Developer tooling for creating custom code generators that run inside TemPad Dev. This package provides type-safe helpers, transform hooks, and traversal utilities so you can adapt the inspector output to your own design system or workflow.

## Installation

```sh
# npm
npm install -D @tempad-dev/plugins
```

## Quick start

Create a new JavaScript or TypeScript file that exports a plugin with `definePlugin`:

```ts
import { definePlugin } from '@tempad-dev/plugins'

export default definePlugin({
  name: 'My Plugin',
  code: {
    css: {
      title: 'SCSS',
      lang: 'scss',
      transform({ code }) {
        return code.replace(/px/g, 'rem')
      }
    },
    js: false // hide the built-in JavaScript block
  }
})
```

Once the file is hosted somewhere accessible (e.g. GitHub raw URL), paste the URL into
TemPad Dev's **Preferences → Plugins** panel to load it.

## Plugin anatomy

Each plugin exports an object with a `name` and a `code` map. The code map determines the blocks TemPad Dev will render. You may override the built-in `css` and `js` blocks or introduce your own:

```ts
definePlugin({
  name: 'Tailwind Adapter',
  code: {
    css: false,
    tailwind: {
      title: 'Tailwind',
      lang: 'js',
      transform({ style }) {
        return toTailwind(style)
      }
    }
  }
})
```

Each entry in `code` accepts the following options:

- `title`: Overrides the block heading.
- `lang`: Sets syntax highlighting (`css`, `scss`, `js`, `json`, etc.).
- `transform`: Receives the generated CSS string plus a parsed `style` object.
- `transformVariable`: Allows remapping of CSS variables before output.
- `transformPx`: Converts numeric pixel values (respecting user settings like `useRem`).
- `transformComponent`: Converts Figma instances into higher-level dev components.

Set the block to `false` to remove it from the UI altogether.

### Transform hooks in detail

```ts
transform({ code, style, options })
```

- `code`: Canonical CSS string TemPad Dev generated.
- `style`: Plain object keyed by CSS property.
- `options.useRem`: User preference indicating whether px should be converted to rem.
- `options.rootFontSize`: Reference font size for rem calculations.

```ts
transformVariable({ code, name, value, options })
```

- `code`: Full `var(--token, fallback)` snippet.
- `name`: Variable token name.
- `value`: Raw fallback value if provided.

```ts
transformPx({ value, options })
```

- `value`: Numeric pixel value that TemPad Dev is about to print.

```ts
transformComponent({ component })
```

- `component`: `DesignComponent` representing the Figma instance currently inspected.
  Return either a serializable `DevComponent` tree (via `h`) or a string.

### Building component trees

Use the JSX-like `h` helper to compose nested structures:

```ts
import { definePlugin, h } from '@tempad-dev/plugins'

export default definePlugin({
  name: 'React Output',
  code: {
    component: {
      title: 'Component',
      lang: 'tsx',
      transformComponent({ component }) {
        return h('Card', { variant: component.properties.variant }, [
          h('Heading', { level: 2 }, [component.properties.title]),
          h('Button', { intent: 'primary' }, ['Submit'])
        ])
      }
    }
  }
})
```

TemPad Dev will serialize the returned `DevComponent` into JSX/TSX for display.

### Navigating design nodes

Plugins often need to search through the inspected node tree. The following helpers are exported:

```ts
findChild(container, query)
findChildren(container, query)
findOne(container, query)
findAll(container, query)
queryOne(container, queries)
queryAll(container, queries)
```

Queries can be simple property filters (`{ type: 'TEXT', name: /Title/ }`) or custom predicates.
`queryAll`/`queryOne` let you chain multiple lookups, e.g. find a footer frame and then every
button inside it. See `plugins/src/index.ts` for full documentation and the type definitions for
`DesignNode`, `DesignComponent`, and related structures.

## Debugging and testing

- Use TemPad Dev's preview panel to inspect the final code blocks rendered by your plugin.
- During development you can run your plugin locally by serving it from a dev server (Vite, Next,
  etc.) and referencing the local network URL from TemPad Dev.
- Consider writing unit tests around your transform functions by importing them directly and
  feeding mocked node data.

## Publishing

1. Build your plugin bundle (if using TypeScript or modern syntax).
2. Host the generated file somewhere that supports cross-origin requests (GitHub raw, CDN, etc.).
3. Optional: contribute to `packages/extension/plugins/available-plugins.json` so users can load your plugin by name.

## Further resources

- Root project README: insights into TemPad Dev features and plugin registry expectations.
- `plugins/src/index.ts`: canonical source of all exported types, with extensive inline
  documentation and examples.
- Example plugins: <https://github.com/Justineo/tempad-dev-plugin-kong>

Feel free to open issues or pull requests in this repository if you encounter limitations or have
ideas for new helper APIs that would make plugin development easier.
