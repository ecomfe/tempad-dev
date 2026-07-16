import type { WebSocket } from 'ws'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExtensionConnection } from '../src/types'

import { ExtensionRegistry } from '../src/extension-registry'

afterEach(() => {
  vi.useRealTimers()
})

describe('ExtensionRegistry', () => {
  it('maintains one explicitly active connection and rejects duplicate ids', () => {
    const registry = new ExtensionRegistry(100)
    const first = connection('first')
    const second = connection('second')
    registry.add(first)
    registry.add(second)

    expect(registry.activate('missing')).toBe(false)
    expect(registry.getActiveId()).toBeNull()
    expect(registry.activate('second')).toBe(true)
    expect(registry.getActive()).toBe(second)
    expect(() => registry.add(connection('second'))).toThrow(
      'Extension connection already registered: second'
    )
  })

  it('prevents a different extension Origin from taking over an active connection', () => {
    const registry = new ExtensionRegistry(100)
    const trusted = connection('trusted')
    const other = connection('other', 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    registry.add(trusted)
    registry.add(other)

    expect(registry.activate('trusted')).toBe(true)
    expect(registry.activate('other')).toBe(false)
    expect(registry.getActive()).toBe(trusted)

    expect(registry.remove('trusted')).toMatchObject({ wasActive: true })
    expect(registry.activate('other')).toBe(true)
    expect(registry.getActive()).toBe(other)
  })

  it('allows reconnects from the same extension Origin to become active', () => {
    const registry = new ExtensionRegistry(100)
    const first = connection('first')
    const reconnected = connection('reconnected')
    registry.add(first)
    registry.add(reconnected)

    expect(registry.activate('first')).toBe(true)
    expect(registry.activate('reconnected')).toBe(true)
    expect(registry.getActive()).toBe(reconnected)
  })

  it('auto-activates only a stable sole connection after the grace period', async () => {
    vi.useFakeTimers()
    const registry = new ExtensionRegistry(50)
    const onActivated = vi.fn()
    registry.add(connection('first'))
    registry.scheduleAutoActivation(onActivated)

    await vi.advanceTimersByTimeAsync(49)
    expect(registry.getActiveId()).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(registry.getActiveId()).toBe('first')
    expect(onActivated).toHaveBeenCalledWith('first')
  })

  it('cancels auto-activation when another connection arrives or the target is removed', async () => {
    vi.useFakeTimers()
    const registry = new ExtensionRegistry(25)
    const onActivated = vi.fn()
    registry.add(connection('first'))
    registry.scheduleAutoActivation(onActivated)
    registry.add(connection('second'))
    registry.scheduleAutoActivation(onActivated)

    await vi.advanceTimersByTimeAsync(25)
    expect(onActivated).not.toHaveBeenCalled()
    expect(registry.getActiveId()).toBeNull()

    registry.remove('first')
    registry.scheduleAutoActivation(onActivated)
    registry.remove('second')
    await vi.advanceTimersByTimeAsync(25)
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('reports active removal and can activate the remaining connection after a new grace period', async () => {
    vi.useFakeTimers()
    const registry = new ExtensionRegistry(10)
    registry.add(connection('first'))
    registry.add(connection('second'))
    registry.activate('first')

    expect(registry.remove('missing')).toBeNull()
    expect(registry.remove('first')).toMatchObject({ wasActive: true })
    expect(registry.size).toBe(1)
    expect(registry.list().map(({ id }) => id)).toEqual(['second'])

    const onActivated = vi.fn()
    registry.scheduleAutoActivation(onActivated)
    await vi.advanceTimersByTimeAsync(10)
    expect(registry.getActiveId()).toBe('second')
    registry.dispose()
  })
})

function connection(
  id: string,
  origin = 'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc'
): ExtensionConnection {
  return { id, origin, ws: {} as WebSocket }
}
