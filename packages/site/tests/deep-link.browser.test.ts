import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'

import ConnectSection from '@/sections/ConnectSection.vue'

// Exercise navigation ownership without ever launching an installed agent.
vi.mock('@tempad-dev/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tempad-dev/shared')>()
  return {
    ...actual,
    AGENT_INTEGRATIONS: actual.AGENT_INTEGRATIONS.map((agent) => ({
      ...agent,
      actions: agent.actions.map((action) =>
        action.kind === 'deep-link'
          ? { ...action, value: '#test-install', fallbackValue: '#test-fallback' }
          : action
      )
    }))
  }
})

let app: ReturnType<typeof createApp> | undefined
let host: HTMLElement | undefined
const originalUrl = location.href

afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  history.replaceState(null, '', originalUrl)
})

async function startAttempt() {
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(ConnectSection)
  app.mount(host)
  host.querySelector<HTMLButtonElement>('#site-agent-trae')!.click()
  await nextTick()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const button = host.querySelector<HTMLButtonElement>('.site-connect-action-button')!
  button.click()
  expect(location.hash).toBe('#test-install')
  return button
}

it.each(['agent switch', 'another action', 'unmount', 'blur', 'pagehide'])(
  'cancels the pending fallback after %s',
  async (event) => {
    await startAttempt()
    if (event === 'agent switch')
      host!.querySelector<HTMLButtonElement>('#site-agent-codex')!.click()
    else if (event === 'another action') {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
      host!.querySelector<HTMLButtonElement>('.site-command-copy')!.click()
    } else if (event === 'unmount') {
      app!.unmount()
      app = undefined
    } else window.dispatchEvent(new Event(event))
    await nextTick()
    await vi.advanceTimersByTimeAsync(850)
    expect(location.hash).toBe('#test-install')
    expect(host?.querySelector('.site-feedback')?.textContent ?? '').not.toContain(
      'fallback install'
    )
  }
)

it('only runs the most recent attempt fallback', async () => {
  const button = await startAttempt()
  await vi.advanceTimersByTimeAsync(400)
  button.click()
  await vi.advanceTimersByTimeAsync(450)
  expect(location.hash).toBe('#test-install')
  await vi.advanceTimersByTimeAsync(400)
  expect(location.hash).toBe('#test-fallback')
})
