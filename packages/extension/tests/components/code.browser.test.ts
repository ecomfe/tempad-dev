import Prism from 'prismjs'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

vi.mock('@/composables/toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

import Code from '@/components/Code.vue'

import { mount, unmountAll } from './mount'

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

it.each([false, true])(
  'preserves code whitespace when displaying and copying (highlighted: %s)',
  async (highlighted) => {
    vi.stubGlobal('Prism', highlighted ? Prism : undefined)
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const source = ref('const text = `hello \t\n\nworld\n`\n')
    const host = mount(
      defineComponent(
        () => () =>
          h(Code, {
            title: 'JavaScript',
            lang: 'javascript',
            code: source.value
          })
      )
    )
    for (const text of [source.value, 'const text = `updated \n\n`\n']) {
      source.value = text
      await nextTick()
      expect(host.querySelector('code')!.textContent).toBe(text)
      expect(host.querySelectorAll('.tp-code-line-number')).toHaveLength(text.split('\n').length)
      host.querySelector<HTMLButtonElement>('[aria-label="Copy"]')!.click()
      await expect.poll(() => clipboard.mock.lastCall?.[0]).toBe(text)
    }
  }
)
