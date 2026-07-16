import { bundleSandboxWorker } from '../build/plugin-sandbox-workers'

type WorkerCheck = {
  entry: string
  allowedInputs: RegExp[]
}

const CODEGEN_WORKER_DEPENDENCIES = [
  'es-module-lexer',
  'function-timeout',
  'get-own-enumerable-keys',
  'identifier-regex',
  'is-identifier',
  'is-obj',
  'is-regexp',
  'quote-js-string',
  'reserved-identifiers',
  'stringify-object',
  'super-regex',
  'time-span'
]

const CHECKS: WorkerCheck[] = [
  {
    entry: 'codegen/worker.ts',
    allowedInputs: [
      /^codegen\/worker\.ts$/,
      /^worker\//,
      /^utils\//,
      /^\.\.\/plugins\/dist\//,
      ...CODEGEN_WORKER_DEPENDENCIES.map(createPnpmDependencyPattern)
    ]
  },
  {
    entry: 'mcp/transform-variables/worker.ts',
    allowedInputs: [
      /^mcp\/transform-variables\/worker\.ts$/,
      /^worker\//,
      /^utils\//,
      createPnpmDependencyPattern('es-module-lexer')
    ]
  }
]

function createPnpmDependencyPattern(packageName: string): RegExp {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `^\\.\\.\\/\\.\\.\\/node_modules\\/\\.pnpm\\/${escapedName}@[^/]+\\/node_modules\\/${escapedName}(?:\\/|$)`
  )
}

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
        pluginCode: 'export default { name: "worker-probe", code: {} }',
        style: {},
        options: { useRem: false, rootFontSize: 16, scale: 1 }
      }
    }
  }

  if (entry === 'mcp/transform-variables/worker.ts') {
    return {
      id: 1,
      payload: {
        pluginCode: 'export default { name: "worker-probe", code: {} }',
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
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.codeBlocks) ||
      payload.pluginName !== 'worker-probe'
    ) {
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
  const { code, inputs } = await bundleSandboxWorker(entry)
  const disallowed = inputs.filter((input) => !isAllowedInput(input, allowedInputs))
  if (disallowed.length > 0) {
    throw new Error(
      [
        `[worker-check] Unexpected dependency in ${entry}:`,
        ...disallowed.map((item) => `  - ${item}`),
        '[worker-check] Update the allowlist only after reviewing the Worker trust boundary.'
      ].join('\n')
    )
  }

  return { entry, code }
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
  const { chromium } = await import('playwright')
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
  const bundles = await Promise.all(CHECKS.map(checkWorker))

  await runBrowserChecks(bundles)
  console.log('[worker-check] Browser worker probes passed.')

  console.log('[worker-check] All worker dependency chains match the reviewed allowlist.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
