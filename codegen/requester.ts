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

const pending = new Map<number, PendingRequest>()

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

  const request: WorkerRequester<T, U> = function (payload: T): Promise<U> {
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve: (result) => resolve(result as U),
        reject
      })

      const message: RequestMessage<T> = { id, payload }
      worker.postMessage(message)
      id++
    })
  }

  cache.set(Worker, request)

  return request
}
