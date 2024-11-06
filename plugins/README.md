# @tempad-dev/plugins

## Usage

```sh
npm i -D @tempad-dev/plugins # pnpm add -D @tempad-dev/plugins
```

```ts
import { definePlugin } from '@tempad-dev/plugins'

export const plugin = definePlugin({
  name: 'My Plugin',
  code: {
    // customize transform options
  }
})
```
