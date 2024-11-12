import { definePlugin } from '@/plugins/src'

function toConstantCase(name: string) {
  return name.toUpperCase().replace(/-/g, '_')
}

export const plugin = definePlugin({
  name: 'Kong UI Advanced',
  code: {
    css: {
      title: 'SCSS',
      lang: 'scss',
      transformVariable({ name }) {
        return `calc(var(--kui-${name.toLowerCase()}), $kui-${name.toLowerCase()})`
      }
    },
    js: {
      transformVariable({ name }) {
        return `calc(var(--kui-${name.toLowerCase()}), \0KUI_${toConstantCase(name)}\0)`
      }
    }
  }
})
