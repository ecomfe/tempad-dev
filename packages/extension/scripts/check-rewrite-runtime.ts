import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtureUrl = 'https://www.figma.com/design/rewrite-fixture'

async function main() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'tempad-rewrite-'))
  const extension = path.join(temporary, 'extension')
  // Exercise the built entrypoints and DNR rules without UI, MCP or any real Figma session.
  await cp(path.join(root, '.output/chrome-mv3'), extension, { recursive: true })
  const manifestPath = path.join(extension, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  delete manifest.background
  manifest.content_scripts = manifest.content_scripts.filter((entry: { js: string[] }) =>
    entry.js.some((js) => js.includes('rewrite'))
  )
  await writeFile(manifestPath, JSON.stringify(manifest))
  const runtimeCode = await readFile(path.join(root, 'dist/figma-runtime-v1.js'), 'utf8')
  const rspack = await readFile(path.join(root, 'tests/fixtures/rewrite-rspack.js'), 'utf8')
  const context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  })
  const counts = new Map<string, number>()
  let mode: 'remote' | 'offline' | 'timeout' | 'source-failure' = 'remote'
  await context.route('https://ecomfe.github.io/**', async (route) => {
    counts.set('runtime', (counts.get('runtime') || 0) + 1)
    if (mode === 'offline') return await route.abort()
    if (mode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 1800))
    }
    const body = `${runtimeCode}\nconst base = TemPadRewriteRuntimeV1.default.rewrite;
      TemPadRewriteRuntimeV1.default.rewrite = (source, url) => base(source, url).replaceAll('"ORIGINAL"', '"REMOTE"');`
    await route
      .fulfill({
        contentType: 'application/javascript',
        body,
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
      .catch(() => {})
  })
  await context.route('https://www.figma.com/**', async (route) => {
    const url = new URL(route.request().url())
    const file = url.pathname.split('/').pop()!
    if (file === 'rewrite-fixture') {
      return await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
        <script>window.execution=[];window.loads=[];window.chunkSideEffects=0;</script>
        <script defer src="/webpack-artifacts/assets/entry.min.js"
          onload="window.loads.push(window.execution.slice())"></script>`
      })
    }
    counts.set(file, (counts.get(file) || 0) + 1)
    if (
      ((mode === 'source-failure' && file === 'entry.min.js') || file === 'recover.min.js') &&
      !url.searchParams.has('tempad-fallback')
    ) {
      return await route.abort()
    }
    if (file === 'entry.min.js') {
      return await route.fulfill({
        contentType: 'application/javascript',
        body: `${rspack}
        window.execution.push("ORIGINAL"); window.originalScriptUrl=document.currentScript.src;`
      })
    }
    if (file === 'slow.min.js') await new Promise((resolve) => setTimeout(resolve, 100))
    if (file === 'network-error.min.js') return await route.abort()
    const id = file.replace('.min.js', '')
    const body =
      id === 'missing'
        ? 'window.chunkSideEffects++;'
        : `window.chunkSideEffects++;var nativeChunkGlobal="native";
       window.webpackChunk_figma_web_bundler.push([[${JSON.stringify(id)}],{
         ${JSON.stringify(id)}:()=>"ORIGINAL"
       }]);`
    await route.fulfill({ contentType: 'application/javascript', body }).catch(() => {})
  })
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    await page.goto(fixtureUrl)
    await page.waitForFunction(() => Reflect.get(window, 'loads').length === 1)
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'loads')), [['REMOTE']])
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'originalScriptUrl')),
      'https://www.figma.com/webpack-artifacts/assets/entry.min.js'
    )
    const chunks = await page.evaluate(async () => {
      const load = Reflect.get(window, 'loadTestChunk')
      return await Promise.all([load('a'), load('a'), load('b')])
    })
    assert.deepEqual(chunks, ['REMOTE', 'REMOTE', 'REMOTE'])
    assert.equal(counts.get('runtime'), 1)
    assert.equal(counts.get('a.min.js'), 1)
    assert.equal(await page.evaluate(() => Reflect.get(window, 'nativeChunkGlobal')), 'native')
    const failures = await page.evaluate(async () => {
      const load = Reflect.get(window, 'loadTestChunk')
      return await Promise.all(
        ['missing', 'network-error', 'slow'].map(async (id) => {
          try {
            await load(id, id === 'slow' ? 20 : 3000)
            return 'unexpected success'
          } catch (error) {
            return (error as Error).name
          }
        })
      )
    })
    assert.deepEqual(failures, ['ChunkLoadError', 'ChunkLoadError', 'ChunkLoadError'])
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => Reflect.get(window, 'chunkSideEffects')), 3)
    assert.equal(
      await page.evaluate(async () => await Reflect.get(window, 'loadTestChunk')('slow')),
      'REMOTE'
    )
    assert.equal(
      await page.evaluate(async () => await Reflect.get(window, 'loadTestChunk')('recover')),
      'ORIGINAL'
    )
    assert.equal(counts.get('recover.min.js'), 2)
    assert.equal(await page.evaluate(() => Reflect.get(window, 'chunkSideEffects')), 5)

    mode = 'source-failure'
    await page.goto(fixtureUrl)
    await page.waitForFunction(() => Reflect.get(window, 'loads').length === 1)
    assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'loads')), [['ORIGINAL']])
    assert.equal(
      await page.evaluate(() => Reflect.get(window, 'originalScriptUrl')),
      'https://www.figma.com/webpack-artifacts/assets/entry.min.js?tempad-fallback=1'
    )
    assert.equal(
      await page.evaluate(async () => await Reflect.get(window, 'loadTestChunk')('a')),
      'REMOTE'
    )

    for (const next of ['offline', 'timeout'] as const) {
      mode = next
      await page.goto(fixtureUrl)
      await page.waitForFunction(() => Reflect.get(window, 'loads').length === 1)
      assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'loads')), [['ORIGINAL']])
      assert.equal(
        await page.evaluate(async () => await Reflect.get(window, 'loadTestChunk')('a')),
        'ORIGINAL'
      )
    }
    assert.equal(counts.get('runtime'), 4)
    console.log(
      'Rewrite runtime: static DNR, native JSONP chunks, deduplication, load ordering, timeout cancellation, retries and offline fallback passed.'
    )
  } finally {
    await context.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
