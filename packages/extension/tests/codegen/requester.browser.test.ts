import { describe, expect, it } from 'vitest'

import { createWorkerRequester } from '@/codegen/requester'

type MockWorkerClass = new () => Worker

function createMockWorker(
  handlePost: (message: unknown, emit: (data: unknown) => void) => void
): MockWorkerClass {
  class MockWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null

    postMessage(message: unknown): void {
      handlePost(message, (data) => {
        this.onmessage?.({ data } as MessageEvent<unknown>)
      })
    }
  }

  return MockWorker as unknown as MockWorkerClass
}

describe('codegen/requester createWorkerRequester (browser)', () => {
  it('caches requester by worker class', async () => {
    const WorkerClass = createMockWorker((message, emit) => {
      const request = message as { id: number }
      emit({ id: request.id, payload: { ok: true } })
    })

    const requester1 = createWorkerRequester<{ n: number }, { ok: boolean }>(WorkerClass)
    const requester2 = createWorkerRequester<{ n: number }, { ok: boolean }>(WorkerClass)
    expect(requester1).toBe(requester2)

    await expect(requester1({ n: 1 })).resolves.toEqual({ ok: true })
  })

  it('rejects when worker responds with error', async () => {
    const WorkerClass = createMockWorker((message, emit) => {
      const request = message as { id: number }
      emit({ id: request.id, error: new Error('boom') })
    })

    const requester = createWorkerRequester<{ n: number }, { ok: boolean }>(WorkerClass)
    await expect(requester({ n: 1 })).rejects.toThrow('boom')
  })

  it('rejects when worker response has no payload and no error', async () => {
    const WorkerClass = createMockWorker((message, emit) => {
      const request = message as { id: number }
      emit({ id: request.id })
    })

    const requester = createWorkerRequester<{ n: number }, { ok: boolean }>(WorkerClass)
    await expect(requester({ n: 1 })).rejects.toThrow('Worker response missing payload.')
  })
})
