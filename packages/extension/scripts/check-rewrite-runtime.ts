import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type BrowserContext } from 'playwright'

import bundledRules from '../public/rules/figma.json'
// Frozen remote rules from gh-pages a24331d5c9b86d3ac525b2efb13e9d3004e03844.
import legacyRules from '../tests/fixtures/rewrite-0.23.1-rules.json'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtureUrl = 'https://www.figma.com/design/rewrite-fixture'
const extraTestOrigins = [
  'http://www.figma.com',
  'https://figma.com',
  'https://sub.www.figma.com',
  'https://www.figma.com.example.com',
  'https://example.com',
  'http://127.0.0.1'
]

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
  await verifyRuleScope(context, { csp: true, scripts: true })
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

async function verifyLegacyRules(
  context: BrowserContext,
  rules: { id: number; condition: { regexFilter?: string } }[]
) {
  const worker = await getWorker(context)
  await worker.evaluate(async (expected) => {
    const chrome = Reflect.get(globalThis, 'chrome')
    for (let attempt = 0; attempt < 100; attempt++) {
      const rules = await chrome.declarativeNetRequest.getDynamicRules()
      const enabled = await chrome.declarativeNetRequest.getEnabledRulesets()
      const alarm = await chrome.alarms.get('sync-rules')
      if (
        rules.length === expected.length &&
        rules.find((rule: { id: number }) => rule.id === 1)?.condition.regexFilter ===
          expected.find((rule) => rule.id === 1)?.condition.regexFilter &&
        !enabled.includes('figma') &&
        alarm
      )
        return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(
      `The frozen 0.23.1 worker did not install its downloaded rewrite rules: ${JSON.stringify({
        rules: await chrome.declarativeNetRequest.getDynamicRules(),
        enabled: await chrome.declarativeNetRequest.getEnabledRulesets(),
        fetches: Reflect.get(globalThis, 'workerFetches')
      })}`
    )
  }, rules)
  assert.deepEqual(
    await worker.evaluate(
      async () => await Reflect.get(globalThis, 'chrome').declarativeNetRequest.getDynamicRules()
    ),
    rules
  )
  const fetches: string[] = await worker.evaluate(() => Reflect.get(globalThis, 'workerFetches'))
  assert.ok(fetches.length > 0)
  assert.ok(fetches.every((url) => url === 'https://ecomfe.github.io/tempad-dev/figma.json'))
  assert.deepEqual(
    await worker.evaluate(async () => await Reflect.get(globalThis, 'chrome').storage.local.get()),
    {},
    'The 0.23.1 rewrite code persists DNR rules and an alarm, not a local-storage rules key.'
  )
}

async function verifyLoopbackScript(context: BrowserContext) {
  let scriptRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/webpack-artifacts/assets/probe.min.js') {
      scriptRequests++
      response.setHeader('Content-Type', 'application/javascript')
      response.end('window.originalScriptExecuted = true;')
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        `<script src="/webpack-artifacts/assets/probe.min.js" onload="window.scriptResult='load'" onerror="window.scriptResult='error'"></script>`
      )
    }
  })
  let page: Awaited<ReturnType<BrowserContext['newPage']>> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    page = await context.newPage()
    page.setDefaultTimeout(10000)
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.waitForFunction(() => Reflect.get(window, 'scriptResult'))
    assert.deepEqual(
      await page.evaluate(() => ({
        result: Reflect.get(window, 'scriptResult'),
        executed: Reflect.get(window, 'originalScriptExecuted') === true
      })),
      { result: 'load', executed: true },
      'Loopback permission must not redirect a local application script.'
    )
    assert.equal(scriptRequests, 1)
  } finally {
    try {
      await page?.close()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

async function verifyRuleScope(
  context: BrowserContext,
  scoped: { csp: boolean; scripts: boolean }
) {
  const worker = await getWorker(context)
  // Chrome's unpacked-extension matcher checks real installed DNR rules. A routed
  // Playwright response bypasses header rewriting, so it cannot verify this boundary.
  const paths = [
    '/',
    '/design/fixture',
    '/file/fixture',
    '/board/fixture',
    '/proto/fixture',
    '/slides/fixture',
    '/site/fixture',
    '/make/fixture',
    '/login',
    '/files',
    '/deck/fixture',
    '/buzz/fixture',
    '/future-editor/fixture'
  ]
  const cases = [
    ...paths.map((path) => ({ url: `https://www.figma.com${path}`, matches: true })),
    ...extraTestOrigins.map((origin) => ({ url: `${origin}/legacy-fixture`, matches: false }))
  ]
  for (const { url, matches } of cases) {
    const result = await worker.evaluate(async (url) => {
      const chrome = Reflect.get(globalThis, 'chrome')
      const permitted = await chrome.permissions.contains({
        origins: [`${new URL(url).origin}/*`]
      })
      const result = await chrome.declarativeNetRequest.testMatchOutcome({
        url,
        type: 'main_frame'
      })
      return {
        permitted,
        ruleIds: result.matchedRules.map(({ ruleId }: { ruleId: number }) => ruleId)
      }
    }, url)
    assert.equal(result.permitted, true, `The fixture needs host access to test ${url}.`)
    assert.deepEqual(result.ruleIds, !scoped.csp || matches ? [1] : [], url)
  }
  const scriptMatches = await worker.evaluate(async () => {
    const result = await Reflect.get(globalThis, 'chrome').declarativeNetRequest.testMatchOutcome({
      url: 'https://www.figma.com/webpack-artifacts/assets/entry.min.js',
      type: 'script',
      initiator: 'https://www.figma.com'
    })
    return result.matchedRules.map(({ ruleId }: { ruleId: number }) => ruleId)
  })
  assert.deepEqual(scriptMatches, [2], 'The old script redirect must still match.')
  const scriptCases = [
    ...extraTestOrigins.map((origin) => ({
      url: `${origin}/webpack-artifacts/assets/entry.min.js`,
      initiator: origin
    })),
    {
      url: 'https://www.figma.com/webpack-artifacts/assets/entry.min.js',
      initiator: 'http://127.0.0.1'
    }
  ]
  for (const request of scriptCases) {
    const ruleIds = await worker.evaluate(async (request) => {
      const result = await Reflect.get(globalThis, 'chrome').declarativeNetRequest.testMatchOutcome(
        {
          ...request,
          type: 'script'
        }
      )
      return result.matchedRules.map(({ ruleId }: { ruleId: number }) => ruleId)
    }, request)
    assert.deepEqual(ruleIds, scoped.scripts ? [] : [2], JSON.stringify(request))
  }
}

export async function runCheck() {
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
    // Grant only the isolated test copy extra origins: otherwise Chrome's host
    // permission checks could hide an overly broad CSP rule in negative cases.
    manifest.host_permissions.push(...extraTestOrigins.map((origin) => `${origin}/*`))
    await writeFile(manifestPath, JSON.stringify(manifest))
    context = await launch('clean-profile')
    await verifyRules(context)
    await verifyLoopbackScript(context)
    await verifyScripts(context)
    await context.close()
    context = undefined
    context = await launch('clean-profile')
    await verifyRules(context)
    await verifyScripts(context)
    await context.close()
    context = undefined

    // Reconstruct the released 0.23.1 rewrite path, rather than directly seeding DNR state.
    // The frozen fixture omits unrelated UI/MCP code; it is not a historical store artifact.
    const legacyBackground = await readFile(
      path.join(root, 'tests/fixtures/rewrite-0.23.1-background.js'),
      'utf8'
    )
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        version: '0.23.1',
        permissions: ['declarativeNetRequest', ...manifest.permissions],
        content_scripts: [],
        background: { service_worker: 'old-background.js' }
      })
    )
    // A reviewable remote migration changes only the CSP condition. Old clients still
    // need the remote figma.js URL and the same rule-2 matcher; never copy extensionPath here.
    const cspRule = bundledRules.find(({ id }) => id === 1)
    assert.ok(cspRule)
    const narrowedRules = legacyRules.map((rule) =>
      rule.id === 1 ? { ...rule, condition: cspRule.condition } : rule
    )
    await writeFile(
      path.join(extension, 'old-background.js'),
      `globalThis.workerFetches = [];
      globalThis.remoteRules = ${JSON.stringify(legacyRules)};
      globalThis.fetch = async (url) => {
        globalThis.workerFetches.push(String(url));
        return new Response(JSON.stringify(globalThis.remoteRules));
      };
      ${legacyBackground}`
    )
    context = await launch('upgrade-profile')
    await verifyLegacyRules(context, legacyRules)
    await verifyRuleScope(context, { csp: false, scripts: false })
    const oldWorker = await getWorker(context)
    // The download changes, not the installed extension. Exercise the same refresh
    // function used by its ten-minute alarm without delaying the test ten minutes.
    await oldWorker.evaluate(async (rules) => {
      Reflect.set(globalThis, 'remoteRules', rules)
      await Reflect.get(globalThis, 'syncRules')()
    }, narrowedRules)
    await verifyLegacyRules(context, narrowedRules)
    await verifyRuleScope(context, { csp: true, scripts: false })
    await oldWorker.evaluate(async () => {
      Reflect.set(globalThis, 'fetch', async () => {
        throw new Error('Offline fixture')
      })
      await Reflect.get(globalThis, 'syncRules')()
    })
    await verifyLegacyRules(context, narrowedRules)
    // An unrelated preference must survive the in-place upgrade too.
    await oldWorker.evaluate(async () => {
      await Reflect.get(globalThis, 'chrome').storage.local.set({ unrelated: 'preserve' })
    })
    const extensionId = new URL(oldWorker.url()).host
    await context.close()
    context = undefined
    await rm(path.join(extension, 'old-background.js'))
    await writeFile(manifestPath, JSON.stringify(manifest))
    context = await launch('upgrade-profile')
    await verifyRules(context)
    await verifyScripts(context)
    const upgradedWorker = await getWorker(context)
    assert.equal(new URL(upgradedWorker.url()).host, extensionId)
    assert.deepEqual(
      await upgradedWorker.evaluate(
        async () =>
          await Reflect.get(globalThis, 'chrome').storage.local.get(['rewrite-rules', 'unrelated'])
      ),
      { unrelated: 'preserve' }
    )
    console.log(
      'Local rewrite: packaged rules, offline startup, reconstructed 0.23.1 migration, CSP scope, static scripts, Rspack chunks and fallback passed.'
    )
  } finally {
    try {
      await context?.close()
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCheck().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
