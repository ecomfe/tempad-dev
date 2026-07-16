export type WorkerRequest<T = unknown> = {
  id: number
  payload: T
}

export type WorkerResponse<T = unknown> =
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
