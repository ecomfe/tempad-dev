import { afterEach, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import Inspect from '@/components/icons/Inspect.vue'

import { mount, unmountAll } from './mount'

afterEach(unmountAll)

it('resolves each inspect icon mask locally when the host page contains the same artwork', () => {
  const host = mount(
    defineComponent(
      () => () =>
        h('div', [
          h('svg', [h('defs', [h('mask', { id: 'fpl-icon-24-move-a' })])]),
          h(Inspect),
          h(Inspect)
        ])
    )
  )
  const icons = host.querySelectorAll('svg.tp-icon')
  expect(icons).toHaveLength(2)
  for (const icon of icons) {
    const mask = icon.querySelector('mask')!
    const reference = icon.querySelector('path[mask]')!.getAttribute('mask')!
    expect(document.getElementById(reference.slice(5, -1))).toBe(mask)
  }
})
