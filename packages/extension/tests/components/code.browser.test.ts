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

it('loads packaged grammars once when Prism becomes available to displayed code', async () => {
  vi.stubGlobal('Prism', undefined)
  vi.stubGlobal('__TEMPAD_PLUGIN_SANDBOX_URL__', 'chrome-extension://fixture/plugin-sandbox.html')
  const append = vi.spyOn(document.head, 'append').mockImplementation((...items) => {
    for (const item of items) {
      if (item instanceof HTMLScriptElement)
        queueMicrotask(() => item.dispatchEvent(new Event('load')))
    }
  })
  const props = { title: 'CSS', code: 'color: red;', lang: 'css' }
  mount(defineComponent(() => () => [h(Code, props), h(Code, props)]))
  expect(append).not.toHaveBeenCalled()
  vi.stubGlobal('Prism', Prism)
  await expect.poll(() => append.mock.calls.length).toBe(1)
  expect((append.mock.calls[0]![0] as HTMLScriptElement).src).toBe(
    'chrome-extension://fixture/prism.js'
  )
  append.mockRestore()
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
