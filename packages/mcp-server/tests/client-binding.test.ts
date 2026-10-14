import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { ClientBindingFilter } from '../src/client-binding'

const frame = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n')
const update = (params: unknown) =>
  frame({ jsonrpc: '2.0', method: 'notifications/tempad/client-binding', params })

describe('private CLI binding notifications', () => {
  it('filters split Unicode frames while preserving every ordinary request, response and notification', async () => {
    const changed = vi.fn()
    const filter = new ClientBindingFilter(changed)
    let output = ''
    filter.on('data', (chunk) => {
      output += String(chunk)
    })
    const ordinary = [
      { jsonrpc: '2.0', id: '', result: { text: '中文' } },
      { jsonrpc: '2.0', id: 'tempad:request:zero', method: 'roots/list' },
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: 0, progress: 1 }
      }
    ]
    const bytes = Buffer.concat([
      frame(ordinary[0]),
      update({ kind: 'claude', sessionId: '会话' }),
      frame(ordinary[1]),
      update({ kind: 'claude' }),
      frame(ordinary[2])
    ])
    for (let index = 0; index < bytes.length; index += 3)
      filter.write(bytes.subarray(index, index + 3))
    filter.end()
    await once(filter, 'end')
    expect(output).toBe(ordinary.map((message) => frame(message).toString()).join(''))
    expect(changed.mock.calls).toEqual([
      [{ kind: 'claude', sessionId: '会话' }],
      [{ kind: 'claude' }]
    ])
  })

  it('bounds individual frames without rejecting a large batch of valid small frames', async () => {
    const filter = new ClientBindingFilter(vi.fn())
    let count = 0
    filter.on('data', () => {
      count++
    })
    const small = frame({ jsonrpc: '2.0', id: 1, result: { text: 'x'.repeat(1024) } })
    const frames = Math.ceil(STDIO_DEFAULT_MAX_BUFFER_SIZE / small.length) + 1
    filter.end(Buffer.concat(Array.from({ length: frames }, () => small)))
    await once(filter, 'end')
    expect(count).toBe(frames)

    const oversized = new ClientBindingFilter(vi.fn())
    const error = once(oversized, 'error')
    oversized.end(Buffer.alloc(STDIO_DEFAULT_MAX_BUFFER_SIZE + 1, 120))
    expect((await error)[0].message).toContain('exceeded maximum size')
  })

  it('rejects non-Claude private updates without caching or leaking them to the host', async () => {
    const changed = vi.fn()
    const filter = new ClientBindingFilter(changed)
    const output = vi.fn()
    filter.on('data', output)
    const error = once(filter, 'error')
    filter.end(update({ kind: 'codex-app', sessionId: 'parent' }))
    await error
    expect(changed).not.toHaveBeenCalled()
    expect(output).not.toHaveBeenCalled()
  })
})
