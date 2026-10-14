import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { computed, shallowRef, useTemplateRef } from 'vue'

import MetaSection from '@/components/sections/MetaSection.vue'
import { selection } from '@/ui/state'

import { mount, unmountAll } from './mount'

const show = vi.hoisted(() => vi.fn())
vi.mock('@/composables', async () => ({
  ...(await import('@/composables/dev-resources')),
  useToast: () => ({ show }),
  useCopy: () => async () => {}
}))
vi.mock('@/ui/state', async () => {
  const { shallowRef, computed } = await import('vue')
  const selection = shallowRef<SceneNode[]>([])
  return {
    selection,
    selectedNode: computed(() => selection.value[0] ?? null),
    selectedTemPadComponent: shallowRef(null)
  }
})

type Resource = { name: string; url: string }
function node(read: () => Promise<Resource[]>): SceneNode {
  return {
    id: 'node',
    type: 'FRAME',
    name: 'Layer',
    getDevResourcesAsync: read
  } as unknown as SceneNode
}
function deferred() {
  let resolve!: (links: Resource[]) => void
  const promise = new Promise<Resource[]>((done) => (resolve = done))
  return { promise, resolve }
}
const link = (name: string) => ({ name, url: `https://example.com/${name}` })
beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('shallowRef', shallowRef)
  vi.stubGlobal('useTemplateRef', useTemplateRef)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 404 }))
  )
  show.mockClear()
})
afterEach(() => {
  unmountAll()
  selection.value = []
  vi.unstubAllGlobals()
})

it('refreshes empty, changed, and deleted links without changing selection', async () => {
  const read = vi.fn<() => Promise<Resource[]>>().mockResolvedValue([])
  selection.value = [node(read)]
  mount(MetaSection)
  await expect.poll(() => read.mock.calls.length).toBe(1)
  const refresh = page.getByRole('button', { name: 'Refresh links' })
  await expect.element(refresh).toBeVisible()
  read.mockResolvedValue([link('Added')])
  await refresh.click()
  await expect.element(page.getByRole('link', { name: 'Added' })).toBeVisible()
  read.mockResolvedValue([link('Updated')])
  await refresh.click()
  await expect.element(page.getByRole('link', { name: 'Updated' })).toBeVisible()
  expect(document.querySelectorAll('a')).toHaveLength(1)
  read.mockResolvedValue([])
  await refresh.click()
  await expect.poll(() => document.querySelectorAll('a').length).toBe(0)
  expect(read).toHaveBeenCalledTimes(4)
})

it('shares pending reads, retains links on failure, and permits retry', async () => {
  const initial = deferred()
  const read = vi.fn<() => Promise<Resource[]>>().mockReturnValueOnce(initial.promise)
  selection.value = [node(read)]
  mount(MetaSection)
  const refresh = page.getByRole('button', { name: 'Refresh links' })
  await refresh.click()
  await expect.element(refresh).toBeDisabled()
  expect(read).toHaveBeenCalledOnce()
  initial.resolve([link('Saved')])
  await expect.element(refresh).toBeEnabled()
  read.mockRejectedValueOnce('request failed: status 403')
  await refresh.click()
  await expect.poll(() => show.mock.calls.length).toBe(1)
  expect(show).toHaveBeenCalledWith('Could not refresh links. Try again.')
  await expect.element(page.getByRole('link', { name: 'Saved' })).toBeVisible()
  read.mockResolvedValue([link('Recovered')])
  await refresh.click()
  await expect.element(page.getByRole('link', { name: 'Recovered' })).toBeVisible()
})

it('keeps an old node response separate from the current node refresh', async () => {
  const old = deferred()
  const next = deferred()
  const readOld = vi
    .fn<() => Promise<Resource[]>>()
    .mockResolvedValueOnce([])
    .mockReturnValue(old.promise)
  selection.value = [node(readOld)]
  mount(MetaSection)
  await expect.poll(() => readOld.mock.calls.length).toBe(1)
  const refresh = page.getByRole('button', { name: 'Refresh links' })
  await refresh.click()
  const readNext = vi.fn(() => next.promise)
  selection.value = [node(readNext)]
  await expect.element(refresh).toBeEnabled()
  await refresh.click()
  old.resolve([link('Stale')])
  await expect.element(refresh).toBeDisabled()
  expect(document.querySelectorAll('a')).toHaveLength(0)
  next.resolve([link('Current')])
  await expect.element(page.getByRole('link', { name: 'Current' })).toBeVisible()
  await expect.element(refresh).toBeEnabled()
  expect(readOld).toHaveBeenCalledTimes(2)
  expect(readNext).toHaveBeenCalledOnce()
})
