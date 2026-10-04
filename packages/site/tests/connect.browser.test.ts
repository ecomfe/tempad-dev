import {
  AGENT_INTEGRATIONS,
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

it.each(['codex', 'kiro-cli', 'codebuddy'] as const)(
  'keeps the %s artwork identical across selection and themes',
  async (id) => {
    await page.viewport(1280, 1000)
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(ConnectSection)
    app.mount(host)
    const path = () => host!.querySelector(`#site-agent-${id} svg path`)!
    const bounds = () => path().getBoundingClientRect()
    const initial = bounds()
    const geometry = path().getAttribute('d')
    const wasDark = document.documentElement.classList.contains('dark')
    try {
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle('dark', dark)
        for (const name of ['Claude Code', AGENT_INTEGRATIONS_BY_ID[id].name]) {
          await page.getByRole('tab', { name, exact: true }).click()
          const current = bounds()
          expect(path().getAttribute('d')).toBe(geometry)
          expect(current.width).toBeCloseTo(initial.width, 2)
          expect(current.height).toBeCloseTo(initial.height, 2)
          expect(current.x).toBeCloseTo(initial.x, 2)
          expect(current.y).toBeCloseTo(initial.y, 2)
        }
      }
    } finally {
      document.documentElement.classList.toggle('dark', wasDark)
    }
  }
)

it.each([1280, 390])('offers the extension setup paths at %ipx', async (width) => {
  await page.viewport(width, 1000)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(ConnectSection)
  app.mount(host)

  expect(
    Array.from(host.querySelectorAll('[role="tab"]'), (tab) => tab.getAttribute('aria-label'))
  ).toEqual([...AGENT_INTEGRATIONS.map(({ name }) => name), 'Other agents'])
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
  await otherAgents.click()
  expect(panel.querySelector('code')!.textContent).toBe(MCP_SERVERS_CONFIG_SNIPPET)

  for (const tab of host.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
    tab.click()
    await expect.poll(() => panel.getAttribute('aria-labelledby')).toBe(tab.id)
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    expect(host.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    expect(tab.querySelector('svg')).not.toBeNull()
    expect(tab.querySelector('svg path, svg circle')).not.toBeNull()
    expect(tab.innerText.trim()).toBe('')
    expect(tab.getAttribute('data-tooltip')).toBe(tab.getAttribute('aria-label'))
    const agent = AGENT_INTEGRATIONS.find(({ id }) => tab.id === `site-agent-${id}`)
    const docs = host.querySelector<HTMLAnchorElement>('.site-agent-docs')
    if (agent) {
      expect(agent.docsUrl).toMatch(/^https:\/\//)
      expect(docs?.href).toBe(agent.docsUrl)
      expect(docs?.getAttribute('aria-label')).toBe(`${agent.name} setup documentation`)
      for (const action of agent.actions) {
        if (action.hint) expect(panel.textContent).toContain(action.hint.replaceAll('`', ''))
      }
      const inlineCode = Array.from(
        panel.querySelectorAll('.site-setup-hint code'),
        ({ textContent }) => textContent
      )
      if (agent.id === 'zcode')
        expect(inlineCode).toEqual(['~/.zcode/cli/config.json', '.zcode/config.json'])
      if (agent.id === 'trae') expect(inlineCode).toEqual(['--agent trae', '--agent trae-cn'])
      if (agent.id === 'pi') expect(inlineCode).toEqual(['/reload'])
    } else {
      expect(docs).toBeNull()
    }
  }

  await page.getByRole('tab', { name: 'Hermes Agent', exact: true }).click()
  expect(panel.textContent).toContain('~/.hermes/config.yaml')
  await page.getByRole('button', { name: 'Copy MCP config', exact: true }).click()
  expect(copy).toHaveBeenLastCalledWith(AGENT_INTEGRATIONS_BY_ID['hermes-agent'].actions[0]!.value)
  expect(
    host.querySelector(
      'a[href="https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/"]'
    )
  ).not.toBeNull()

  expect(host.querySelector('.site-active-agent-name')).toBeNull()
  const inactiveFills = ['claude', 'gemini', 'trae'].map(
    (id) => getComputedStyle(host!.querySelector(`#site-agent-${id} svg path`)!).fill
  )
  expect(new Set(inactiveFills).size).toBe(1)

  await page.getByRole('button', { name: 'Search agents', exact: true }).click()
  const search = page.getByRole('searchbox', { name: 'Search agents by name' })
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Search agents by name')
  await search.fill('not-an-agent')
  await expect.element(page.getByText('No agents found. Try another name.')).toBeVisible()
  expect(panel.textContent).toContain('~/.hermes/config.yaml')

  await search.fill(' qWeN ')
  await expect
    .poll(() =>
      Array.from(host!.querySelectorAll<HTMLElement>('[role="tab"]'))
        .filter((tab) => tab.checkVisibility())
        .map((tab) => tab.getAttribute('aria-label'))
    )
    .toEqual([AGENT_INTEGRATIONS_BY_ID['qwen-code'].name])
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await expect
    .poll(() => panel.querySelector('code')?.textContent)
    .toBe(AGENT_INTEGRATIONS_BY_ID['qwen-code'].actions[0]!.value)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Search agents')
  expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('')
  expect(
    Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).filter((tab) =>
      tab.checkVisibility()
    )
  ).toHaveLength(AGENT_INTEGRATIONS.length + 1)
  expect(host.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
