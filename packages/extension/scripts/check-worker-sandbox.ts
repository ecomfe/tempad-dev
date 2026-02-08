import { build } from 'esbuild'

type WorkerCheck = {
  entry: string
  allowedInputs: RegExp[]
}

const CHECKS: WorkerCheck[] = [
  {
    entry: 'codegen/worker.ts',
    allowedInputs: [
      /^codegen\/worker\.ts$/,
      /^worker\//,
      /^utils\//,
      /^\.\.\/plugins\/dist\//,
      /^\.\.\/\.\.\/node_modules\//
    ]
  },
  {
    entry: 'mcp/transform-variables/worker.ts',
    allowedInputs: [
      /^mcp\/transform-variables\/worker\.ts$/,
      /^worker\//,
      /^utils\//,
      /^\.\.\/\.\.\/node_modules\//
    ]
  }
]

function isAllowedInput(input: string, allowedInputs: RegExp[]): boolean {
  return allowedInputs.some((pattern) => pattern.test(input))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function getProbeRequest(entry: string): unknown {
  if (entry === 'codegen/worker.ts') {
    return {
      id: 1,
      payload: {
        style: {},
        options: { useRem: false, rootFontSize: 16, scale: 1 }
      }
    }
  }

  if (entry === 'mcp/transform-variables/worker.ts') {
    return {
      id: 1,
      payload: {
        references: [],
        options: { useRem: false, rootFontSize: 16, scale: 1 }
      }
    }
  }

  throw new Error(`[worker-check] Missing probe request for ${entry}`)
}

function assertProbeResponse(entry: string, response: unknown): void {
  if (!isRecord(response)) {
    throw new Error(`[worker-check] ${entry} probe returned a non-object response.`)
  }

  if (response.id !== 1) {
    throw new Error(`[worker-check] ${entry} probe returned unexpected id: ${String(response.id)}`)
  }

  if (entry === 'codegen/worker.ts') {
    const payload = response.payload
    if (!isRecord(payload) || !Array.isArray(payload.codeBlocks)) {
      throw new Error('[worker-check] codegen worker probe response shape is invalid.')
    }
    return
  }

  if (entry === 'mcp/transform-variables/worker.ts') {
    const payload = response.payload
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error('[worker-check] transform-variable worker probe response shape is invalid.')
    }
    return
  }
}

async function checkWorker(check: WorkerCheck): Promise<{ entry: string; code: string }> {
  const { entry, allowedInputs } = check
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'iife',
    logLevel: 'silent'
  })

  const output = result.outputFiles[0]
  if (!output) {
    throw new Error(`[worker-check] No output for ${entry}`)
  }

  const inputs = Object.keys(result.metafile.inputs)
  const disallowed = inputs.filter((input) => !isAllowedInput(input, allowedInputs))
  if (disallowed.length > 0) {
    throw new Error(
      [
        `[worker-check] Unexpected dependency in ${entry}:`,
        ...disallowed.map((item) => `  - ${item}`),
        '[worker-check] Update allowlist only after confirming the module chain is sandbox-safe.'
      ].join('\n')
    )
  }

  return { entry, code: output.text }
}

async function runBrowserCheck(
  page: {
    evaluate: <Arg, Result>(
      pageFunction: (arg: Arg) => Result | Promise<Result>,
      arg: Arg
    ) => Promise<Result>
  },
  bundle: { entry: string; code: string }
): Promise<void> {
  const response = await page.evaluate(
    ({ code, request }) =>
      new Promise((resolve, reject) => {
        const blob = new Blob([code], { type: 'text/javascript' })
        const url = URL.createObjectURL(blob)
        const worker = new Worker(url)
        const timer = setTimeout(() => {
          worker.terminate()
          URL.revokeObjectURL(url)
          reject(new Error('Probe timeout'))
        }, 2000)

        worker.onmessage = (event) => {
          clearTimeout(timer)
          worker.terminate()
          URL.revokeObjectURL(url)
          resolve(event.data)
        }

        worker.onmessageerror = () => {
          clearTimeout(timer)
          worker.terminate()
          URL.revokeObjectURL(url)
          reject(new Error('Probe messageerror'))
        }

        worker.onerror = (event) => {
          clearTimeout(timer)
          worker.terminate()
          URL.revokeObjectURL(url)
          reject(new Error(`Probe error: ${event.message}`))
        }

        worker.postMessage(request)
      }),
    { code: bundle.code, request: getProbeRequest(bundle.entry) }
  )

  assertProbeResponse(bundle.entry, response)
}

async function runBrowserChecks(bundles: { entry: string; code: string }[]): Promise<void> {
  const { chromium } = await import('playwright-chromium')
  const browser = await chromium.launch()

  try {
    const page = await browser.newPage()

    for (const bundle of bundles) {
      await runBrowserCheck(page, bundle)
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  const bundles: { entry: string; code: string }[] = []

  for (const check of CHECKS) {
    bundles.push(await checkWorker(check))
  }

  await runBrowserChecks(bundles)
  console.log('[worker-check] Browser worker probes passed.')

  console.log('[worker-check] All worker dependency chains are sandbox-safe.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
