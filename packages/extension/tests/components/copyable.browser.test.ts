import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, useTemplateRef } from 'vue'

vi.mock('@/composables/toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

import Copyable from '@/components/Copyable.vue'

import { mount, unmountAll } from './mount'

beforeEach(() => {
  vi.stubGlobal('useTemplateRef', useTemplateRef)
})
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

it.each([
  { label: 'Layer name', copy: undefined },
  { label: 'Library label', copy: 'Complete library name' }
])('copies $label with Enter and Space from the tab sequence', async ({ label, copy }) => {
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const submit = vi.fn((event: Event) => event.preventDefault())
  const host = mount(
    defineComponent(
      () => () =>
        h('form', { onSubmit: submit }, [
          h('button', { type: 'button' }, 'Before'),
          h(Copyable, { 'data-copy': copy }, () => label),
          h('button', { type: 'button' }, 'After')
        ])
    ),
    { tokens: { '--color-border-selected': '#0d99ff' } }
  )
  const target = host.querySelector<HTMLElement>('.tp-copyable')!
  host.querySelector<HTMLButtonElement>('button')!.focus()
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(target)
  expect(target.getAttribute('role')).toBe('button')
  const focusStyle = getComputedStyle(target)
  expect(focusStyle.outlineStyle).not.toBe('none')
  expect(parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0)
  expect(focusStyle.outlineColor).toBe('rgb(13, 153, 255)')

  await userEvent.keyboard('{Enter}')
  await expect.poll(() => clipboard.mock.calls.length).toBe(1)
  expect(clipboard).toHaveBeenLastCalledWith(copy ?? label)
  await userEvent.keyboard(' ')
  await expect.poll(() => clipboard.mock.calls.length).toBe(2)
  expect(clipboard).toHaveBeenLastCalledWith(copy ?? label)
  expect(document.activeElement).toBe(target)
  expect(submit).not.toHaveBeenCalled()
})
