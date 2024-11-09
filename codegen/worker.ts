let id = 0

export type RequestMessage<T = unknown> = {
  id: number
  payload: T
}

export type ResponseMessage<T = unknown> = {
  id: number
  payload?: T
  error?: unknown
}

type PendingRequest<T = unknown> = {
  resolve: (result: T) => void
  reject: (reason?: unknown) => void
}

const pending = new Map<number, PendingRequest<any>>()

type WorkerClass = {
  new (...args: any[]): Worker
}

const cache = new Map<WorkerClass, (payload: unknown) => unknown>()

export function createWorkerRequester<T, U>(Worker: WorkerClass) {
  if (cache.has(Worker)) {
    return cache.get(Worker) as (payload: T) => Promise<U>
  }

  const worker = new Worker()

  worker.onmessage = ({ data }: MessageEvent<ResponseMessage<U>>) => {
    const { id, payload, error } = data

    const request = pending.get(id)
    if (request) {
      if (error) {
        request.reject(error)
      } else {
        request.resolve(payload)
      }
      pending.delete(id)
    }
  }

  return function request(payload: T): Promise<U> {
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })

      const message: RequestMessage<T> = { id, payload }
      worker.postMessage(message)
      id++
    })
  }
}
