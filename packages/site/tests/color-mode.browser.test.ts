import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'

import App from '@/App.vue'
import '@/styles.css'

const key = 'tempad-dev-site-color-mode'
let app: ReturnType<typeof createApp> | undefined
let host: HTMLElement | undefined
let previousValue: string | null
let previousClass: string

beforeEach(() => {
  previousValue = localStorage.getItem(key)
  previousClass = document.documentElement.className
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  if (previousValue === null) localStorage.removeItem(key)
  else localStorage.setItem(key, previousValue)
  document.documentElement.className = previousClass
})

async function mount() {
  const errors: unknown[] = []
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(App)
  app.config.errorHandler = (error) => errors.push(error)
  app.mount(host)
  await nextTick()
  return errors
}

function expectAutoMode() {
  expect(host?.querySelector('.site-mode-button')?.getAttribute('aria-label')).toBe('Auto mode')
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  expect(document.documentElement.classList.contains(dark ? 'dark' : 'light')).toBe(true)
}

it.each(['obsolete-mode', 'constructor'])(
  'renders the site using system appearance with stored value %j',
  async (value) => {
    localStorage.setItem(key, value)
    const errors = await mount()
    expect.soft(errors).toEqual([])
    expectAutoMode()
    const button = host!.querySelector<HTMLButtonElement>('.site-mode-button')!
    for (let step = 0; step < 3; step++) {
      button.click()
      await nextTick()
    }
    expectAutoMode()
    expect(localStorage.getItem(key)).toBe('auto')
  }
)

it('normalizes unsupported values arriving from another tab', async () => {
  localStorage.setItem(key, 'dark')
  const errors = await mount()
  expect(host?.querySelector('.site-mode-button')?.getAttribute('aria-label')).toBe('Dark mode')
  localStorage.setItem(key, 'unsupported')
  window.dispatchEvent(
    new StorageEvent('storage', {
      key,
      oldValue: 'dark',
      newValue: 'unsupported',
      storageArea: localStorage,
      url: location.href
    })
  )
  await nextTick()
  expect.soft(errors).toEqual([])
  expectAutoMode()
})
