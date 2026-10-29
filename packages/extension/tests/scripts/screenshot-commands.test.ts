import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const extensionRoot = fileURLToPath(new URL('../../', import.meta.url))

it('rejects an incomplete promotion selection before reading candidates or replacing assets', () => {
  const candidates = mkdtempSync(join(tmpdir(), 'tempad-screenshot-selection-'))
  try {
    for (const selection of [['--only'], ['--group', ''], ['--onnly=code']]) {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/promote-screenshots.ts',
          '--yes',
          '--candidate-dir',
          candidates,
          ...selection
        ],
        { cwd: extensionRoot, encoding: 'utf8' }
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(selection[0]!.split('=')[0])
      expect(result.stderr).not.toContain('ENOENT')
    }
  } finally {
    rmSync(candidates, { recursive: true, force: true })
  }
})

it('includes the native canvas label requirement in the visual comparison', () => {
  const candidates = mkdtempSync(join(tmpdir(), 'tempad-screenshot-comparison-'))
  try {
    // Comparison embeds candidate bytes; it does not decode or approve the image.
    writeFileSync(join(candidates, 'measure-light.png'), 'candidate')
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/compare-screenshots.ts',
        '--candidate-dir',
        candidates,
        '--only',
        'measure',
        '--themes',
        'light'
      ],
      { cwd: extensionRoot, encoding: 'utf8' }
    )
    expect(result.status).toBe(0)
    expect(readFileSync(join(candidates, 'comparison.html'), 'utf8')).toContain(
      'Visual review required: confirm the native canvas measurement labels read 20, 20, 20, 20.'
    )
  } finally {
    rmSync(candidates, { recursive: true, force: true })
  }
})
