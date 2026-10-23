import type { Page } from 'playwright'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  capture: vi.fn(),
  manifest: {} as Record<string, unknown>
}))
vi.mock('playwright', () => ({ chromium: { connectOverCDP: mocks.connect } }))
vi.mock('../../screenshots/dialog-capture.mjs', () => ({ captureDialogPng: mocks.capture }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...original,
    readFile: (...args: Parameters<typeof original.readFile>) =>
      String(args[0]).endsWith('/screenshots/scenarios.json')
        ? Promise.resolve(JSON.stringify(mocks.manifest))
        : original.readFile(...args)
  }
})

import { assertScenario, captureScreenshots, setSelect } from '../../screenshots/capture-runtime'

const scenario = {
  id: 'setup',
  group: 'setup' as const,
  view: 'mcpInstall',
  width: 1200,
  height: 960,
  panel: { setupTarget: 'Gemini' },
  pointer: { visible: false, target: { kind: 'hiddenPointer' } },
  assertions: [] as Array<{ kind: string }>
}
const clip = { x: 0, y: 0, width: 600, height: 480 }
let output: string
let originalArgv: string[]

function driver() {
  const click = vi.fn(async () => undefined)
  const control = {
    click,
    count: vi.fn(async () => 0),
    innerText: vi.fn(async () => 'Tools'),
    press: vi.fn(async () => undefined),
    getByRole: vi.fn(() => control)
  }
  const light = { click: vi.fn(async () => undefined) }
  const cdp = {
    send: vi.fn(async () => ({ result: { value: true } })),
    detach: vi.fn(async () => undefined)
  }
  const context = { newCDPSession: vi.fn(async () => cdp) }
  const page = {
    url: () => 'https://www.figma.com/design/fixture-key/Test',
    bringToFront: vi.fn(async () => undefined),
    waitForLoadState: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn().mockResolvedValue({ width: 1728, height: 837 }),
    locator: vi.fn(() => control),
    getByRole: vi.fn((_role: string, options: { name: string }) =>
      options.name === 'Light' ? light : control
    ),
    context: () => context,
    mouse: { move: vi.fn(async () => undefined) }
  }
  const browser = {
    contexts: () => [{ pages: () => [page] }],
    close: vi.fn(async () => undefined)
  }
  mocks.connect.mockResolvedValue(browser)
  return { page, browser, cdp, light }
}

beforeEach(async () => {
  vi.clearAllMocks()
  output = await mkdtemp(join(tmpdir(), 'tempad-capture-driver-'))
  originalArgv = process.argv
  process.argv = ['node', 'capture-screenshots.ts', '--output-dir', output]
  mocks.manifest = {
    fixture: { file: { key: 'fixture-key', url: 'https://www.figma.com/design/fixture-key/Test' } },
    capture: {
      themes: ['dark'],
      viewport: { width: 1728, height: 837 },
      clip,
      clipScale: 1,
      hiddenPointer: { x: 1200, y: 700 },
      settleMs: 0
    },
    scenarios: [scenario]
  }
  const header = Buffer.alloc(24)
  header.set([137, 80, 78, 71, 13, 10, 26, 10])
  header.writeUInt32BE(scenario.width, 16)
  header.writeUInt32BE(scenario.height, 20)
  mocks.capture.mockResolvedValue({ data: header.toString('base64') })
})

afterEach(async () => {
  process.argv = originalArgv
  vi.restoreAllMocks()
  await rm(output, { recursive: true, force: true })
})

describe('screenshot capture boundaries', () => {
  it('changes the selected CSS unit even when both option labels are present', async () => {
    let selected = 'px'
    const select = {
      innerText: async () => 'px rem',
      inputValue: async () => selected,
      selectOption: vi.fn(async (value: string) => {
        selected = value
      })
    }
    const page = { getByRole: vi.fn(() => select) }
    await setSelect(page as unknown as Page, 'CSS unit', 'rem')
    expect(selected).toBe('rem')
    await setSelect(page as unknown as Page, 'CSS unit', 'rem')
    expect(select.selectOption).toHaveBeenCalledExactlyOnceWith('rem')
    expect(page.getByRole).toHaveBeenCalledWith('combobox', { name: 'CSS unit', exact: true })
  })

  it.each(['px', 'rem'])(
    'checks the selected CSS unit (%s), not all option labels',
    async (selected) => {
      const page = {
        locator: () => ({ innerText: async () => 'CSS unit px rem' }),
        getByRole: () => ({
          count: async () => 1,
          innerText: async () => 'px rem',
          inputValue: async () => selected
        })
      }
      const result = assertScenario(
        page as unknown as Page,
        {
          ...scenario,
          assertions: [{ kind: 'panel-control-value', name: 'CSS unit', value: 'rem' }]
        },
        null,
        clip
      )
      if (selected === 'rem') await expect(result).resolves.toBeUndefined()
      else await expect(result).rejects.toThrow('CSS unit does not show rem')
    }
  )

  it.each([
    { input: '16', text: 'No generated code', error: null },
    { input: '32', text: 'Generated width: 16px', error: 'Root font size does not show 16' },
    { input: null, text: 'Generated width: 16px', error: 'unsupported or missing control' }
  ])(
    'checks the actual font-size input ($input), not unrelated panel text',
    async ({ input, text, error }) => {
      const page = {
        locator: () => ({ innerText: async () => text }),
        getByRole: (role: string, options: { name: string; exact: boolean }) => ({
          count: async () =>
            Number(
              role === 'spinbutton' &&
                options.name === 'Root font size' &&
                options.exact &&
                input !== null
            ),
          inputValue: async () => input
        })
      }
      const result = assertScenario(
        page as unknown as Page,
        {
          ...scenario,
          assertions: [{ kind: 'panel-control-value', name: 'Root font size', value: '16' }]
        },
        null,
        clip
      )
      if (error) await expect(result).rejects.toThrow(error)
      else await expect(result).resolves.toBeUndefined()
    }
  )

  it('rejects unsupported assertions instead of silently accepting absent evidence', async () => {
    const { page } = driver()
    await expect(
      assertScenario(
        page as unknown as Page,
        { ...scenario, assertions: [{ kind: 'measurement-labels' }] },
        null,
        clip
      )
    ).rejects.toThrow('unsupported screenshot assertion measurement-labels')
  })

  it('detaches the fixture CDP session and disconnects even when preparation fails', async () => {
    mocks.manifest.scenarios = [{ ...scenario, group: 'inspect' }]
    const { browser, cdp } = driver()
    const failure = new Error('Cannot read Figma')
    cdp.send.mockRejectedValue(failure)
    await expect(captureScreenshots()).rejects.toBe(failure)
    expect(cdp.detach).toHaveBeenCalledOnce()
    expect(browser.close).toHaveBeenCalledOnce()
  })

  it('fails if Light restoration fails after a successful capture and still removes overlays', async () => {
    const { page, browser, light, cdp } = driver()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const failure = new Error('Light restoration failed')
    light.click.mockRejectedValue(failure)
    await expect(captureScreenshots()).rejects.toBe(failure)
    expect(mocks.capture).toHaveBeenCalledOnce()
    expect(cdp.detach).toHaveBeenCalledOnce()
    expect(page.evaluate.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      light.click.mock.invocationCallOrder[0]!
    )
    expect(browser.close).toHaveBeenCalledOnce()
    expect(log.mock.calls.flat().join('\n')).not.toContain('Candidates written')
  })

  it('restores prepared fixtures even if detaching their CDP session fails', async () => {
    mocks.manifest.scenarios = [{ ...scenario, group: 'status', mcpStatus: 'inactive' }]
    process.argv.push('--only', scenario.id)
    const { page, browser, cdp } = driver()
    const failure = new Error('Detach failed')
    const setCanvasTheme = vi.fn()
    const remove = vi.fn()
    page.evaluate.mockImplementation(async (callback: () => unknown) =>
      runInNewContext(`(${callback.toString()})()`, {
        innerWidth: 1728,
        innerHeight: 837,
        __TEMPAD_README_SCREENSHOTS__: { setCanvasTheme },
        document: { querySelector: () => ({ remove }) }
      })
    )
    cdp.detach.mockRejectedValue(failure)
    await expect(captureScreenshots()).rejects.toBe(failure)
    expect(setCanvasTheme).toHaveBeenCalledWith('light')
    expect(remove).toHaveBeenCalledTimes(2)
    expect(browser.close).toHaveBeenCalledOnce()
  })

  it('reports capture and independent restoration failures together', async () => {
    const { page, browser, light } = driver()
    const captureFailure = new Error('Capture failed')
    const restoreFailure = new Error('Light restoration failed')
    const disconnectFailure = new Error('Disconnect failed')
    mocks.capture.mockRejectedValue(captureFailure)
    light.click.mockRejectedValue(restoreFailure)
    browser.close.mockRejectedValue(disconnectFailure)
    const result = await captureScreenshots().catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).errors).toEqual([
      captureFailure,
      restoreFailure,
      disconnectFailure
    ])
    expect(page.evaluate.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      light.click.mock.invocationCallOrder[0]!
    )
  })
})
