import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

type Scenario = {
  assertions: unknown[]
  clip?: {
    height: number
    width: number
    x: number
    y: number
  }
  figma: {
    captureAnchor?: {
      x: number
      y: number
    }
    focus: string
    selection: string[]
    zoom?: number
  }
  id: string
  intent: string
  panel?: {
    plugins?: string[]
  }
  pointer: {
    shape: string
    target: {
      kind: string
    }
    visible: boolean
  }
  width: number
  height: number
}

type ScreenshotManifest = {
  capture: {
    clipScale: number
    clip: {
      height: number
      width: number
      x: number
      y: number
    }
    deviceScaleFactor: number
    method: string
    sourceScale: number
    themeControl: {
      canvasBackground: {
        method: string
        values: Record<string, string>
      }
      method: string
      values: Record<string, string>
    }
    themes: string[]
    viewport: {
      height: number
      width: number
    }
  }
  fixture: {
    file: {
      key: string
      title: string
      url: string
    }
    kongButton: {
      componentKey: string
      marker: string
    }
  }
  scenarios: Scenario[]
  version: number
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const manifestPath = fileURLToPath(new URL('../screenshots/scenarios.json', import.meta.url))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ScreenshotManifest
const readmes = await Promise.all(
  ['README.md', 'README.zh-Hans.md'].map(async (path) => ({
    path,
    content: await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8')
  }))
)

const errors: string[] = []

if (manifest.version !== 2) {
  errors.push(`scenarios.json: expected version 2, got ${manifest.version}`)
}

if (
  manifest.fixture.file.key !== '4HPsWWxVESGJ9ka4CDdVMx' ||
  manifest.fixture.file.title !== 'TemPad Dev fixtures' ||
  !manifest.fixture.file.url.includes(manifest.fixture.file.key)
) {
  errors.push('scenarios.json: canonical Figma fixture file is not configured correctly')
}

if (
  manifest.fixture.kongButton.componentKey !== '1ee41f133f277b708cf54a74a6c2e294be6664fb' ||
  manifest.fixture.kongButton.marker !== 'plugins'
) {
  errors.push('scenarios.json: verified Kong Button fixture is not configured correctly')
}

if (manifest.capture.themeControl.method !== 'figma-menu') {
  errors.push('scenarios.json: themes must be changed through the real Figma menu')
}

if (
  manifest.capture.method !== 'cdp-clip' ||
  manifest.capture.deviceScaleFactor * manifest.capture.clipScale !== manifest.capture.sourceScale
) {
  errors.push('scenarios.json: native Chrome capture must resolve to the declared output scale')
}

if (manifest.capture.themeControl.canvasBackground.method !== 'figma-page-background') {
  errors.push('scenarios.json: canvas themes must use the real Figma page background')
}

for (const theme of manifest.capture.themes) {
  if (!manifest.capture.themeControl.values[theme]) {
    errors.push(`scenarios.json: missing Figma menu value for theme ${theme}`)
  }
  if (!manifest.capture.themeControl.canvasBackground.values[theme]) {
    errors.push(`scenarios.json: missing Figma page background for theme ${theme}`)
  }
}

const scenarioIds = new Set<string>()
for (const scenario of manifest.scenarios) {
  if (scenarioIds.has(scenario.id)) {
    errors.push(`scenarios.json: duplicate scenario id ${scenario.id}`)
  }
  scenarioIds.add(scenario.id)

  if (!scenario.intent.trim()) {
    errors.push(`scenarios.json: ${scenario.id} is missing its display intent`)
  }
  if (!scenario.figma.focus || !Array.isArray(scenario.figma.selection)) {
    errors.push(`scenarios.json: ${scenario.id} is missing deterministic Figma focus/selection`)
  }
  if (scenario.figma.zoom !== undefined && scenario.figma.zoom <= 0) {
    errors.push(`scenarios.json: ${scenario.id} must use a positive Figma zoom`)
  }
  if (scenario.pointer.shape !== 'default' || !scenario.pointer.target.kind) {
    errors.push(`scenarios.json: ${scenario.id} is missing deterministic pointer state`)
  }
  if (!scenario.assertions.length) {
    errors.push(`scenarios.json: ${scenario.id} must declare pre-capture assertions`)
  }

  const plugins = scenario.panel?.plugins ?? []
  if (scenario.id === 'plugins') {
    if (plugins.length !== 1 || plugins[0] !== 'Kong UI') {
      errors.push('scenarios.json: plugins must be the only scenario that enables Kong UI')
    }
  } else if (plugins.length) {
    errors.push(`scenarios.json: ${scenario.id} must use the native plugin-free state`)
  }

  const clip = { ...manifest.capture.clip, ...scenario.clip }
  if (
    clip.width * manifest.capture.sourceScale !== scenario.width ||
    clip.height * manifest.capture.sourceScale !== scenario.height
  ) {
    errors.push(
      `scenarios.json: ${scenario.id} clip does not scale to ${scenario.width}x${scenario.height}`
    )
  }
}

function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    return null
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

for (const scenario of manifest.scenarios) {
  for (const theme of manifest.capture.themes) {
    const relativePath = `packages/site/public/marketing/${scenario.id}-${theme}.png`
    const absolutePath = `${repoRoot}${relativePath}`

    let buffer: Buffer
    try {
      buffer = await readFile(absolutePath)
    } catch {
      errors.push(`${relativePath}: missing file`)
      continue
    }

    const size = readPngSize(buffer)
    if (!size) {
      errors.push(`${relativePath}: expected a PNG file`)
      continue
    }

    if (size.width !== scenario.width || size.height !== scenario.height) {
      errors.push(
        `${relativePath}: expected ${scenario.width}x${scenario.height}, got ${size.width}x${size.height}`
      )
    }

    for (const readme of readmes) {
      if (!readme.content.includes(relativePath)) {
        errors.push(`${readme.path}: missing reference to ${relativePath}`)
      }
    }
  }
}

if (errors.length) {
  console.error(
    ['Marketing screenshot verification failed:', ...errors.map((error) => `- ${error}`)].join('\n')
  )
  process.exitCode = 1
} else {
  const count = manifest.scenarios.length * manifest.capture.themes.length
  console.log(`Verified ${count} marketing screenshots.`)
}
