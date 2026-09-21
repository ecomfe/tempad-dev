import {
  AGENT_INTEGRATIONS_BY_ID,
  AGENT_SKILLS_INSTALL_COMMAND,
  MCP_SERVERS_CONFIG_SNIPPET
} from '@tempad-dev/shared'
import { afterEach, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createApp } from 'vue'

import ConnectSection from '@/sections/ConnectSection.vue'
import '@/styles.css'

let app: ReturnType<typeof createApp> | undefined
let host: HTMLElement | undefined

afterEach(() => {
  app?.unmount()
  host?.remove()
  vi.restoreAllMocks()
})

it.each([1280, 390])('offers the extension setup paths at %ipx', async (width) => {
  await page.viewport(width, 1000)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(ConnectSection)
  app.mount(host)

  expect(
    Array.from(host.querySelectorAll('[role="tab"]'), (tab) => tab.getAttribute('aria-label'))
  ).toEqual([
    'Codex',
    'Claude Code',
    'Cursor',
    'Gemini',
    'VS Code',
    'OpenCode',
    'TRAE',
    'Other agents'
  ])
  const panel = host.querySelector<HTMLElement>('[role="tabpanel"]')!
  const actions = () => Array.from(panel.querySelectorAll('.site-setup-action'))
  expect(actions()).toHaveLength(1)
  expect(actions()[0]!.textContent).toContain('Run in your terminal:')
  expect(panel.querySelector('.site-connect-action-button')).toBeNull()
  expect(panel.querySelector('code')!.textContent).toBe(
    AGENT_INTEGRATIONS_BY_ID.codex.actions[0]!.value
  )

  await page.getByRole('tab', { name: 'Codex', exact: true }).click()
  await userEvent.keyboard('{ArrowRight}')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Claude Code')
  expect(panel.querySelector('code')!.textContent).toBe(
    AGENT_INTEGRATIONS_BY_ID.claude.actions[0]!.value
  )
  await userEvent.keyboard('{ArrowRight}')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Cursor')

  await page.getByRole('button', { name: 'Manual setup', exact: true }).click()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Other agents')
  expect(panel.textContent).toContain('1. MCP server')
  expect(panel.textContent).toContain('2. Agent skills')
  expect(Array.from(panel.querySelectorAll('code'), (code) => code.textContent)).toEqual([
    MCP_SERVERS_CONFIG_SNIPPET,
    AGENT_SKILLS_INSTALL_COMMAND
  ])
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  await page.getByRole('button', { name: 'Copy MCP config', exact: true }).click()
  expect(copy).toHaveBeenCalledWith(MCP_SERVERS_CONFIG_SNIPPET)

  await page.getByRole('tab', { name: 'Gemini', exact: true }).click()
  expect(Array.from(panel.querySelectorAll('code'), (code) => code.textContent)).toEqual(
    AGENT_INTEGRATIONS_BY_ID.gemini.actions.map(({ value }) => value)
  )
  expect(actions()[2]!.textContent).toContain('Then run in your terminal:')

  const otherAgents = page.getByRole('tab', { name: 'Other agents', exact: true })
  await expect.element(otherAgents).toHaveTextContent('Other agents')
  await otherAgents.click()
  expect(panel.querySelector('code')!.textContent).toBe(MCP_SERVERS_CONFIG_SNIPPET)

  for (const tab of host.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    tab.click()
    await expect.poll(() => panel.getAttribute('aria-labelledby')).toBe(tab.id)
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    expect(host.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  }
})
