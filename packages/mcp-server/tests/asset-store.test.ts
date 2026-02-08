import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAssetStore } from '../src/asset-store'
import { getHashFromAssetFilename } from '../src/asset-utils'
import { ASSET_DIR, ensureDir, ensureFile, log } from '../src/shared'

type StatLike = {
  size: number
  birthtimeMs: number
  atimeMs: number
  mtimeMs: number
}

const { fsState, hashByFilename } = vi.hoisted(() => ({
  fsState: {
    existing: new Set<string>(),
    contentByPath: new Map<string, string>(),
    dirEntries: [] as string[],
    statByPath: new Map<string, StatLike>(),
    readErrorByPath: new Map<string, Error>(),
    rmErrorByPath: new Map<string, Error>(),
    statErrorByPath: new Map<string, Error>(),
    readdirError: null as Error | null
  },
  hashByFilename: new Map<string, string | null>()
}))

function errnoError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code })
}

function resetFsState() {
  fsState.existing.clear()
  fsState.contentByPath.clear()
  fsState.dirEntries = []
  fsState.statByPath.clear()
  fsState.readErrorByPath.clear()
  fsState.rmErrorByPath.clear()
  fsState.statErrorByPath.clear()
  fsState.readdirError = null
  hashByFilename.clear()
}

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => fsState.existing.has(path)),
  readFileSync: vi.fn((path: string) => {
    const error = fsState.readErrorByPath.get(path)
    if (error) throw error
    if (!fsState.existing.has(path)) throw errnoError('ENOENT', `Missing file: ${path}`)
    return fsState.contentByPath.get(path) ?? ''
  }),
  rmSync: vi.fn((path: string) => {
    const error = fsState.rmErrorByPath.get(path)
    if (error) throw error
    fsState.existing.delete(path)
    fsState.statByPath.delete(path)
  }),
  writeFileSync: vi.fn((path: string, content: string) => {
    fsState.existing.add(path)
    fsState.contentByPath.set(path, content)
  }),
  readdirSync: vi.fn((path: string) => {
    if (fsState.readdirError) throw fsState.readdirError
    if (path !== ASSET_DIR) return []
    return [...fsState.dirEntries]
  }),
  statSync: vi.fn((path: string) => {
    const error = fsState.statErrorByPath.get(path)
    if (error) throw error
    const stat = fsState.statByPath.get(path)
    if (!stat) throw errnoError('ENOENT', `Missing stat: ${path}`)
    return stat
  })
}))

vi.mock('../src/shared', () => ({
  ASSET_DIR: '/mock/assets',
  ensureDir: vi.fn(),
  ensureFile: vi.fn(),
  log: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('../src/asset-utils', () => ({
  getHashFromAssetFilename: vi.fn((filename: string) => hashByFilename.get(filename) ?? null)
}))

beforeEach(() => {
  resetFsState()
  vi.clearAllMocks()
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('asset-store', () => {
  it('creates empty store when index does not exist', () => {
    const indexPath = '/mock/custom-index.json'
    fsState.dirEntries = ['assets.json']

    const store = createAssetStore({ indexPath })

    expect(ensureDir).toHaveBeenCalledWith(ASSET_DIR)
    expect(ensureFile).toHaveBeenCalledWith(indexPath)
    expect(store.list()).toEqual([])
    expect(store.get('missing')).toBeUndefined()
    expect(readFileSync).not.toHaveBeenCalled()
  })

  it('uses default index path when options are not provided', () => {
    fsState.dirEntries = ['assets.json']

    const store = createAssetStore()

    expect(store.list()).toEqual([])
    expect(ensureFile).toHaveBeenCalledWith(join(ASSET_DIR, 'assets.json'))
  })

  it('handles invalid/empty index payloads and scan failures gracefully', () => {
    const badIndexPath = '/mock/bad-index.json'
    fsState.existing.add(badIndexPath)
    fsState.contentByPath.set(badIndexPath, '{bad json')
    fsState.readdirError = new Error('scan failed')

    const badStore = createAssetStore({ indexPath: badIndexPath })
    expect(badStore.list()).toEqual([])
    expect(log.warn).toHaveBeenCalledWith(
      { error: expect.any(Error), indexPath: badIndexPath },
      'Failed to read asset catalog; starting fresh.'
    )
    expect(log.warn).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Failed to scan asset directory for orphans.'
    )

    const emptyIndexPath = '/mock/empty-index.json'
    fsState.existing.add(emptyIndexPath)
    fsState.contentByPath.set(emptyIndexPath, '  ')
    fsState.readdirError = null

    const emptyStore = createAssetStore({ indexPath: emptyIndexPath })
    expect(emptyStore.list()).toEqual([])

    const nonArrayIndexPath = '/mock/non-array-index.json'
    fsState.existing.add(nonArrayIndexPath)
    fsState.contentByPath.set(nonArrayIndexPath, '{}')

    const nonArrayStore = createAssetStore({ indexPath: nonArrayIndexPath })
    expect(nonArrayStore.list()).toEqual([])
  })

  it('supports upsert/get/touch/remove/persist/flush flows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))

    const indexPath = '/mock/store-index.json'
    fsState.existing.add(indexPath)
    fsState.contentByPath.set(indexPath, '[]')

    const store = createAssetStore({ indexPath })

    const first = store.upsert({
      hash: 'a1',
      filePath: '/mock/assets/a1.png',
      mimeType: 'image/png',
      size: 10
    })
    store.upsert({
      hash: 'b2',
      filePath: '/mock/assets/b2.png',
      mimeType: 'image/png',
      size: 20,
      uploadedAt: 100,
      lastAccess: 200
    })

    expect(first.uploadedAt).toBe(first.lastAccess)
    expect(store.has('a1')).toBe(true)
    expect(store.get('b2')?.uploadedAt).toBe(100)
    expect(store.getMany(['missing', 'a1', 'b2']).map((item) => item.hash)).toEqual(['a1', 'b2'])
    expect(writeFileSync).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5000)
    expect(writeFileSync).toHaveBeenCalledTimes(1)

    expect(store.touch('missing')).toBeUndefined()
    vi.setSystemTime(new Date('2024-01-01T00:01:00.000Z'))
    const touched = store.touch('a1')
    expect(touched?.lastAccess).toBe(new Date('2024-01-01T00:01:00.000Z').valueOf())

    store.remove('missing')
    store.remove('a1', { removeFile: false })
    expect(rmSync).not.toHaveBeenCalled()

    store.flush()
    expect(writeFileSync).toHaveBeenCalled()
  })

  it('logs warning when removing file fails', () => {
    const indexPath = '/mock/remove-index.json'
    fsState.existing.add(indexPath)
    fsState.contentByPath.set(
      indexPath,
      JSON.stringify([
        {
          hash: 'x1',
          filePath: '/mock/assets/x1.png',
          mimeType: 'image/png',
          size: 1,
          uploadedAt: 1,
          lastAccess: 1
        }
      ])
    )
    fsState.existing.add('/mock/assets/x1.png')
    fsState.rmErrorByPath.set('/mock/assets/x1.png', new Error('permission denied'))

    const store = createAssetStore({ indexPath })
    store.remove('x1')

    expect(log.warn).toHaveBeenCalledWith(
      { hash: 'x1', error: expect.any(Error) },
      'Failed to remove asset file on delete.'
    )
  })

  it('reconciles stale records, temp files, and orphan files', () => {
    const indexPath = '/mock/reconcile-index.json'
    fsState.existing.add(indexPath)
    fsState.contentByPath.set(
      indexPath,
      JSON.stringify([
        {
          hash: 'stale1',
          filePath: '/mock/assets/stale1.png',
          mimeType: 'image/png',
          size: 1,
          uploadedAt: 1,
          lastAccess: 1
        },
        {
          hash: '',
          filePath: '/mock/assets/invalid.png',
          mimeType: 'image/png',
          size: 1,
          uploadedAt: 1,
          lastAccess: 1
        },
        {
          hash: 'h-known',
          filePath: '/mock/assets/known.png',
          mimeType: 'image/png',
          size: 7,
          uploadedAt: 7,
          lastAccess: 7
        }
      ])
    )
    fsState.dirEntries = [
      'assets.json',
      'old.tmp.1',
      'fresh.tmp.3',
      'bad.tmp.2',
      'known.png',
      'orphan-ok.png',
      'orphan-bad.png',
      'other.txt'
    ]

    const oldTmpPath = join(ASSET_DIR, 'old.tmp.1')
    const freshTmpPath = join(ASSET_DIR, 'fresh.tmp.3')
    const badTmpPath = join(ASSET_DIR, 'bad.tmp.2')
    const knownPath = join(ASSET_DIR, 'known.png')
    const orphanOkPath = join(ASSET_DIR, 'orphan-ok.png')
    const orphanBadPath = join(ASSET_DIR, 'orphan-bad.png')

    const now = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    fsState.existing.add(oldTmpPath)
    fsState.existing.add(freshTmpPath)
    fsState.existing.add('/mock/assets/known.png')
    fsState.existing.add(orphanOkPath)
    fsState.existing.add(orphanBadPath)
    fsState.statByPath.set(oldTmpPath, {
      size: 10,
      birthtimeMs: now - 10_000,
      atimeMs: now - 10_000,
      mtimeMs: now - 3_700_000
    })
    fsState.statByPath.set(freshTmpPath, {
      size: 5,
      birthtimeMs: now - 1_000,
      atimeMs: now - 1_000,
      mtimeMs: now - 1_000
    })
    fsState.statErrorByPath.set(badTmpPath, new Error('tmp stat failed'))
    hashByFilename.set('known.png', 'h-known')
    hashByFilename.set('orphan-ok.png', 'h-orphan')
    hashByFilename.set('orphan-bad.png', 'h-bad')
    fsState.statByPath.set(orphanOkPath, {
      size: 99,
      birthtimeMs: 111,
      atimeMs: 222,
      mtimeMs: 333
    })
    fsState.statErrorByPath.set(orphanBadPath, new Error('orphan stat failed'))

    const store = createAssetStore({ indexPath })

    expect(store.has('stale1')).toBe(false)
    expect(store.has('h-known')).toBe(true)
    expect(store.get('h-orphan')).toEqual({
      hash: 'h-orphan',
      filePath: orphanOkPath,
      mimeType: 'application/octet-stream',
      size: 99,
      uploadedAt: 111,
      lastAccess: 222
    })
    expect(rmSync).toHaveBeenCalledWith(oldTmpPath, { force: true })
    expect(rmSync).not.toHaveBeenCalledWith(freshTmpPath, { force: true })
    expect(log.info).toHaveBeenCalledWith({ file: 'old.tmp.1' }, 'Cleaned up stale temp file.')
    expect(log.debug).toHaveBeenCalledWith(
      { error: expect.any(Error), file: 'bad.tmp.2' },
      'Failed to cleanup stale temp file.'
    )
    expect(log.info).toHaveBeenCalledWith({ hash: 'h-orphan' }, 'Recovered orphan asset file.')
    expect(log.warn).toHaveBeenCalledWith(
      { error: expect.any(Error), file: 'orphan-bad.png' },
      'Failed to stat orphan file.'
    )
    expect(statSync).not.toHaveBeenCalledWith(knownPath)
    expect(getHashFromAssetFilename).toHaveBeenCalledWith('other.txt')
    expect(writeFileSync).toHaveBeenCalled()
  })

  it('persists without unref when timer handle lacks unref', () => {
    const setTimeoutWithoutUnref = (() =>
      1 as unknown as NodeJS.Timeout) as unknown as typeof setTimeout
    const clearTimeoutNoop = (() => {}) as unknown as typeof clearTimeout

    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(setTimeoutWithoutUnref)
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(clearTimeoutNoop)

    const indexPath = '/mock/no-unref-index.json'
    fsState.existing.add(indexPath)
    fsState.contentByPath.set(indexPath, '[]')
    const store = createAssetStore({ indexPath })

    store.upsert({
      hash: 'no-unref',
      filePath: '/mock/assets/no-unref.png',
      mimeType: 'image/png',
      size: 1
    })
    store.flush()

    expect(setTimeoutSpy).toHaveBeenCalled()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(1)
    expect(writeFileSync).toHaveBeenCalled()
  })
})
