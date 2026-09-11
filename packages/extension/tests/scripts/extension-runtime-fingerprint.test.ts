import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  computeExtensionRuntimeFingerprint,
  listExtensionRuntimeSources
} from '../../../../scripts/extension-runtime-fingerprint.mjs'

let root: string

function write(path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function sources(): string[] {
  return listExtensionRuntimeSources(root).map((path) => relative(root, path).replaceAll('\\', '/'))
}

describe('extension runtime fingerprint', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tempad-fingerprint-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('works in a clean checkout without untracked empty directories', () => {
    write('packages/extension/package.json', '{}')
    expect(sources()).toEqual(['packages/extension/package.json'])
  })

  it('uses repository ignore rules for metadata, logs, directories, and exceptions', () => {
    write('.gitignore', '.DS_Store\n*.log\ncache/\n!retained.log\n/root-only.svg\n')
    write('packages/extension/package.json', '{}')
    const clean = computeExtensionRuntimeFingerprint(root)
    write('packages/extension/assets/.DS_Store', 'local Finder metadata')
    write('packages/extension/mcp/debug.log', 'local log')
    write('packages/extension/assets/cache/generated.svg', '<svg/>')
    expect(computeExtensionRuntimeFingerprint(root)).toBe(clean)

    write('packages/extension/mcp/retained.log', 'explicitly included')
    write('packages/extension/assets/root-only.svg', '<svg/>')
    write('packages/site/src/unrelated.ts', 'outside extension runtime')
    expect(sources()).toEqual([
      'packages/extension/assets/root-only.svg',
      'packages/extension/mcp/retained.log',
      'packages/extension/package.json'
    ])
  })

  it('applies nested ignore files relative to their directory and honors overrides', () => {
    write('.gitignore', '*.svg\n')
    write('packages/.gitignore', '!shared.svg\n')
    write('packages/extension/.gitignore', '/assets/private/\n')
    write('packages/extension/assets/.gitignore', '!logo.svg\n')
    write('packages/extension/assets/logo.svg', '<svg/>')
    write('packages/extension/assets/hidden.svg', '<svg/>')
    write('packages/extension/assets/private/.gitignore', '!secret.svg\n')
    write('packages/extension/assets/private/secret.svg', '<svg/>')
    write('packages/extension/public/logo.svg', '<svg/>')
    write('packages/extension/public/shared.svg', '<svg/>')
    expect(sources()).toEqual([
      'packages/extension/assets/.gitignore',
      'packages/extension/assets/logo.svg',
      'packages/extension/public/shared.svg'
    ])
  })

  it('detects added, edited, and removed nested runtime assets', () => {
    write('packages/extension/package.json', '{}')
    const clean = computeExtensionRuntimeFingerprint(root)
    write('packages/extension/assets/icons/logo.svg', '<svg/>')
    const added = computeExtensionRuntimeFingerprint(root)
    expect(added).not.toBe(clean)
    write('packages/extension/assets/icons/logo.svg', '<svg>updated</svg>')
    expect(computeExtensionRuntimeFingerprint(root)).not.toBe(added)
    unlinkSync(join(root, 'packages/extension/assets/icons/logo.svg'))
    expect(computeExtensionRuntimeFingerprint(root)).toBe(clean)
  })
})
