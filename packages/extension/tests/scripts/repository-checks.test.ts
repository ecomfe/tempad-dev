import { ESLint } from 'eslint'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

import { MCP_CORE_COVERAGE_FILES } from '../../../../vitest.coverage'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))

it('covers Hub runtime and client modules while excluding only the two process launchers', () => {
  // Use the coverage engine's matcher and exact threshold glob, not a file-listing library.
  const picomatch: (pattern: string) => (path: string) => boolean = createRequire(
    import.meta.resolve('vitest/package.json')
  )('picomatch')
  const matches = picomatch(`{${MCP_CORE_COVERAGE_FILES.join(',')}}`)
  for (const file of [
    'src/hub-runtime.ts',
    'src/client-binding.ts',
    'src/agent-clients/registry.ts'
  ]) {
    expect(matches(file), file).toBe(true)
  }
  for (const file of ['src/cli.ts', 'src/hub.ts']) expect(matches(file), file).toBe(false)
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

it.each<[subject: string, status: number, commentChar?: string]>([
  ['fix(extension): preserve layout', 0],
  ['fixup! fix(extension): preserve layout', 0],
  ['squash! an old nonconventional subject', 0],
  ['amend! fix(extension): preserve layout', 0],
  ['Merge branch main', 0],
  ['Revert "fix: preserve layout"', 0],
  ['Reapply "fix: preserve layout"', 0],
  ['\n# Editor instructions\n\nfix: preserve layout\n\nBody', 0],
  ['\r\n# Editor instructions\r\nfix: preserve layout\r\n', 0],
  ['\n# Editor instructions\nsome change', 1],
  ['# Only a comment', 1],
  ['fixup! ', 1],
  ['fix: ', 1],
  ['some change', 1],
  ['; Editor instructions\n\nfix: preserve layout', 0, ';']
])('validates cleaned commit message %j', (subject, status, commentChar = '#') => {
  const directory = mkdtempSync(join(tmpdir(), 'tempad-commit-message-'))
  const path = join(directory, 'message')
  try {
    writeFileSync(path, subject + '\n')
    const result = spawnSync(
      process.execPath,
      [join(repository, 'scripts/check-commit-message.mjs'), path],
      {
        cwd: repository,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'core.commentChar',
          GIT_CONFIG_VALUE_0: commentChar
        }
      }
    )
    expect(result.status, result.error?.message ?? result.stderr?.toString()).toBe(status)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
