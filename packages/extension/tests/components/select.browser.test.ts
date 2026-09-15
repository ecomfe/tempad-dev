import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'

import Select from '@/components/Select.vue'

import { mount, unmountAll } from './mount'

const options = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((label) => ({
  label,
  value: label.toLowerCase()
}))

function mountSelect(): HTMLSelectElement {
  const value = ref('zeta')
  const host = mount(
    defineComponent(
      () => () =>
        h(Select, {
          'aria-label': 'Agent',
          modelValue: value.value,
          'onUpdate:modelValue': (next: string | null | undefined) => (value.value = next ?? ''),
          options,
          style: '--tp-select-trigger-padding-left: 30px'
        })
    ),
    {
      tokens: {
        '--spacer-1': '4px',
        '--spacer-2': '8px',
        '--spacer-4': '32px',
        '--radius-medium': '4px',
        '--radius-large': '6px',
        '--color-border': '#ddd',
        '--color-bg': '#fff',
        '--color-bg-menu': '#fff',
        '--color-text': '#222',
        '--color-text-menu': '#222'
      }
    }
  )

  Object.assign(host.style, { position: 'absolute', top: '200px', left: '200px' })
  return host.querySelector('select')!
}

afterEach(unmountAll)

describe('Select', () => {
  it('keeps the selected option aligned when trigger content has custom padding', async () => {
    expect(CSS.supports('appearance', 'base-select')).toBe(true)
    const select = mountSelect()

    await page.getByRole('combobox', { name: 'Agent' }).click()

    const controlRect = select.getBoundingClientRect()
    const selectedRect = select.selectedOptions[0].getBoundingClientRect()

    expect(Math.abs(selectedRect.top - controlRect.top)).toBeLessThanOrEqual(1)
    expect(Math.abs(selectedRect.left - controlRect.left)).toBeLessThanOrEqual(2)
  })
})
