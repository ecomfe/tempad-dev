export class CodeDeadlineExceededError extends Error {
  constructor() {
    super('Code generation timed out. Retry with a smaller nodeId subtree.')
    this.name = 'CodeDeadlineExceededError'
  }
}

export async function withCodeDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new CodeDeadlineExceededError()
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([run(controller.signal), timeout])
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
