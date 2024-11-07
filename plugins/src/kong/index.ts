import { definePlugin } from '..'

function toConstantCase(name: string) {
  return name.toUpperCase().replace(/-/g, '_')
}

export const plugin = definePlugin({
  name: 'Kong UI',
  code: {
    css: {
      title: 'SCSS',
      lang: 'scss',
      transformVariable({ name }) {
        return `$kui-${name.toLowerCase()}`
      }
    },
    js: {
      transformVariable({ name }) {
        return `\0KUI_${toConstantCase(name)}\0`
      }
    }
  }
})
