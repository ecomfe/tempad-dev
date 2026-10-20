import { expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileTemplate } from 'vue/compiler-sfc'

import { classProps } from '@/mcp/tools/code/render/props'
import { stringifyComponent } from '@/utils/component'

const front = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" id="front_image" width="1" height="1"><path fill="blue" d="M0 0h1v1H0z"/></svg>')}`
const rear = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" id="rear_image" width="1" height="1"><path fill="green" d="M0 0h1v1H0z"/></svg>')}`

it.each(['px', 'rem'] as const)(
  'renders layered backgrounds and longhand overrides in exported Vue (%s)',
  (cssUnit) => {
    const { props } = classProps(
      {
        background: `url("${front}") center / cover no-repeat, url("${rear}") center / cover no-repeat, #ff0`,
        'background-color': 'var(--surface)',
        'background-position': '16px 8px, right bottom',
        'background-size': '32px 16px, cover',
        'background-repeat': 'no-repeat, repeat-x'
      },
      { cssUnit, rootFontSize: 16, scale: 2 },
      'class',
      undefined
    )
    const source = stringifyComponent({ name: 'div', props, children: [] }, 'vue')
    const compiled = compileTemplate({
      source,
      filename: 'LayeredBackground.vue',
      id: 'layered-background',
      compilerOptions: { mode: 'function' }
    })
    expect(compiled.errors).toEqual([])
    const host = document.createElement('div')
    const originalFontSize = document.documentElement.style.fontSize
    document.documentElement.style.fontSize = '16px'
    host.style.setProperty('--surface', '#ff0000')
    document.body.append(host)
    const app = Vue.createApp({ render: new Function('Vue', compiled.code)(Vue) })
    try {
      app.mount(host)
      const element = host.firstElementChild!
      const actual = getComputedStyle(element)
      expect(actual.backgroundImage).toBe(`url("${front}"), url("${rear}"), none`)
      expect(actual.backgroundColor).toBe('rgb(255, 0, 0)')
      expect(actual.backgroundPosition).toBe('32px 16px, 100% 100%, 32px 16px')
      expect(actual.backgroundSize).toBe('64px 32px, cover, 64px 32px')
      expect(actual.backgroundRepeat).toBe('no-repeat, repeat-x, no-repeat')

      host.style.setProperty('--surface', '#00ff00')
      expect(getComputedStyle(element).backgroundColor).toBe('rgb(0, 255, 0)')
    } finally {
      app.unmount()
      host.remove()
      document.documentElement.style.fontSize = originalFontSize
    }
  }
)
