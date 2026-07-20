import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Locator, type Page } from 'playwright'

type Point = { x: number; y: number }
type Rect = Point & { height: number; width: number }
type Theme = 'dark' | 'light'

type Assertion = {
  kind: string
  name?: string
  text?: string
  tool?: string
  value?: boolean | number | string
  values?: number[]
}

type Scenario = {
  assertions: Assertion[]
  clip?: Rect & {
    anchor?: {
      edge: string
      kind: string
      name?: string
      offset?: Point
    }
  }
  figma: {
    captureAnchor?: Point
    focus: string
    selection: string[]
    zoom?: number
  }
  height: number
  id: string
  mcpStatus?: 'active' | 'inactive' | 'unavailable'
  panel?: {
    deepSelect?: boolean
    focus?: {
      name: string
      role: string
      selectText?: boolean
    }
    setupTarget?: string
    mcpEnabled?: boolean
    measure?: boolean
    options?: {
      cssUnit?: string
      rootFontSize?: number
      scale?: number
    }
    plugins?: string[]
    preferencesOpen?: boolean
  }
  pointer: {
    target: {
      anchor?: 'center' | Point
      control?: string
      kind: string
      marker?: string
      name?: string
      role?: string
    }
    tooltip?: string
    visible: boolean
  }
  width: number
}

type Manifest = {
  baseline: {
    panel: {
      deepSelect: boolean
      mcpEnabled: boolean
      measure: boolean
      plugins: string[]
      preferencesOpen: boolean
    }
  }
  capture: {
    canvasAnchor: Point
    clip: Rect
    hiddenPointer: Point
    panel: Point
    panelControls: Record<string, { index: number; selector: string }>
    settleMs: number
    sourceScale: number
    themes: Theme[]
    viewport: { height: number; width: number }
  }
  fixture: {
    file: { key: string; title: string; url: string }
  }
  scenarios: Scenario[]
}

type FixtureRuntime = {
  bounds(marker: string): Rect
  list(): Array<{ marker: string }>
  setCanvasTheme(theme: Theme): unknown
  stage(input: {
    focus: string
    selection: string[]
    theme: Theme
    x: number
    y: number
    zoom: number
  }): Promise<{ selection: unknown[] }>
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const manifestPath = fileURLToPath(new URL('../screenshots/scenarios.json', import.meta.url))
const fixtureRuntimePath = fileURLToPath(
  new URL('../screenshots/fixture-runtime.js', import.meta.url)
)

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function hasArgument(name: string): boolean {
  return process.argv.includes(name)
}

function fail(message: string): never {
  throw new Error(message)
}

function usage(): string {
  return [
    'Capture README screenshots from an already-open, logged-in Chrome:',
    '',
    '  pnpm screenshots capture --cdp-url http://127.0.0.1:9222',
    '  pnpm screenshots capture --only code,unit,deep',
    '',
    'Options:',
    '  --cdp-url <url>       Chrome DevTools endpoint (default: TEMPAD_SCREENSHOT_CDP_URL or http://127.0.0.1:9222)',
    '  --output-dir <path>   Candidate directory (default: .artifacts/marketing-screenshots)',
    '  --only <ids>          Comma-separated scenario ids',
    '  --themes <values>     light,dark or one theme',
    '  --help                Show this help',
    '',
    'The default run captures every scene except MCP unavailable/inactive.',
    'MCP unavailable/inactive captures are state-gated: prepare the real bridge state and leave',
    'TemPad Dev preferences open before running that scenario alone.'
  ].join('\n')
}

function readPngSize(buffer: Buffer): { height: number; width: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) }
}

async function expectRect(locator: Locator, label: string): Promise<Rect> {
  const box = await locator.boundingBox()
  if (!box) fail(`${label} is not visible.`)
  return box
}

async function isPreferencesOpen(page: Page): Promise<boolean> {
  return (await page.locator('article main').innerText()).startsWith('Tools')
}

async function ensurePreferences(page: Page, open: boolean): Promise<void> {
  if ((await isPreferencesOpen(page)) === open) return
  await page.locator('article button').nth(0).click()
  await page.waitForTimeout(250)
  if ((await isPreferencesOpen(page)) !== open) {
    fail(`Could not ${open ? 'open' : 'close'} TemPad Dev preferences.`)
  }
}

async function setFigmaTheme(page: Page, theme: Theme): Promise<void> {
  await page.getByRole('button', { name: 'Main menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Preferences', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Theme', exact: true }).click()
  await page
    .getByRole('menuitemcheckbox', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
    .click()
  await page.waitForTimeout(500)
}

async function minimizeFigmaUi(page: Page): Promise<void> {
  const collapse = page.getByRole('button', { name: /Collapse UI for file named|Minimize UI/ })
  if (await collapse.count()) {
    await collapse.click()
    await page.waitForTimeout(350)
  }
  if (!(await page.getByRole('button', { name: /Expand UI for file named/ }).count())) {
    fail('Figma did not enter the minimized capture layout.')
  }
}

async function placePanel(page: Page, target: Point): Promise<void> {
  const panel = page.locator('article')
  const panelBox = await expectRect(panel, 'TemPad Dev panel')
  const delta = { x: target.x - panelBox.x, y: target.y - panelBox.y }
  if (Math.abs(delta.x) < 1 && Math.abs(delta.y) < 1) return

  const headerBox = await expectRect(panel.locator('header').first(), 'TemPad Dev panel header')
  const start = { x: headerBox.x + headerBox.width / 2, y: headerBox.y + headerBox.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  const placed = await expectRect(panel, 'TemPad Dev panel')
  if (Math.abs(placed.x - target.x) > 2 || Math.abs(placed.y - target.y) > 2) {
    fail(
      `TemPad Dev panel landed at ${placed.x.toFixed(1)},${placed.y.toFixed(1)} instead of ${target.x},${target.y}.`
    )
  }
}

async function setSelect(page: Page, name: string, value: string): Promise<void> {
  const select = page.getByRole('combobox', { name })
  const current = (await select.innerText()).trim()
  if (current.includes(value)) return
  await select.click()
  await page.getByRole('option', { name: value, exact: true }).click()
}

async function setInputValue(page: Page, value: number, index: number): Promise<void> {
  const inputs = page.locator('article main input')
  const input = inputs.nth(index)
  if ((await input.inputValue()) === String(value)) return
  await input.fill(String(value))
  await input.press('Enter')
}

async function setToggleButton(page: Page, index: number, active: boolean): Promise<void> {
  const button = page.locator('article main button').nth(index)
  const selected = await button.evaluate((element) =>
    element.classList.contains('tp-button-selected')
  )
  if (selected !== active) await button.click()
}

async function setMcpEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.getByRole('radio', { name: enabled ? 'Enabled' : 'Disabled', exact: true }).click()
  await page.waitForTimeout(250)
}

async function setKongPlugin(page: Page, enabled: boolean): Promise<void> {
  const checkbox = page.getByRole('checkbox', { name: 'Kong UI', exact: true })
  if ((await checkbox.isChecked()) !== enabled) await checkbox.setChecked(enabled, { force: true })
  await page.waitForTimeout(250)
}

async function closeSetupDialog(page: Page): Promise<void> {
  const tempad = page.locator('tempad')
  const setupDialog = tempad.getByRole('dialog', { name: 'Set up agents', exact: true })
  if (await setupDialog.count()) {
    await setupDialog.getByRole('button', { name: 'Close', exact: true }).click()
    await setupDialog.waitFor({ state: 'detached' })
  }
}

async function resetPanel(page: Page): Promise<void> {
  await closeSetupDialog(page)
  await ensurePreferences(page, true)
  await setSelect(page, 'CSS unit', 'px')
  await setSelect(page, 'Variable display', 'Both')
  await setInputValue(page, 16, 0)
  await setInputValue(page, 1, 1)
  await setToggleButton(page, 0, false)
  await setToggleButton(page, 1, false)
  await setMcpEnabled(page, false)
  await setKongPlugin(page, false)
}

async function configureScenario(page: Page, scenario: Scenario): Promise<void> {
  await resetPanel(page)
  const panel = scenario.panel ?? {}

  if (panel.options?.cssUnit) await setSelect(page, 'CSS unit', panel.options.cssUnit)
  if (panel.options?.rootFontSize !== undefined) {
    await setInputValue(page, panel.options.rootFontSize, 0)
  }
  if (panel.options?.scale !== undefined) await setInputValue(page, panel.options.scale, 1)
  if (panel.deepSelect !== undefined) await setToggleButton(page, 0, panel.deepSelect)
  if (panel.measure !== undefined) await setToggleButton(page, 1, panel.measure)
  if (panel.mcpEnabled !== undefined) await setMcpEnabled(page, panel.mcpEnabled)
  await setKongPlugin(page, panel.plugins?.includes('Kong UI') ?? false)

  if (panel.setupTarget) {
    await page.locator('tempad').getByRole('button', { name: 'Set up agents', exact: true }).click()
    const target = page.locator('tempad').getByRole('tab', { name: panel.setupTarget, exact: true })
    if ((await target.getAttribute('aria-selected')) !== 'true') await target.click()
  }

  await ensurePreferences(page, panel.preferencesOpen ?? false)
}

async function stageCanvas(
  page: Page,
  manifest: Manifest,
  scenario: Scenario,
  theme: Theme
): Promise<{ selection: unknown[] }> {
  const anchor = scenario.figma.captureAnchor ?? manifest.capture.canvasAnchor
  return page.evaluate(
    ({ input }) => {
      const runtime = (
        globalThis as typeof globalThis & {
          __TEMPAD_README_SCREENSHOTS__: FixtureRuntime
        }
      ).__TEMPAD_README_SCREENSHOTS__
      return runtime.stage(input)
    },
    {
      input: {
        focus: scenario.figma.focus,
        selection: scenario.figma.selection,
        theme,
        x: anchor.x,
        y: anchor.y,
        zoom: scenario.figma.zoom ?? 1
      }
    }
  )
}

async function fixtureBounds(page: Page, marker: string): Promise<Rect> {
  return page.evaluate((value) => {
    const runtime = (
      globalThis as typeof globalThis & {
        __TEMPAD_README_SCREENSHOTS__: FixtureRuntime
      }
    ).__TEMPAD_README_SCREENSHOTS__
    return runtime.bounds(value)
  }, marker)
}

async function panelControl(page: Page, scenario: Scenario): Promise<Locator> {
  const target = scenario.pointer.target
  if (target.control === 'scrollIntoView') {
    return page.locator('article main button[data-tooltip="Scroll into view"]')
  }
  if (target.role === 'spinbutton' && target.name) {
    return page.getByRole('spinbutton', { name: target.name })
  }
  fail(`Unsupported panel pointer target in ${scenario.id}.`)
}

async function pointerPoint(page: Page, manifest: Manifest, scenario: Scenario): Promise<Point> {
  const target = scenario.pointer.target
  if (!scenario.pointer.visible || target.kind === 'hiddenPointer') {
    return manifest.capture.hiddenPointer
  }
  if (target.kind === 'canvas-node' && target.marker) {
    const bounds = await fixtureBounds(page, target.marker)
    const anchor = target.anchor ?? 'center'
    const normalized = anchor === 'center' ? { x: 0.5, y: 0.5 } : anchor
    return {
      x: bounds.x + bounds.width * normalized.x,
      y: bounds.y + bounds.height * normalized.y
    }
  }
  if (target.kind === 'panel-control') {
    const bounds = await expectRect(
      await panelControl(page, scenario),
      `${scenario.id} pointer target`
    )
    const anchor = target.anchor ?? 'center'
    const normalized = anchor === 'center' ? { x: 0.5, y: 0.5 } : anchor
    return {
      x: bounds.x + bounds.width * normalized.x,
      y: bounds.y + bounds.height * normalized.y
    }
  }
  fail(`Unsupported pointer target ${target.kind} in ${scenario.id}.`)
}

async function renderPointer(page: Page, point: Point, visible: boolean): Promise<void> {
  await page.evaluate(
    ({ point: value, visible: show }) => {
      document.querySelector('#tempad-readme-cursor')?.remove()
      if (!show) return
      const cursor = document.createElement('div')
      cursor.id = 'tempad-readme-cursor'
      cursor.style.cssText = [
        'position:fixed',
        `left:${value.x}px`,
        `top:${value.y}px`,
        'width:32px',
        'height:32px',
        'pointer-events:none',
        'z-index:2147483647',
        'transform:translate(-5px,-3.5px)',
        'filter:drop-shadow(0 0 7px rgba(0,152,255,.8))'
      ].join(';')
      cursor.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3.5 26 13l-9 3.2-3.4 9.1L5 3.5Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>'
      document.body.append(cursor)
    },
    { point, visible }
  )
}

async function stabilizeCompositor(page: Page, point: Point): Promise<void> {
  await page.evaluate((value) => {
    document.querySelector('#tempad-readme-compositor')?.remove()
    const guard = document.createElement('div')
    guard.id = 'tempad-readme-compositor'
    guard.style.cssText = [
      'position:fixed',
      `left:${value.x}px`,
      `top:${value.y}px`,
      'width:32px',
      'height:32px',
      'pointer-events:none',
      'z-index:2147483647',
      'filter:drop-shadow(0 0 7px rgba(0,152,255,.8))'
    ].join(';')
    guard.innerHTML =
      '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3.5 26 13l-9 3.2-3.4 9.1L5 3.5Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>'
    document.body.append(guard)
  }, point)
}

async function resolveClip(page: Page, manifest: Manifest, scenario: Scenario): Promise<Rect> {
  const source = { ...manifest.capture.clip, ...scenario.clip }
  const clip = { height: source.height, width: source.width, x: source.x, y: source.y }
  const anchor = scenario.clip?.anchor
  if (!anchor) return clip

  const offset = anchor.offset ?? { x: 0, y: 0 }
  if (anchor.kind === 'panel') {
    const panel = await expectRect(page.locator('article'), 'TemPad Dev panel')
    return { ...clip, x: panel.x + offset.x, y: panel.y + offset.y }
  }
  if (anchor.kind === 'panel-section' && anchor.name) {
    const heading = page.getByText(anchor.name, { exact: true }).first()
    const section = heading.locator('xpath=ancestor::section[1]')
    const box = await expectRect(section, `${anchor.name} section`)
    return { ...clip, x: box.x + offset.x, y: box.y + offset.y }
  }
  if (anchor.kind === 'dialog') {
    const dialog = await expectRect(
      page.locator('tempad').getByRole('dialog', { name: anchor.name, exact: true }),
      `${anchor.name ?? 'Open'} dialog`
    )
    return { ...clip, x: dialog.x + offset.x, y: dialog.y + offset.y }
  }
  fail(`Unsupported clip anchor ${anchor.kind} in ${scenario.id}.`)
}

async function assertMcpStatus(
  page: Page,
  status: NonNullable<Scenario['mcpStatus']>
): Promise<void> {
  const badge = page.locator('article .tp-mcp-badge')
  const className = await badge.getAttribute('class')
  const expected = {
    active: 'tp-mcp-badge-active',
    inactive: 'tp-mcp-badge-inactive',
    unavailable: 'tp-mcp-badge-error'
  }[status]
  if (!className?.includes(expected)) {
    fail(`Expected MCP ${status}, got badge class ${className ?? '<missing>'}.`)
  }
}

async function assertScenario(
  page: Page,
  scenario: Scenario,
  stage: { selection: unknown[] } | null
): Promise<void> {
  const panelText = await page.locator('article main').innerText()
  let dialogText: string | undefined
  if (scenario.mcpStatus) await assertMcpStatus(page, scenario.mcpStatus)

  for (const assertion of scenario.assertions) {
    switch (assertion.kind) {
      case 'figma-selection-count':
        if (stage && stage.selection.length !== assertion.value) {
          fail(
            `${scenario.id}: selection count is ${stage.selection.length}, not ${assertion.value}.`
          )
        }
        break
      case 'mcp-status':
        break
      case 'panel-control-state': {
        if (assertion.name === 'MCP access') {
          const enabled = await page
            .getByRole('radio', { name: 'Enabled', exact: true })
            .isChecked()
          if (enabled !== assertion.value) fail(`${scenario.id}: MCP enabled state is incorrect.`)
        }
        break
      }
      case 'panel-control-value': {
        if (!assertion.name) break
        const control = page.getByRole('combobox', { name: assertion.name })
        if (await control.count()) {
          if (!(await control.innerText()).includes(String(assertion.value))) {
            fail(`${scenario.id}: ${assertion.name} does not show ${assertion.value}.`)
          }
        } else if (!panelText.includes(String(assertion.value))) {
          fail(`${scenario.id}: ${assertion.name} does not show ${assertion.value}.`)
        }
        break
      }
      case 'panel-tool-active': {
        const index = assertion.tool === 'deepSelect' ? 0 : 1
        const active = await page
          .locator('article main button')
          .nth(index)
          .evaluate((element) => element.classList.contains('tp-button-selected'))
        if (!active) fail(`${scenario.id}: ${assertion.tool} is not active.`)
        break
      }
      case 'tooltip':
        if (assertion.text && !(await page.getByText(assertion.text, { exact: true }).count())) {
          fail(`${scenario.id}: tooltip ${assertion.text} is not visible.`)
        }
        break
      case 'panel-text-absent':
        if (assertion.text && panelText.includes(assertion.text)) {
          fail(`${scenario.id}: panel unexpectedly contains ${assertion.text}.`)
        }
        break
      case 'dialog-text': {
        dialogText ??= await page
          .locator('tempad')
          .getByRole('dialog', { name: 'Set up agents', exact: true })
          .innerText()
        if (assertion.text && !dialogText.includes(assertion.text)) {
          fail(`${scenario.id}: dialog does not contain ${assertion.text}.`)
        }
        break
      }
      default:
        if (assertion.text && !panelText.includes(assertion.text)) {
          fail(`${scenario.id}: panel does not contain ${assertion.text}.`)
        }
    }
  }
}

async function prepareFocus(page: Page, scenario: Scenario): Promise<void> {
  const focus = scenario.panel?.focus
  if (!focus) return
  const input = page.getByRole(focus.role as 'spinbutton', { name: focus.name })
  await input.focus()
  if (focus.selectText) await input.evaluate((element) => (element as HTMLInputElement).select())
}

async function captureScenario(
  page: Page,
  manifest: Manifest,
  scenario: Scenario,
  theme: Theme,
  outputDir: string
): Promise<void> {
  const isStateGated = scenario.mcpStatus === 'inactive' || scenario.mcpStatus === 'unavailable'
  if (!isStateGated) await configureScenario(page, scenario)
  if (isStateGated && !(await isPreferencesOpen(page))) {
    fail(`${scenario.id}: leave TemPad Dev preferences open before capturing this MCP state.`)
  }

  const stage = isStateGated ? null : await stageCanvas(page, manifest, scenario, theme)
  if (isStateGated) {
    await page.evaluate((value) => {
      const runtime = (
        globalThis as typeof globalThis & {
          __TEMPAD_README_SCREENSHOTS__: FixtureRuntime
        }
      ).__TEMPAD_README_SCREENSHOTS__
      runtime.setCanvasTheme(value)
    }, theme)
  }

  await prepareFocus(page, scenario)
  const point = await pointerPoint(page, manifest, scenario)
  await page.mouse.move(point.x, point.y)
  await renderPointer(page, point, scenario.pointer.visible)
  await stabilizeCompositor(page, manifest.capture.hiddenPointer)
  await page.waitForTimeout(scenario.pointer.tooltip ? 700 : manifest.capture.settleMs)
  await assertScenario(page, scenario, stage)

  const clip = await resolveClip(page, manifest, scenario)
  const outputPath = resolve(outputDir, `${scenario.id}-${theme}.png`)
  await page.screenshot({ animations: 'disabled', clip, path: outputPath, scale: 'device' })
  const size = readPngSize(await readFile(outputPath))
  if (!size || size.width !== scenario.width || size.height !== scenario.height) {
    fail(
      `${scenario.id}-${theme}: expected ${scenario.width}x${scenario.height}, got ${size ? `${size.width}x${size.height}` : 'a non-PNG file'}.`
    )
  }
  console.log(`Captured ${outputPath}`)
}

async function main(): Promise<void> {
  if (hasArgument('--help')) {
    console.log(usage())
    return
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
  const fixtureRuntime = await readFile(fixtureRuntimePath, 'utf8')
  const cdpUrl =
    readArgument('--cdp-url') ?? process.env.TEMPAD_SCREENSHOT_CDP_URL ?? 'http://127.0.0.1:9222'
  const outputDirArgument = readArgument('--output-dir')
  const outputDir = outputDirArgument
    ? resolve(repoRoot, outputDirArgument)
    : `${repoRoot}.artifacts/marketing-screenshots`
  const defaultScenarioIds = manifest.scenarios
    .filter((scenario) => !['inactive', 'unavailable'].includes(scenario.mcpStatus ?? ''))
    .map((scenario) => scenario.id)
  const selectedIds = new Set(
    (readArgument('--only') ?? defaultScenarioIds.join(',')).split(',').filter(Boolean)
  )
  const selectedThemes = new Set(
    (readArgument('--themes') ?? manifest.capture.themes.join(','))
      .split(',')
      .filter(Boolean) as Theme[]
  )
  const scenarios = manifest.scenarios.filter((scenario) => selectedIds.has(scenario.id))
  const orderedScenarios = [...scenarios].sort(
    (a, b) => Number(a.id === 'plugins') - Number(b.id === 'plugins')
  )
  const unknown = [...selectedIds].filter(
    (id) => !manifest.scenarios.some((scenario) => scenario.id === id)
  )
  if (unknown.length) fail(`Unknown scenarios: ${unknown.join(', ')}`)
  if (!scenarios.length) fail('No scenarios selected.')
  const hasStateGatedScenario = scenarios.some((scenario) =>
    ['inactive', 'unavailable'].includes(scenario.mcpStatus ?? '')
  )
  if (hasStateGatedScenario && scenarios.length !== 1) {
    fail('Capture MCP unavailable/inactive as a single --only scenario after preparing its state.')
  }
  if ([...selectedThemes].some((theme) => !manifest.capture.themes.includes(theme))) {
    fail(`Themes must be one of: ${manifest.capture.themes.join(', ')}.`)
  }

  await mkdir(outputDir, { recursive: true })
  const browser = await chromium.connectOverCDP(cdpUrl)
  const pages = browser.contexts().flatMap((context) => context.pages())
  const page = pages.find((candidate) => candidate.url().includes(manifest.fixture.file.key))
  if (!page) fail(`Open ${manifest.fixture.file.url} in the connected Chrome before capture.`)

  await page.bringToFront()
  await page.waitForLoadState('domcontentloaded')
  const viewport = await page.evaluate(() => ({ height: innerHeight, width: innerWidth }))
  if (
    viewport.width !== manifest.capture.viewport.width ||
    viewport.height !== manifest.capture.viewport.height
  ) {
    fail(
      `Expected viewport ${manifest.capture.viewport.width}x${manifest.capture.viewport.height}, got ${viewport.width}x${viewport.height}.`
    )
  }

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: fixtureRuntime,
    returnByValue: true
  })
  await page.waitForFunction(() => '__TEMPAD_README_SCREENSHOTS__' in globalThis)
  const markers = await page.evaluate(() => {
    const runtime = (
      globalThis as typeof globalThis & {
        __TEMPAD_README_SCREENSHOTS__: FixtureRuntime
      }
    ).__TEMPAD_README_SCREENSHOTS__
    return runtime.list().map((node) => node.marker)
  })
  if (
    !['code', 'deep_outer', 'deep_inner', 'measure_outer', 'measure_inner', 'plugins'].every(
      (marker) => markers.includes(marker)
    )
  ) {
    fail('The canonical Figma fixture page is incomplete.')
  }

  await minimizeFigmaUi(page)
  if (!hasStateGatedScenario) {
    await placePanel(page, manifest.capture.panel)
  }

  try {
    for (const theme of manifest.capture.themes) {
      if (selectedThemes.has(theme)) {
        await closeSetupDialog(page)
        await setFigmaTheme(page, theme)
        for (const scenario of orderedScenarios) {
          await captureScenario(page, manifest, scenario, theme, outputDir)
        }
      }
    }
  } finally {
    await setFigmaTheme(page, 'light').catch(() => undefined)
    await page
      .evaluate(() => {
        const runtime = (
          globalThis as typeof globalThis & {
            __TEMPAD_README_SCREENSHOTS__: FixtureRuntime
          }
        ).__TEMPAD_README_SCREENSHOTS__
        runtime.setCanvasTheme('light')
        document.querySelector('#tempad-readme-cursor')?.remove()
        document.querySelector('#tempad-readme-compositor')?.remove()
      })
      .catch(() => undefined)

    if (!hasStateGatedScenario) {
      await resetPanel(page).catch(() => undefined)
      await ensurePreferences(page, false).catch(() => undefined)
      const code = manifest.scenarios.find((scenario) => scenario.id === 'code')
      if (code) await stageCanvas(page, manifest, code, 'light').catch(() => undefined)
    }
  }
  console.log(`Candidates written to ${outputDir}`)
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
