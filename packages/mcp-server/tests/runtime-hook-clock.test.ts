import type { ClientHook } from '@tempad-dev/shared'

import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import { writeDurableJson } from '../src/durable-json'
import { ensurePrivateDirectory, runtimeEndpoint } from '../src/runtime-platform'
import { startHookGateway } from '../src/runtime-prototype/hooks'
import { connectSocket } from '../src/runtime-prototype/processes'

const platformModule = '../scripts/runtime-test-platform.mjs'
const { fixtureRoot } = await import(platformModule)
const cleanup: (() => unknown | Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})

function hook(issuedAt: number): Extract<ClientHook, { version: 2 }> {
  return {
    version: 2,
    kind: 'claude',
    sessionId: 'session',
    event: 'PreToolUse',
    invocationId: randomUUID(),
    profile: { kind: 'release' },
    issuedAt
  }
}

async function directory() {
  const root = await fixtureRoot('tp-hook-clock-')
  ensurePrivateDirectory(join(root, 'run'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  return root as string
}

async function request(root: string, input: ClientHook) {
  const socket = await connectSocket(runtimeEndpoint(join(root, 'run'), 'mcp.sock'))
  const reply = once(socket, 'data')
  socket.write(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tempad/client-hook', params: input }) + '\n'
  )
  try {
    return JSON.parse(String((await reply)[0]))
  } finally {
    socket.destroy()
  }
}

it('retries a one-millisecond future invocation without losing its Stop output', async () => {
  const root = await directory()
  const hubId = randomUUID()
  const output = {
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'The task was stopped.' }
  }
  const deliver = vi.fn(async (_input: ClientHook, admittedHubId?: string) =>
    admittedHubId === hubId ? { output } : {}
  )
  const gateway = await startHookGateway(root, deliver)
  cleanup.push(() => gateway.close())
  gateway.setReceiver(hubId)
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const input = hook(now + 1)

  expect((await request(root, input)).error).toMatchObject({
    code: -32001,
    data: { code: 'MCP_HOOK_CLOCK_AHEAD' },
    message: expect.stringContaining('retry the same invocation')
  })
  expect(deliver).not.toHaveBeenCalled()
  expect(JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8')).entries).toEqual([])

  now++
  await request(root, input)
  await gateway.flush()
  const applied = await request(root, input)
  expect(applied.result).toEqual({
    output,
    receipt: { version: 2, invocationId: input.invocationId, state: 'applied' }
  })
  now--
  expect(await request(root, input)).toEqual(applied)
  expect(deliver).toHaveBeenCalledExactlyOnceWith(input, hubId)
})

it('preserves valid admission evidence when the clock moves backward before delivery', async () => {
  const root = await directory()
  const hubId = randomUUID()
  let now = Date.now()
  const first = hook(now)
  const second = hook(now)
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const deliver = vi.fn(async (input: ClientHook, admittedHubId?: string) => {
    if (input.invocationId === first.invocationId) await barrier
    return { admittedHubId }
  })
  const gateway = await startHookGateway(root, deliver)
  cleanup.push(async () => {
    release()
    await gateway.flush()
    await gateway.close()
  })
  gateway.setReceiver(hubId)
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  expect((await request(root, first)).result.receipt.state).toBe('accepted')
  expect((await request(root, second)).result.receipt.state).toBe('accepted')

  now--
  release()
  await gateway.flush()
  expect(deliver).toHaveBeenNthCalledWith(2, second, hubId)
})

it('never promotes a previously accepted hook without admission evidence', async () => {
  const root = await directory()
  const hubId = randomUUID()
  const input = hook(Date.now() + 1000)
  writeDurableJson(join(root, 'hooks.json'), {
    version: 2,
    cutoff: 0,
    receiver: { hubId },
    entries: [{ input }]
  })
  const deliver = vi.fn(async () => ({}))
  const gateway = await startHookGateway(root, deliver)
  cleanup.push(() => gateway.close())
  gateway.setReceiver(hubId)
  vi.spyOn(Date, 'now').mockReturnValue(input.issuedAt + 1)
  await gateway.flush()
  await request(root, input)
  expect(deliver).toHaveBeenCalledExactlyOnceWith(input, undefined)
})
