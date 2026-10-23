import { beforeEach, expect, it, vi } from 'vitest'

import bundledRules from '@/public/rules/figma.json'

const fixture = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  launch: vi.fn(),
  contextClose: vi.fn(),
  waitForWorker: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  mkdtemp: async () => '/temporary/rewrite-profile',
  cp: vi.fn(),
  readFile: fixture.readFile,
  readdir: fixture.readdir,
  writeFile: vi.fn(),
  rm: fixture.rm
}))
vi.mock('playwright', () => ({
  chromium: { launchPersistentContext: fixture.launch }
}))

import { runCheck } from '@/scripts/check-rewrite-runtime'

beforeEach(() => {
  vi.resetAllMocks()
  fixture.readFile.mockImplementation(async (file: string) => {
    if (file.endsWith('manifest.json'))
      return JSON.stringify({
        permissions: ['declarativeNetRequestWithHostAccess', 'alarms', 'storage'],
        declarative_net_request: {
          rule_resources: [{ id: 'figma', enabled: true, path: 'rules/figma.json' }]
        },
        content_scripts: [],
        host_permissions: []
      })
    if (file.endsWith('rules/figma.json')) return JSON.stringify(bundledRules)
    return ''
  })
  fixture.readdir.mockImplementation(async (directory: string) =>
    directory.endsWith('rules') ? ['figma.json'] : []
  )
  fixture.launch.mockResolvedValue({
    serviceWorkers: () => [],
    waitForEvent: fixture.waitForWorker,
    close: fixture.contextClose
  })
  fixture.waitForWorker.mockRejectedValue(new Error('Worker did not start'))
  fixture.contextClose.mockResolvedValue(undefined)
  fixture.rm.mockResolvedValue(undefined)
})

it('removes the temporary extension and profiles when Chromium cannot launch', async () => {
  const failure = new Error('Chromium executable is missing')
  fixture.launch.mockRejectedValue(failure)

  await expect(runCheck()).rejects.toBe(failure)

  expect(fixture.rm).toHaveBeenCalledWith('/temporary/rewrite-profile', {
    recursive: true,
    force: true
  })
})

it('removes the temporary extension and profiles even if context cleanup fails', async () => {
  const failure = new Error('Chromium cleanup failed')
  fixture.contextClose.mockRejectedValue(failure)

  await expect(runCheck()).rejects.toBe(failure)

  expect(fixture.contextClose).toHaveBeenCalledOnce()
  expect(fixture.rm).toHaveBeenCalledWith('/temporary/rewrite-profile', {
    recursive: true,
    force: true
  })
})
