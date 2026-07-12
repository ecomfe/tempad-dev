import { copyFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Scenario = { height: number; id: string; width: number }
type Manifest = { capture: { themes: string[] }; scenarios: Scenario[] }

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const manifestPath = fileURLToPath(new URL('../screenshots/scenarios.json', import.meta.url))

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function readPngSize(buffer: Buffer): { height: number; width: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) }
}

async function main(): Promise<void> {
  if (!process.argv.includes('--yes')) {
    throw new Error(
      'Promotion overwrites committed marketing assets. Review screenshots:compare first, then rerun with --yes.'
    )
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
  const candidateDirArgument = readArgument('--candidate-dir')
  const candidateDir = candidateDirArgument
    ? resolve(repoRoot, candidateDirArgument)
    : `${repoRoot}.artifacts/marketing-screenshots`
  const selected = new Set(
    (readArgument('--only') ?? manifest.scenarios.map((scenario) => scenario.id).join(','))
      .split(',')
      .filter(Boolean)
  )
  const candidates: Array<{ source: string; target: string }> = []

  for (const scenario of manifest.scenarios) {
    if (!selected.has(scenario.id)) continue
    for (const theme of manifest.capture.themes) {
      const filename = `${scenario.id}-${theme}.png`
      const source = resolve(candidateDir, filename)
      const size = readPngSize(await readFile(source))
      if (!size || size.width !== scenario.width || size.height !== scenario.height) {
        throw new Error(
          `${filename}: expected ${scenario.width}x${scenario.height}, got ${size ? `${size.width}x${size.height}` : 'a non-PNG file'}.`
        )
      }
      candidates.push({
        source,
        target: `${repoRoot}packages/site/public/marketing/${filename}`
      })
    }
  }

  if (!candidates.length) throw new Error('No matching scenarios were selected.')
  await Promise.all(candidates.map(({ source, target }) => copyFile(source, target)))
  console.log(`Promoted ${candidates.length} screenshots.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
