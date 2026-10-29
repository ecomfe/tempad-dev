import type { Vitest } from 'vitest/node'

import { IstanbulCoverageProvider } from '@vitest/coverage-istanbul/dist/provider.js'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'

import config from '../../../../vitest.config'

const root = fileURLToPath(new URL('../../../../', import.meta.url))

it.each([
  ['packages/shared/src/mcp/canvas.ts', true],
  ['packages/plugins/src/index.ts', true],
  ['packages/shared/src/mcp/responses.ts', false]
] as const)('enforces the workspace coverage policy for %s', async (file, strict) => {
  const provider = new IstanbulCoverageProvider()
  const error = vi.fn()
  provider.initialize({
    version: provider.version,
    config: { root },
    _coverageOptions: config.test!.coverage,
    projects: [],
    logger: { error, warn: vi.fn() }
  } as unknown as Vitest)
  const coverageMap = provider.createCoverageMap()
  const statements = Array.from({ length: 20 }, (_, index) => [
    index,
    { start: { line: index + 1, column: 0 }, end: { line: index + 1, column: 10 } }
  ])
  coverageMap.addFileCoverage({
    path: join(root, file),
    statementMap: Object.fromEntries(statements),
    s: Object.fromEntries(statements.map(([index]) => [index, index === 19 ? 0 : 1])),
    fnMap: {},
    f: {},
    branchMap: {},
    b: {}
  })

  // 95% meets the aggregate baseline but must fail the schema/SDK per-file policy.
  const exitCode = process.exitCode
  try {
    await provider.reportThresholds(coverageMap, false)
    if (strict) {
      expect(error).toHaveBeenCalledWith(expect.stringContaining('threshold (100%)'))
      expect(error).toHaveBeenCalledWith(expect.stringContaining(file))
      expect(process.exitCode).toBe(1)
    } else {
      expect(error).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(exitCode)
    }
  } finally {
    process.exitCode = exitCode
  }
})
