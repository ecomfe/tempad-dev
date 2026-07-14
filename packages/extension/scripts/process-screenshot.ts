import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

type Scenario = {
  clip?: ClipRect
  id: string
  width: number
  height: number
}

type ClipRect = {
  x: number
  y: number
  width: number
  height: number
}

type ScreenshotManifest = {
  capture: {
    clip: ClipRect
    deviceScaleFactor: number
    sourceScale: number
    themes: string[]
    viewport: {
      height: number
      width: number
    }
  }
  scenarios: Scenario[]
}

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const manifestPath = fileURLToPath(new URL('../screenshots/scenarios.json', import.meta.url))
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ScreenshotManifest

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function fail(message: string): never {
  throw new Error(
    `${message}\nUsage: pnpm screenshots process --scenario <id> --theme <light|dark> --input <path> [--output <path>] [--clip-x <pixels> --clip-y <pixels>]`
  )
}

function readNumberArgument(name: string): number | null {
  const value = readArgument(name)
  if (value === null) return null

  const number = Number(value)
  if (!Number.isFinite(number)) {
    fail(`${name} must be a finite number.`)
  }

  return number
}

const scenarioId = readArgument('--scenario') ?? fail('Missing --scenario.')
const theme = readArgument('--theme') ?? fail('Missing --theme.')
const input = readArgument('--input') ?? fail('Missing --input.')
const scenario = manifest.scenarios.find((candidate) => candidate.id === scenarioId)

if (!scenario) {
  fail(`Unknown screenshot scenario: ${scenarioId}.`)
}

if (!manifest.capture.themes.includes(theme)) {
  fail(`Unknown screenshot theme: ${theme}.`)
}

if (process.platform !== 'darwin') {
  fail('Screenshot processing currently requires macOS sips.')
}

const inputPath = resolve(input)
const outputPath = resolve(
  readArgument('--output') ??
    `${repoRoot}packages/site/public/marketing/${scenario.id}-${theme}.png`
)
const clipX = readNumberArgument('--clip-x')
const clipY = readNumberArgument('--clip-y')

if ((clipX === null) !== (clipY === null)) {
  fail('--clip-x and --clip-y must be provided together.')
}

const resolvedClip = clipX !== null && clipY !== null ? { x: clipX, y: clipY } : {}
const clip = {
  ...manifest.capture.clip,
  ...scenario.clip,
  ...resolvedClip,
  width: scenario.width / manifest.capture.sourceScale,
  height: scenario.height / manifest.capture.sourceScale
}
const { stdout: sizeOutput } = await execFileAsync('/usr/bin/sips', [
  '-g',
  'pixelWidth',
  '-g',
  'pixelHeight',
  inputPath
])
const sourceWidth = Number(sizeOutput.match(/pixelWidth:\s*(\d+)/)?.[1])
const sourceHeight = Number(sizeOutput.match(/pixelHeight:\s*(\d+)/)?.[1])
const isProcessedCrop = sourceWidth === scenario.width && sourceHeight === scenario.height
const viewportScale =
  sourceWidth === manifest.capture.viewport.width &&
  sourceHeight === manifest.capture.viewport.height
    ? 1
    : sourceWidth === manifest.capture.viewport.width * manifest.capture.deviceScaleFactor &&
        sourceHeight === manifest.capture.viewport.height * manifest.capture.deviceScaleFactor
      ? manifest.capture.deviceScaleFactor
      : null

if (!isProcessedCrop && viewportScale === null) {
  fail(
    `Expected a ${scenario.width}x${scenario.height} processed crop, a ${manifest.capture.viewport.width}x${manifest.capture.viewport.height} CSS viewport capture, or a ${manifest.capture.viewport.width * manifest.capture.deviceScaleFactor}x${manifest.capture.viewport.height * manifest.capture.deviceScaleFactor} native viewport capture; got ${sourceWidth}x${sourceHeight}.`
  )
}

if (
  !isProcessedCrop &&
  (sourceWidth < (clip.x + clip.width) * viewportScale! ||
    sourceHeight < (clip.y + clip.height) * viewportScale!)
) {
  fail(
    `The ${sourceWidth}x${sourceHeight} source image does not contain the ${clip.width}x${clip.height} crop at ${clip.x},${clip.y}.`
  )
}

await mkdir(dirname(outputPath), { recursive: true })

if (isProcessedCrop) {
  await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', inputPath, '--out', outputPath])
  console.log(`Wrote ${outputPath}`)
  process.exit(0)
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tempad-screenshot-'))
const croppedPath = join(temporaryDirectory, 'cropped.png')
const scaledClip = {
  x: clip.x * viewportScale!,
  y: clip.y * viewportScale!,
  width: clip.width * viewportScale!,
  height: clip.height * viewportScale!
}

try {
  await execFileAsync('/usr/bin/sips', [
    '-c',
    String(scaledClip.height),
    String(scaledClip.width),
    '--cropOffset',
    String(scaledClip.y),
    String(scaledClip.x),
    '-s',
    'format',
    'png',
    inputPath,
    '--out',
    croppedPath
  ])
  await execFileAsync('/usr/bin/sips', [
    '-s',
    'format',
    'png',
    '-z',
    String(scenario.height),
    String(scenario.width),
    croppedPath,
    '--out',
    outputPath
  ])
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}

console.log(`Wrote ${outputPath}`)
