# @tempad-dev/plugins

Developer tooling for creating custom code generators that run inside TemPad Dev. This package provides type-safe helpers, transform hooks, and traversal utilities so you can adapt the inspector output to your own design system or workflow.

## Installation

```sh
npm install -D @tempad-dev/plugins
```

```sh
pnpm add -D @tempad-dev/plugins
```

```sh
yarn add -D @tempad-dev/plugins
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
    js: false
  }
})
```

Host the bundled file on a URL that TemPad Dev can reach (for example a GitHub raw link) and paste that URL into the **Preferences → Plugins** panel to load it.

## Plugin anatomy

Each plugin exports a `name` and a `code` map. The map controls which code blocks TemPad Dev renders and how each block is produced.

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
- `lang`: Sets syntax highlighting. Supported values: `text`, `tsx`, `jsx`, `ts`, `js`, `vue`, `html`, `css`, `sass`, `scss`, `less`, `stylus`, `json`.
- `transform`: Adjusts the generated CSS string or parsed `style` object before it is rendered in the panel.
- `transformVariable`: Remaps CSS variables, letting you emit alternate token syntaxes such as Sass variables.
- `transformPx`: Rewrites numeric pixel values while respecting user preferences like `useRem` and `rootFontSize`.
- `transformComponent`: Converts the inspected component instance into either a `DevComponent` tree or a preformatted string for the code block.

Set a block to `false` to remove it from the UI altogether.

### Transform hooks in detail

TemPad Dev invokes your hooks with structured arguments so you can tailor the generated output.

#### `transform`

Applies final mutations to the CSS block.

Inputs:

- `params.code`: Canonical CSS string TemPad Dev generated.
- `params.style`: Plain object keyed by CSS property.
- `params.options.useRem`: Whether users prefer values converted to `rem`.
- `params.options.rootFontSize`: The base font size to use when performing conversions.

Output:

- `string`: The CSS that should appear in the code block.

#### `transformVariable`

Overrides how CSS variables are printed.

Inputs:

- `params.code`: Full `var(--token, fallback)` snippet.
- `params.name`: Variable token name without the `--` prefix.
- `params.value`: Raw fallback value if provided.
- `params.options`: Same preference object passed to `transform`.

Output:

- `string`: The transformed variable reference.

#### `transformPx`

Controls how individual pixel values are converted.

Inputs:

- `params.value`: Numeric pixel value before formatting.
- `params.options`: Same preference object passed to `transform`.

Output:

- `string`: The formatted length value (for example `1rem`).

#### `transformComponent`

Generates component-oriented output for Figma instances.

Inputs:

- `params.component`: `DesignComponent` representing the instance currently inspected.

Output:

- `DevComponent | string`: Return a hyperscript tree or a preformatted string.

### Building component trees with `h`

The exported hyperscript function `h` helps you create `DevComponent` trees without writing verbose objects by hand. Supported overloads include `h(name)`, `h(name, children)`, `h(name, props)`, and `h(name, props, children)`. When children are provided as a single string or component they are automatically wrapped into an array.

```ts
import { definePlugin, h } from '@tempad-dev/plugins'

export default definePlugin({
  name: 'React Output',
  code: {
    component: {
      title: 'Component',
      lang: 'jsx',
      transformComponent({ component }) {
        return h('Card', { variant: component.properties.variant }, [
          h('Heading', { level: 2 }, [component.properties.title]),
          h('Button', 'Submit')
        ])
      }
    }
  }
})
```

TemPad Dev serializes the resulting `DevComponent` tree into JSX by default. Set `lang` to `'vue'` to render Vue template markup; all other languages currently emit JSX as well. If you need a bespoke serialization strategy, convert the tree to a string yourself and return that from `transformComponent`.

### Navigating design nodes

Plugins use queries to traverse the inspected Figma node tree. A `NodeQuery` is either a predicate function or an object filter supporting `type`, `name`, and `visible` with strings, arrays, or regular expressions. The `query` field accepted by `queryAll` and `queryOne` determines whether the current step works on direct children (`child` or `children`) or performs a recursive search (`one` or `all`).

#### `findChild`

Returns the first direct child that satisfies the query.

Inputs:

- `container`: Any node with children (`GroupNode`, `FrameNode`, or `DesignComponent`).
- `query`: Predicate or property filter.

Output:

- `DesignNode | null`: The matching child or `null`.

Example:

```ts
const heading = findChild(component, { type: 'TEXT', name: /title/i })
```

#### `findChildren`

Returns every direct child that matches the query.

Inputs:

- `container`: Any node with children.
- `query`: Predicate or property filter.

Output:

- `DesignNode[]`: Direct children that satisfy the condition.

Example:

```ts
const icons = findChildren(toolbar, { type: 'VECTOR' })
```

#### `findOne`

Performs a depth-first search and returns the first match.

Inputs:

- `container`: Any node with children.
- `query`: Predicate or property filter.

Output:

- `DesignNode | null`: The first nested node that matches.

Example:

```ts
const submitButton = findOne(page, { name: 'Submit' })
```

#### `findAll`

Recursively collects every node that matches the query.

Inputs:

- `container`: Any node with children.
- `query`: Predicate or property filter.

Output:

- `DesignNode[]`: All nested matches.

Example:

```ts
const textNodes = findAll(page, { type: 'TEXT', visible: true })
```

#### `queryAll`

Executes a sequence of queries step by step and returns the final collection.

Inputs:

- `container`: Any node with children.
- `queries`: Array of query objects extended with a `query` field describing the lookup mode.

Output:

- `DesignNode[]`: Nodes produced by the last query in the chain.

Example:

```ts
const buttons = queryAll(frame, [
  { query: 'children', name: 'Footer' },
  { query: 'all', type: 'INSTANCE', name: /Button/ }
])
```

#### `queryOne`

Runs the same chained logic as `queryAll` but only returns the first result.

Inputs:

- `container`: Any node with children.
- `queries`: Array of query objects extended with a `query` field.

Output:

- `DesignNode | null`: The first node produced by the chain or `null`.

Example:

```ts
const header = queryOne(page, [
  { query: 'children', name: 'Header' },
  { query: 'child', type: 'FRAME', name: /Top Bar/ }
])
```

## Debugging and testing

Bundle your plugin into a single file, serve it locally, and point TemPad Dev at that URL for rapid iteration. A typical workflow looks like this:

1. Run your bundler in watch mode to emit `dist/plugin.js` (for example `esbuild src/index.ts --bundle --format=esm --outfile=dist/plugin.js --watch`).
2. Serve the output directory with any static server (`pnpm dlx http-server dist` or `python -m http.server --directory dist`).
3. Copy the served file URL into TemPad Dev's **Preferences → Plugins** panel and run plugin update (will show up when hovering a plugin item) after each rebuild.

This approach lets you develop against live data without publishing a new bundle for every change.

## Publishing

When your plugin is stable, publish the bundled file somewhere that supports cross-origin requests (GitHub raw, CDN, self-hosted). Optionally add an entry to `plugins/available-plugins.json` so users can load it by name.

## Further resources

- Root project README: overview of TemPad Dev features and plugin registry expectations.
- `plugins/src/index.ts`: canonical source of all exported types with inline documentation and examples.
- Example plugins: <https://github.com/Justineo/tempad-dev-plugin-kong>

Feel free to open issues or pull requests if you encounter limitations or have ideas for new helper APIs.
