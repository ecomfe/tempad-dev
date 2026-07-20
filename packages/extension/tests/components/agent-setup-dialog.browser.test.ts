import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'

import AgentSetupDialog from '@/components/AgentSetupDialog.vue'

import { mount, unmountAll } from './mount'

const tokens = {
  '--spacer-1': '4px',
  '--spacer-2': '8px',
  '--spacer-3': '16px',
  '--spacer-4': '24px',
  '--spacer-5': '32px',
  '--radius-medium': '5px',
  '--color-bg': 'rgb(255, 255, 255)',
  '--color-bg-selected': 'rgb(230, 240, 255)',
  '--color-bg-transparent-hover': 'rgba(0, 0, 0, 0.05)',
  '--color-border': 'rgb(230, 230, 230)',
  '--color-border-selected': 'rgb(12, 140, 233)',
  '--color-icon': 'rgb(0, 0, 0)',
  '--color-icon-hover': 'rgb(0, 0, 0)',
  '--color-text': 'rgb(0, 0, 0)',
  '--color-text-secondary': 'rgb(128, 128, 128)',
  '--text-mono-medium-font-family': 'Roboto Mono, monospace',
  '--text-mono-medium-font-size': '11px',
  '--font-weight-default': '450',
  '--text-mono-medium-letter-spacing': '0.055px',
  '--text-mono-medium-line-height': '16px'
} as const

function mountDialog(): HTMLElement {
  return mount(
    defineComponent(
      () => () =>
        h(AgentSetupDialog, {
          modelValue: true,
          'onUpdate:modelValue': () => undefined
        })
    ),
    { tag: 'tempad', tokens }
  )
}

function getCode(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('code'), ({ textContent }) => textContent ?? '')
}

afterEach(unmountAll)

describe('AgentSetupDialog', () => {
  it('offers the Codex plugin with a reviewable CLI fallback', async () => {
    const host = mountDialog()
    await nextTick()

    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.querySelector('[role="tablist"] svg')).toBeNull()
    expect(host.querySelector('.tp-agent-dialog-brand svg title')?.textContent).toBe('Codex')
    expect(host.querySelector('.tp-agent-dialog-brand')?.getBoundingClientRect()).toMatchObject({
      width: 32,
      height: 32
    })
    expect(host.textContent).toContain('TemPad Dev plugin')
    expect(host.textContent).toContain('Continue in Codex')
    expect(getCode(host)).toContain(
      'codex plugin marketplace add ecomfe/tempad-dev --ref main && codex plugin add tempad-dev@tempad-dev'
    )
    expect(host.querySelector('[aria-label="Copy command"]')).not.toBeNull()

    const codeWell = host.querySelector<HTMLElement>('.tp-agent-dialog-code-well')
    const copyButton = host.querySelector<HTMLElement>('[aria-label="Copy command"]')
    const code = host.querySelector<HTMLElement>('code')
    const intro = host.querySelector<HTMLElement>('.tp-agent-dialog-intro')
    const planTitle = host.querySelector<HTMLElement>('.tp-agent-dialog-plan-title')
    const step = host.querySelector<HTMLElement>('.tp-agent-dialog-step')
    const stepCopy = host.querySelector<HTMLElement>('.tp-agent-dialog-step-copy')
    const hint = host.querySelector<HTMLElement>('.tp-agent-dialog-action-hint')
    const manualNote = host.querySelector<HTMLElement>('.tp-agent-dialog-manual-note')

    expect(codeWell!.getBoundingClientRect().height).toBeGreaterThanOrEqual(34)
    expect(getComputedStyle(codeWell!).borderRadius).toBe('5px')
    expect(copyButton!.getBoundingClientRect()).toMatchObject({ width: 24, height: 24 })
    expect(getComputedStyle(code!).fontSize).toBe('11px')
    expect(getComputedStyle(code!).fontWeight).toBe('450')
    expect(getComputedStyle(code!).lineHeight).toBe('16px')
    expect(getComputedStyle(code!).whiteSpace).toBe('pre-wrap')
    expect(getComputedStyle(code!).overflowWrap).toBe('anywhere')
    expect(code!.scrollWidth).toBeLessThanOrEqual(code!.clientWidth)
    expect(getComputedStyle(copyButton!).margin).toBe('4px')
    await page.getByRole('button', { name: 'Copy command' }).hover()
    expect(getComputedStyle(copyButton!).backgroundColor).toBe('rgba(0, 0, 0, 0.05)')
    expect(getComputedStyle(copyButton!).color).toBe('rgb(0, 0, 0)')
    expect(getComputedStyle(codeWell!).backgroundColor).toBe('rgb(230, 240, 255)')
    expect(getComputedStyle(codeWell!).borderColor).toBe('rgb(12, 140, 233)')
    expect(getComputedStyle(intro!).gap).toBe('4px')
    expect(getComputedStyle(intro!).marginBottom).toBe('16px')
    expect(getComputedStyle(planTitle!).marginBottom).toBe('16px')
    expect(getComputedStyle(step!).paddingTop).toBe('0px')
    expect(getComputedStyle(step!).borderTopStyle).toBe('none')
    expect(getComputedStyle(stepCopy!).gap).toBe('4px')
    expect(getComputedStyle(stepCopy!.querySelector('p')!).color).toBe('rgb(0, 0, 0)')
    expect(getComputedStyle(intro!.querySelector('p')!).color).toBe('rgb(0, 0, 0)')
    expect(getComputedStyle(hint!).marginBottom).toBe('8px')
    expect(getComputedStyle(hint!).color).toBe('rgb(0, 0, 0)')
    expect(getComputedStyle(manualNote!).paddingTop).toBe('16px')
  })

  it('shows Cursor one-click setup with explicit manual fallbacks', async () => {
    const host = mountDialog()

    await page.getByRole('tab', { name: 'Cursor' }).click()

    expect(host.querySelector('.tp-agent-dialog-brand svg title')?.textContent).toBe('Cursor')
    expect(host.textContent).toContain('Install in Cursor')
    expect(getCode(host)).toEqual([
      expect.stringContaining('"mcpServers"'),
      'npx skills add https://github.com/ecomfe/tempad-dev/tree/main/skill --global --agent cursor'
    ])
    expect(host.querySelectorAll('[aria-label="Copy configuration"]')).toHaveLength(1)
    expect(host.querySelectorAll('[aria-label="Copy command"]')).toHaveLength(1)
  })

  it('uses Gemini native commands for both setup steps', async () => {
    const host = mountDialog()

    await page.getByRole('tab', { name: 'Gemini' }).click()

    expect(getCode(host)).toEqual([
      'gemini mcp add --scope user "tempad-dev" npx -y @tempad-dev/mcp@latest',
      'gemini skills install https://github.com/ecomfe/tempad-dev/tree/main/skill'
    ])
  })

  it('uses OpenCode-specific MCP config and skill install targets', async () => {
    const host = mountDialog()

    await page.getByRole('tab', { name: 'OpenCode' }).click()

    expect(JSON.parse(getCode(host)[0] ?? '')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'tempad-dev': {
          type: 'local',
          command: ['npx', '-y', '@tempad-dev/mcp@latest']
        }
      }
    })
    expect(getCode(host)[1]).toBe(
      'npx skills add https://github.com/ecomfe/tempad-dev/tree/main/skill --global --agent opencode'
    )
  })

  it('presents manual setup as the fallback for other agents', async () => {
    const host = mountDialog()

    await page.getByRole('tab', { name: 'Other agents' }).click()

    await expect.element(page.getByRole('heading', { name: 'Manual setup' })).toBeVisible()
    expect(host.querySelector('.tp-agent-dialog-brand')).toBeNull()
  })
})
