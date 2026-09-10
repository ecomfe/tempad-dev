import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  computeExtensionRuntimeFingerprint,
  listExtensionRuntimeSources
} from '../../../../scripts/extension-runtime-fingerprint.mjs'

const files = vi.hoisted(() => new Map<string, string>())

vi.mock('node:fs', () => ({
  statSync: (path: string, options?: { throwIfNoEntry?: boolean }) => {
    const directory = [...files.keys()].some((file) => file.startsWith(`${path}/`))
    if (files.has(path) || directory) return { isDirectory: () => directory }
    if (options?.throwIfNoEntry === false) return undefined
    throw new Error(`ENOENT: ${path}`)
  },
  readdirSync: (path: string) => {
    const names = new Set(
      [...files.keys()]
        .filter((file) => file.startsWith(`${path}/`))
        .map((file) => file.slice(path.length + 1).split('/')[0]!)
    )
    return [...names].map((name) => ({
      name,
      isDirectory: () => !files.has(`${path}/${name}`),
      isFile: () => files.has(`${path}/${name}`)
    }))
  },
  readFileSync: (path: string) => files.get(path)!
}))

describe('extension runtime fingerprint', () => {
  afterEach(() => files.clear())

  it('works in a clean checkout without untracked empty directories', () => {
    files.set('/repo/packages/extension/package.json', '{}')
    expect(listExtensionRuntimeSources('/repo')).toEqual(['/repo/packages/extension/package.json'])
    const clean = computeExtensionRuntimeFingerprint('/repo')
    files.set('/repo/packages/extension/assets/.DS_Store', 'local Finder metadata')
    expect(computeExtensionRuntimeFingerprint('/repo')).toBe(clean)
  })

  it('detects added, edited, and removed nested runtime assets', () => {
    files.set('/repo/packages/extension/package.json', '{}')
    const clean = computeExtensionRuntimeFingerprint('/repo')
    files.set('/repo/packages/extension/assets/icons/logo.svg', '<svg/>')
    const added = computeExtensionRuntimeFingerprint('/repo')
    expect(added).not.toBe(clean)
    files.set('/repo/packages/extension/assets/icons/logo.svg', '<svg>updated</svg>')
    expect(computeExtensionRuntimeFingerprint('/repo')).not.toBe(added)
    files.delete('/repo/packages/extension/assets/icons/logo.svg')
    expect(computeExtensionRuntimeFingerprint('/repo')).toBe(clean)
  })
})
