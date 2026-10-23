import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, ref } from 'vue'

import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'

import { mount, unmountAll } from './mount'

afterEach(unmountAll)

it('preserves native mouse and keyboard selection with a visible keyboard focus indicator', async () => {
  const value = ref(false)
  const update = vi.fn((next: boolean | undefined) => (value.value = next === true))
  const host = mount(
    defineComponent(
      () => () =>
        h(SegmentedControl<boolean>, {
          'aria-label': 'MCP access',
          modelValue: value.value,
          'onUpdate:modelValue': update,
          options: [
            { label: 'Disabled', value: false, icon: Minus },
            { label: 'Enabled', value: true, icon: Tick }
          ]
        })
    ),
    { tokens: { '--color-border-selected': '#0d99ff' } }
  )

  await page.getByRole('radio', { name: 'Enabled', exact: true }).click()
  expect(value.value).toBe(true)
  expect(update).toHaveBeenCalledExactlyOnceWith(true)
  update.mockClear()

  await userEvent.keyboard('{ArrowLeft}')
  expect(value.value).toBe(false)
  await expect.element(page.getByRole('radio', { name: 'Disabled', exact: true })).toBeChecked()
  expect(update).toHaveBeenCalledExactlyOnceWith(false)
  const focused = host.querySelector<HTMLInputElement>('input:focus-visible')!
  expect(focused).not.toBeNull()
  const iconStyle = getComputedStyle(focused.nextElementSibling!)
  expect(iconStyle.outlineStyle).not.toBe('none')
  expect(parseFloat(iconStyle.outlineWidth)).toBeGreaterThan(0)
  expect(iconStyle.outlineColor).toBe('rgb(13, 153, 255)')
})
