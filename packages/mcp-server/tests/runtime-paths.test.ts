import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  prepareDefaultRoot,
  resolveDefaultRoot
} from '../../../agent-plugin/src/clients/shared/runtime-paths.mjs'

let directory: string
let legacy: string
let isolated: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tempad-paths-'))
  legacy = join(directory, 'tempad-dev')
  isolated = join(directory, `tempad-dev-${process.getuid?.()}`)
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

function hubFiles(root: string) {
  mkdirSync(join(root, 'run', 'hub.lock.lock'), { recursive: true, mode: 0o700 })
}

describe.skipIf(process.platform === 'win32')('shared Linux runtime discovery', () => {
  it('predicts a missing legacy root without writing, then claims it with private permissions', () => {
    expect(resolveDefaultRoot(directory, 'linux')).toBe(legacy)
    expect(existsSync(legacy)).toBe(false)
    expect(prepareDefaultRoot(directory, 'linux')).toBe(legacy)
    expect(lstatSync(legacy).mode & 0o777).toBe(0o700)
    expect(prepareDefaultRoot(directory, 'linux')).toBe(legacy)
  })

  it('reuses the running legacy Hub even with an empty isolated directory', () => {
    hubFiles(legacy)
    mkdirSync(isolated, { mode: 0o700 })
    expect(resolveDefaultRoot(directory, 'linux')).toBe(legacy)
    expect(prepareDefaultRoot(directory, 'linux')).toBe(legacy)
  })

  it('keeps an isolated root when the legacy root disappears or another empty private root appears', () => {
    hubFiles(isolated)
    expect(prepareDefaultRoot(directory, 'linux')).toBe(isolated)
    expect(existsSync(legacy)).toBe(false)
    mkdirSync(legacy, { mode: 0o700 })
    expect(resolveDefaultRoot(directory, 'linux')).toBe(isolated)
    rmSync(legacy, { recursive: true })
    expect(resolveDefaultRoot(directory, 'linux')).toBe(isolated)
  })

  it('isolates unsafe or other-user roots without changing their permissions', () => {
    mkdirSync(legacy, { mode: 0o755 })
    expect(prepareDefaultRoot(directory, 'linux')).toBe(isolated)
    expect(lstatSync(legacy).mode & 0o777).toBe(0o755)
    chmodSync(legacy, 0o700)
    const otherUid = process.getuid!() + 1
    expect(resolveDefaultRoot(directory, 'linux', otherUid)).toBe(
      join(directory, `tempad-dev-${otherUid}`)
    )
    rmSync(legacy, { recursive: true })
    symlinkSync(directory, legacy)
    expect(resolveDefaultRoot(directory, 'linux')).toBe(isolated)
  })

  it('refuses two roots with Hub traces rather than choosing a second state owner', () => {
    hubFiles(legacy)
    mkdirSync(join(isolated, 'run'), { recursive: true, mode: 0o700 })
    writeFileSync(join(isolated, 'run', 'mcp.sock'), '')
    expect(() => resolveDefaultRoot(directory, 'linux')).toThrow('automatic migration is refused')
    expect(() => prepareDefaultRoot(directory, 'linux')).toThrow('automatic migration is refused')
  })

  it.each(['legacy', 'isolated'])(
    'refuses a current-user %s root with unsafe permissions and Hub traces',
    (name) => {
      const root = name === 'legacy' ? legacy : isolated
      hubFiles(root)
      chmodSync(root, 0o755)
      expect(() => prepareDefaultRoot(directory, 'linux')).toThrow('unsafe Hub runtime roots')
      expect(lstatSync(root).mode & 0o777).toBe(0o755)
    }
  )

  it('preserves other-platform paths without inspecting or creating directories', () => {
    expect(prepareDefaultRoot(directory, 'darwin')).toBe(legacy)
    expect(prepareDefaultRoot(directory, 'win32')).toBe(legacy)
    expect(existsSync(legacy)).toBe(false)
  })
})
