/* global document, innerWidth, innerHeight, devicePixelRatio */
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { captureDialogPng } from './dialog-capture.mjs'

const { AGENT_INTEGRATIONS } = createRequire(new URL('../../shared/package.json', import.meta.url))(
  './dist/index.js'
)

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

// Adapter for a tab already selected through Codex's supported browser API.
// All browser actions stay on that tab; this does not create a second browser/profile.
export async function captureSetupCandidate(tab, { scenarioId, theme, outputDir }) {
  const manifest = JSON.parse(await readFile(new URL('./scenarios.json', import.meta.url), 'utf8'))
  const scenario = manifest.scenarios.find(({ id }) => id === scenarioId)
  if (!scenario || scenario.group !== 'setup')
    throw new Error('Select a setup scenario from scenarios.json.')
  if (!manifest.capture.themes.includes(theme)) throw new Error(`Unknown theme: ${theme}`)
  const currentUrl = new URL(await tab.url())
  if (
    currentUrl.hostname !== 'www.figma.com' ||
    !currentUrl.pathname.split('/').includes(manifest.fixture.file.key)
  ) {
    throw new Error('Use the canonical Figma fixture tab.')
  }
  // The operator stages the manifest's target/theme/scroll through the visible UI.
  // Capture only verifies and saves, so a configuration-only run never resets the panel.
  const target = AGENT_INTEGRATIONS.find(({ name }) => name === scenario.panel.setupTarget)
  if (!target) throw new Error('Unknown setup target.')
  const pluginActions = target.actions.filter(({ id }) => id.startsWith('plugin-'))
  const commands = (pluginActions.length ? pluginActions : target.actions).filter(
    ({ kind }) => kind !== 'deep-link'
  )
  const evidence = await tab.playwright.evaluate(() => {
    const panel = document.querySelector('#tp-agent-setup-panel')
    const dialog = document.querySelector('tempad [role="dialog"]')
    const viewport = panel?.querySelector('[data-overlayscrollbars-viewport]')
    const rect = (element) => {
      const r = element.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    if (!panel || !dialog || !viewport) throw new Error('Setup dialog is incomplete.')
    return {
      viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
      theme: document.body.getAttribute('data-preferred-theme'),
      dialog: rect(dialog),
      content: rect(viewport),
      text: panel.innerText,
      panelText: document.querySelector('tempad')?.innerText ?? '',
      mcpEnabled:
        document.querySelector('.tp-agent-integration input[type="radio"][value="true"]')
          ?.checked === true,
      selectedId: document.querySelector('tempad [role="tab"][aria-selected="true"]')?.id,
      code: [...panel.querySelectorAll('code')].map((node) => ({
        text: node.textContent,
        rect: rect(node)
      }))
    }
  })
  if (
    evidence.viewport.width !== manifest.capture.viewport.width ||
    evidence.viewport.height !== manifest.capture.viewport.height ||
    evidence.viewport.scale !== manifest.capture.sourceScale
  ) {
    throw new Error('Viewport or device scale does not match the screenshot contract.')
  }
  if (evidence.theme !== theme)
    throw new Error(`Expected ${theme} Figma theme, got ${evidence.theme}.`)
  if (evidence.selectedId !== `tp-agent-tab-${target.id}`)
    throw new Error('Wrong selected setup target.')
  for (const assertion of scenario.assertions) {
    if (
      assertion.kind === 'panel-control-state' &&
      assertion.name === 'MCP access' &&
      evidence.mcpEnabled !== assertion.value
    ) {
      throw new Error('MCP access does not match the scenario.')
    }
    if (assertion.kind === 'panel-text' && !evidence.panelText.includes(assertion.text)) {
      throw new Error(`Missing panel text: ${assertion.text}`)
    }
    if (assertion.kind === 'dialog-text' && !evidence.text.includes(assertion.text)) {
      throw new Error(`Setup text is stale: ${assertion.text}`)
    }
  }
  for (const action of commands) {
    if (!evidence.text.includes(action.value)) throw new Error(`Stale ${action.id} command.`)
    if (!scenario.panel.visibleActionIds.includes(action.id)) continue
    const code = evidence.code.find(({ text }) => text === action.value)
    const visibleTop = Math.max(evidence.dialog.y, evidence.content.y)
    const visibleBottom = Math.min(
      evidence.dialog.y + evidence.dialog.height,
      evidence.content.y + evidence.content.height
    )
    if (
      !code ||
      code.rect.y < visibleTop - 1 ||
      code.rect.y + code.rect.height > visibleBottom + 1 ||
      code.rect.x < evidence.content.x - 1 ||
      code.rect.x + code.rect.width > evidence.content.x + evidence.content.width + 1
    ) {
      throw new Error(`${action.id} is not fully visible. Check the scenario scroll position.`)
    }
  }
  if (
    evidence.dialog.width !== scenario.clip.width ||
    evidence.dialog.height !== scenario.clip.height
  ) {
    throw new Error('The dialog dimensions no longer match the capture contract.')
  }
  if (
    evidence.dialog.x < 0 ||
    evidence.dialog.y < 0 ||
    evidence.dialog.x + evidence.dialog.width > evidence.viewport.width ||
    evidence.dialog.y + evidence.dialog.height > evidence.viewport.height
  ) {
    throw new Error('The setup dialog extends outside the browser viewport.')
  }
  const cdp = await tab.capabilities.get('cdp')
  const captured = await captureDialogPng((method, params) => cdp.send(method, params), {
    ...evidence.dialog,
    scale: manifest.capture.clipScale
  })
  const buffer = Buffer.from(captured.data, 'base64')
  if (buffer.readUInt32BE(16) !== scenario.width || buffer.readUInt32BE(20) !== scenario.height) {
    throw new Error('Captured dimensions do not match the scenario.')
  }
  const directory = resolve(outputDir ?? `${repoRoot}.artifacts/marketing-screenshots`)
  await mkdir(directory, { recursive: true })
  const outputPath = resolve(directory, `${scenario.id}-${theme}.png`)
  await writeFile(outputPath, buffer)
  await writeFile(
    resolve(directory, `${scenario.id}-${theme}.json`),
    JSON.stringify(
      {
        scenario: scenario.id,
        theme,
        fileKey: manifest.fixture.file.key,
        capturedAt: new Date().toISOString(),
        commands: commands.map(({ id, value }) => ({ id, value })),
        evidence
      },
      null,
      2
    ) + '\n'
  )
  return outputPath
}

export async function setSetupCaptureTheme(tab, theme) {
  if (!['light', 'dark'].includes(theme)) throw new Error(`Unknown theme: ${theme}`)
  const dialog = tab.playwright.getByRole('dialog', { name: 'Set up agents', exact: true })
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await tab.playwright.getByRole('button', { name: 'Main menu', exact: true }).click()
  await tab.playwright.getByRole('menuitem', { name: 'Preferences', exact: true }).click()
  await tab.playwright.getByRole('menuitem', { name: 'Theme', exact: true }).click()
  await tab.playwright
    .getByRole('menuitemcheckbox', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
    .click()
  await tab.getAXState({ emit: false })
}
