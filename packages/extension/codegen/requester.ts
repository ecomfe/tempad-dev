export type RequestMessage<T = unknown> = {
  id: number
  payload: T
}

export type ResponseMessage<T = unknown> =
  | {
      id: number
      payload: T
      error?: undefined
    }
  | {
      id: number
      payload?: undefined
      error: unknown
    }

type PendingRequest<T = unknown> = {
  resolve: (result: T) => void
  reject: (reason?: unknown) => void
}

type WorkerClass = {
  // Bundler-provided worker classes expose a zero-arg constructor
  new (): Worker
}

type WorkerRequester<T = unknown, U = unknown> = (payload: T) => Promise<U>

const cache = new WeakMap<WorkerClass, unknown>()

export function createWorkerRequester<T, U>(Worker: WorkerClass) {
  if (cache.has(Worker)) {
    return cache.get(Worker) as WorkerRequester<T, U>
  }

  const worker = new Worker()
  let nextId = 0
  const pending = new Map<number, PendingRequest<U>>()

  worker.onmessage = ({ data }: MessageEvent<ResponseMessage<U>>) => {
    const { id } = data

    const request = pending.get(id)
    if (request) {
      if ('error' in data) {
        request.reject(data.error)
      } else if ('payload' in data) {
        request.resolve(data.payload)
      } else {
        request.reject(new Error('Worker response missing payload.'))
      }
      pending.delete(id)
    }
  }

  const request: WorkerRequester<T, U> = function (payload: T): Promise<U> {
    return new Promise((resolve, reject) => {
      const requestId = nextId
      nextId += 1

      pending.set(requestId, {
        resolve,
        reject
      })

      const message: RequestMessage<T> = { id: requestId, payload }
      worker.postMessage(message)
    })
  }

  cache.set(Worker, request)

  return request
}
