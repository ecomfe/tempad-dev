import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext } from 'playwright'

import bundledRules from '../public/rules/figma.json'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtureUrl = 'https://www.figma.com/design/rewrite-fixture'

async function getWorker(context: BrowserContext) {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
}

async function verifyRules(context: BrowserContext) {
  const worker = await getWorker(context)
  // onInstalled/onStartup may still be applying the migration when the worker appears.
  await worker.evaluate(async () => {
    const chrome = Reflect.get(globalThis, 'chrome')
    for (let attempt = 0; attempt < 100; attempt++) {
      const rules = await chrome.declarativeNetRequest.getDynamicRules()
      const enabled = await chrome.declarativeNetRequest.getEnabledRulesets()
      const stored = await chrome.storage.local.get('rewrite-rules')
      if (rules.length === 0 && enabled.includes('figma') && stored['rewrite-rules'] === undefined)
        return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(
      `Bundled rewrite rules were not activated: ${JSON.stringify({
        version: chrome.runtime.getManifest().version,
        background: chrome.runtime.getManifest().background,
        rules: await chrome.declarativeNetRequest.getDynamicRules(),
        enabled: await chrome.declarativeNetRequest.getEnabledRulesets()
      })}`
    )
  })
  assert.equal(
    await worker.evaluate(
      async () => await Reflect.get(globalThis, 'chrome').alarms.get('sync-rules')
    ),
    undefined,
    'The persisted rewrite update alarm must be removed.'
  )
  assert.deepEqual(await worker.evaluate(() => Reflect.get(globalThis, 'workerFetches')), [])
}

async function verifyScripts(context: BrowserContext) {
  const base = '/webpack-artifacts/assets'
  const entryUrl = `https://www.figma.com${base}/entry.min.js`
  const rspack = await readFile(path.join(root, 'tests/fixtures/rewrite-rspack.js'), 'utf8')
  const counts = new Map<string, number>()
  const unexpected: string[] = []
  let failEntry = false
  context.on('request', (request) => {
    if (request.url().startsWith('http') && !request.url().startsWith('https://www.figma.com/')) {
      unexpected.push(request.url())
    }
  })
  await context.route('https://www.figma.com/**', async (route) => {
    const url = new URL(route.request().url())
    const file = url.pathname.split('/').pop()!
    if (file === 'rewrite-fixture') {
      return await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><script defer src="${base}/entry.min.js"></script>`
      })
    }
    counts.set(file, (counts.get(file) ?? 0) + 1)
    if (file === 'image_decoder.min.js') {
      return await route.fulfill({
        contentType: 'application/javascript',
        body: 'self.postMessage({ready:true,src:self.location.href});'
      })
    }
    if (file === 'image_loader.min.js') {
      return await route.fulfill({
        contentType: 'application/javascript',
        body: 'var nativeImageHelper = {src:document.currentScript.src};'
      })
    }
    if (file === 'entry.min.js') {
      if (failEntry && !url.searchParams.has('fallback')) return await route.abort()
      return await route.fulfill({
        contentType: 'application/javascript',
        body: `window.chunkBase = ${JSON.stringify(base)};${rspack}
          window.testModel = {appModel:{isReadOnly:true,__isReadOnly__:false}};
          window.staticRewrite = {readOnly:testModel.appModel.isReadOnly,src:document.currentScript.src};
          window.figma = {fixture:true}; delete window.figma;`
      })
    }
    const id = file.replace('.min.js', '')
    if (id === 'network-error') return await route.abort()
    return await route.fulfill({
      contentType: 'application/javascript',
      body:
        id === 'missing'
          ? 'window.missingChunkExecuted = true;'
          : `var nativeChunkGlobal = "native";
           window.webpackChunk_figma_web_bundler.push([[${JSON.stringify(id)}], {
             ${JSON.stringify(id)}: () => testModel.appModel.isReadOnly
           }]);`
    })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  await page.goto(fixtureUrl)
  await page.waitForFunction(() => Reflect.get(window, 'staticRewrite'))
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'staticRewrite')), {
    readOnly: false,
    src: entryUrl
  })
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'figma')), { fixture: true })
  // Dedicated Worker requests are classified as scripts by Chromium too. They
  // must never be redirected to the extension's document-only rewrite bootstrap.
  assert.deepEqual(
    await page.evaluate(async (src) => {
      const worker = new Worker(src)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await new Promise((resolve) => {
          timer = setTimeout(() => resolve({ error: 'Worker startup timed out' }), 3000)
          worker.onmessage = (event) => resolve(event.data)
          worker.onerror = (event) => resolve({ error: event.message || 'Worker startup failed' })
        })
      } finally {
        clearTimeout(timer)
        worker.terminate()
      }
    }, `${base}/image_decoder.min.js`),
    { ready: true, src: `https://www.figma.com${base}/image_decoder.min.js` }
  )
  // Unmatched resource helpers retain native global declarations and their source
  // URL; replacing even unchanged code with a Blob can break relative asset URLs.
  assert.deepEqual(
    await page.evaluate(
      async (src) =>
        await new Promise((resolve, reject) => {
          const script = document.createElement('script')
          const timer = setTimeout(() => reject(new Error('Image helper startup timed out')), 3000)
          script.onload = () => {
            clearTimeout(timer)
            resolve(Reflect.get(window, 'nativeImageHelper'))
          }
          script.onerror = () => {
            clearTimeout(timer)
            reject(new Error('Image helper startup failed'))
          }
          script.src = src
          document.head.appendChild(script)
        }),
      `${base}/image_loader.min.js`
    ),
    { src: `https://www.figma.com${base}/image_loader.min.js` }
  )
  assert.deepEqual(
    await page.evaluate(async () => {
      const load = Reflect.get(window, 'loadTestChunk')
      return await Promise.all([load('a'), load('a'), load('b', true)])
    }),
    [false, false, false]
  )
  assert.equal(counts.get('a.min.js'), 1)
  assert.equal(counts.get('b.min.js'), 1)
  assert.equal(await page.evaluate(() => Reflect.get(window, 'nativeChunkGlobal')), 'native')
  assert.deepEqual(
    await page.evaluate(async () => {
      const load = Reflect.get(window, 'loadTestChunk')
      return await Promise.all(
        ['missing', 'network-error'].map(async (id) => {
          try {
            await load(id)
            return 'unexpected success'
          } catch (error) {
            return (error as Error).name
          }
        })
      )
    }),
    ['ChunkLoadError', 'ChunkLoadError']
  )

  failEntry = true
  await page.goto(fixtureUrl)
  await page.waitForFunction(() => Reflect.get(window, 'staticRewrite'))
  assert.deepEqual(await page.evaluate(() => Reflect.get(window, 'staticRewrite')), {
    readOnly: true,
    src: `${entryUrl}?fallback`
  })
  assert.equal(
    await page.evaluate(async () => await Reflect.get(window, 'loadTestChunk')('a')),
    false
  )
  assert.deepEqual(unexpected, [], 'Rewriting must not contact a remote update service.')
  await page.close()
  await verifyRules(context)
}

async function main() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'tempad-local-rewrite-'))
  const extension = path.join(temporary, 'extension')
  const output = path.join(root, '.output/chrome-mv3')
  const launch = (profile: string) =>
    chromium.launchPersistentContext(path.join(temporary, profile), {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    })
  let context: BrowserContext | undefined
  try {
    await cp(output, extension, { recursive: true })
    const manifestPath = path.join(extension, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.deepEqual(manifest.permissions, [
      'declarativeNetRequestWithHostAccess',
      'alarms',
      'storage'
    ])
    assert.deepEqual(manifest.declarative_net_request.rule_resources, [
      { id: 'figma', enabled: true, path: 'rules/figma.json' }
    ])
    assert.deepEqual(await readdir(path.join(extension, 'rules')), ['figma.json'])
    const packagedRules = JSON.parse(
      await readFile(path.join(extension, 'rules/figma.json'), 'utf8')
    )
    assert.deepEqual(packagedRules, bundledRules)
    assert.deepEqual(packagedRules[1]!.action.redirect, { extensionPath: '/figma.js' })
    assert.ok(
      !(await readdir(path.join(extension, 'content-scripts'))).includes('rewrite-rules.js')
    )
    for (const file of ['background.js', 'figma.js', 'content-scripts/rewrite.js']) {
      const source = await readFile(path.join(extension, file), 'utf8')
      assert.doesNotMatch(
        source,
        /ecomfe\.github\.io|figma-runtime|figma\.comply|tempad:rewrite-rules|alarms\.(?:create|onAlarm)/
      )
    }
    // Keep the actual worker and Chrome APIs, but fail any attempted background download.
    const backgroundPath = path.join(extension, 'background.js')
    const background = await readFile(backgroundPath, 'utf8')
    await writeFile(
      backgroundPath,
      `
      globalThis.workerFetches = [];
      globalThis.fetch = async (url) => {
        globalThis.workerFetches.push(String(url));
        throw new Error('Offline fixture');
      };
      ${background}`
    )
    // Keep the built worker, rules and rewrite entrypoints; isolate the probe from UI/MCP pages.
    manifest.content_scripts = manifest.content_scripts.filter((entry: { js: string[] }) =>
      entry.js.some((file) => file.includes('rewrite'))
    )
    await writeFile(manifestPath, JSON.stringify(manifest))
    context = await launch('clean-profile')
    await verifyRules(context)
    await verifyScripts(context)
    await context.close()
    context = undefined
    context = await launch('clean-profile')
    await verifyRules(context)
    await verifyScripts(context)
    await context.close()
    context = undefined

    // Seed the state written by previous releases, then upgrade the same extension/profile.
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        version: '0.0.0',
        background: { service_worker: 'old-background.js' }
      })
    )
    await writeFile(
      path.join(extension, 'old-background.js'),
      `
      globalThis.seedReady = (async () => {
        await chrome.declarativeNetRequest.updateDynamicRules({addRules:[{
          id:2,priority:1,action:{type:'redirect',redirect:{url:'https://rewrite.invalid/figma.js'}},
          condition:{regexFilter:'/webpack-artifacts/assets/.*',resourceTypes:['script']}
        }]});
        await chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds:['figma']});
        await chrome.alarms.create('sync-rules',{periodInMinutes:10});
        await chrome.storage.local.set({'rewrite-rules':[{id:2}],unrelated:'preserve'});
      })();`
    )
    context = await launch('upgrade-profile')
    const oldWorker = await getWorker(context)
    await oldWorker.evaluate(() => Reflect.get(globalThis, 'seedReady'))
    assert.equal(
      await oldWorker.evaluate(
        async () =>
          (await Reflect.get(globalThis, 'chrome').declarativeNetRequest.getDynamicRules()).length
      ),
      1
    )
    await context.close()
    context = undefined
    await rm(path.join(extension, 'old-background.js'))
    await writeFile(manifestPath, JSON.stringify(manifest))
    context = await launch('upgrade-profile')
    await verifyRules(context)
    await verifyScripts(context)
    const upgradedWorker = await getWorker(context)
    assert.deepEqual(
      await upgradedWorker.evaluate(
        async () =>
          await Reflect.get(globalThis, 'chrome').storage.local.get(['rewrite-rules', 'unrelated'])
      ),
      { unrelated: 'preserve' }
    )
    console.log(
      'Local rewrite: packaged rules, offline startup, upgrade cleanup, static scripts, Rspack chunks and fallback passed.'
    )
  } finally {
    await context?.close()
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
