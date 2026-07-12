import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Scenario = { height: number; id: string; width: number }
type Manifest = {
  capture: { sourceScale: number; themes: string[] }
  scenarios: Scenario[]
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const manifestPath = fileURLToPath(new URL('../screenshots/scenarios.json', import.meta.url))

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

async function imageData(path: string): Promise<string> {
  return `data:image/png;base64,${(await readFile(path)).toString('base64')}`
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
  const candidateDirArgument = readArgument('--candidate-dir')
  const candidateDir = candidateDirArgument
    ? resolve(repoRoot, candidateDirArgument)
    : `${repoRoot}.artifacts/marketing-screenshots`
  const baselineDirArgument = readArgument('--baseline-dir')
  const baselineDir = baselineDirArgument
    ? resolve(repoRoot, baselineDirArgument)
    : `${repoRoot}packages/site/public/marketing`
  const outputArgument = readArgument('--output')
  const outputPath = outputArgument
    ? resolve(repoRoot, outputArgument)
    : `${candidateDir}/comparison.html`
  const selected = new Set(
    (readArgument('--only') ?? manifest.scenarios.map((scenario) => scenario.id).join(','))
      .split(',')
      .filter(Boolean)
  )
  const rows: string[] = []

  for (const scenario of manifest.scenarios) {
    if (!selected.has(scenario.id)) continue
    const displayWidth = scenario.width / manifest.capture.sourceScale
    for (const theme of manifest.capture.themes) {
      const filename = `${scenario.id}-${theme}.png`
      const baselinePath = resolve(baselineDir, filename)
      const candidatePath = resolve(candidateDir, filename)
      let baseline: string
      let candidate: string
      try {
        ;[baseline, candidate] = await Promise.all([
          imageData(baselinePath),
          imageData(candidatePath)
        ])
      } catch {
        throw new Error(`Missing baseline or candidate for ${filename}.`)
      }

      rows.push(`
        <section class="comparison">
          <h2>${escapeHtml(scenario.id)} <span>${escapeHtml(theme)}</span></h2>
          <div class="pair">
            <figure><figcaption>Committed baseline</figcaption><img src="${baseline}" width="${displayWidth}"></figure>
            <figure><figcaption>New candidate</figcaption><img src="${candidate}" width="${displayWidth}"></figure>
          </div>
        </section>`)
    }
  }

  if (!rows.length) throw new Error('No matching scenarios were selected.')
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TemPad Dev screenshot comparison</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.4 system-ui, sans-serif; }
  body { margin: 0; padding: 32px; background: Canvas; color: CanvasText; }
  header { max-width: 1440px; margin: 0 auto 32px; }
  h1, h2, p { margin: 0; }
  header p { margin-top: 8px; color: GrayText; }
  main { display: grid; gap: 40px; max-width: 1440px; margin: auto; }
  .comparison { border-top: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding-top: 16px; }
  h2 { font-size: 16px; margin-bottom: 16px; }
  h2 span { color: GrayText; font-weight: 400; }
  .pair { display: flex; align-items: flex-start; gap: 24px; overflow-x: auto; }
  figure { margin: 0; flex: none; }
  figcaption { margin-bottom: 8px; color: GrayText; }
  img { display: block; max-width: none; box-shadow: 0 0 0 1px color-mix(in srgb, CanvasText 12%, transparent); }
</style>
<header>
  <h1>TemPad Dev screenshot regression review</h1>
  <p>Both columns are rendered at their README display width. Promote candidates only after every row preserves intent and contains no visual regression.</p>
</header>
<main>${rows.join('\n')}</main>
</html>`

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, html)
  console.log(`Wrote ${outputPath}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
