import { ESLint } from 'eslint'
import { globby } from 'globby'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

import { MCP_CORE_COVERAGE_FILES } from '../../../../vitest.coverage'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))

it('covers Hub runtime and client modules while excluding only the two process launchers', async () => {
  const files = await globby([...MCP_CORE_COVERAGE_FILES], {
    cwd: join(repository, 'packages/mcp-server')
  })
  expect(files).toEqual(
    expect.arrayContaining([
      'src/hub-runtime.ts',
      'src/client-binding.ts',
      'src/agent-clients/registry.ts'
    ])
  )
  expect(files).not.toContain('src/cli.ts')
  expect(files).not.toContain('src/hub.ts')
})

it('enables typed promise checks in every package inheriting the root ESLint config', async () => {
  const eslint = new ESLint({ cwd: repository })
  for (const path of [
    'packages/mcp-server/src/design-tasks.ts',
    'packages/shared/src/index.ts',
    'packages/plugins/src/index.ts'
  ]) {
    const config = await eslint.calculateConfigForFile(path)
    expect(config.rules['@typescript-eslint/no-floating-promises']?.[0], path).toBe(2)
    expect(config.rules['@typescript-eslint/no-misused-promises']?.[0], path).toBe(2)
    expect(config.languageOptions.parserOptions.projectService, path).toBe(true)
  }
})

it('accepts Git autosquash subjects without weakening ordinary commit validation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tempad-commit-message-'))
  const path = join(directory, 'message')
  try {
    for (const [subject, status] of [
      ['fix(extension): preserve layout', 0],
      ['fixup! fix(extension): preserve layout', 0],
      ['squash! an old nonconventional subject', 0],
      ['amend! fix(extension): preserve layout', 0],
      ['Merge branch main', 0],
      ['Revert "fix: preserve layout"', 0],
      ['fixup! ', 1],
      ['fix: ', 1],
      ['some change', 1]
    ] as const) {
      writeFileSync(path, subject + '\n')
      const result = spawnSync(process.execPath, [
        join(repository, 'scripts/check-commit-message.mjs'),
        path
      ])
      expect(result.status, subject).toBe(status)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
