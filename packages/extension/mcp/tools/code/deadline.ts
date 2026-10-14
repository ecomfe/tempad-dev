export class CodeDeadlineExceededError extends Error {
  constructor() {
    super('Code generation timed out. Retry with a smaller nodeId subtree.')
    this.name = 'CodeDeadlineExceededError'
  }
}

export function createCodeCheckpoint(timeoutMs: number): () => void {
  const expiresAt = performance.now() + timeoutMs
  return () => {
    if (performance.now() >= expiresAt) throw new CodeDeadlineExceededError()
  }
}

export async function withCodeDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal, checkpoint: () => void) => Promise<T>
): Promise<T> {
  const checkElapsed = createCodeCheckpoint(timeoutMs)
  const controller = new AbortController()
  const checkpoint = () => {
    controller.signal.throwIfAborted()
    checkElapsed()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new CodeDeadlineExceededError()
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    checkpoint()
    const result = await Promise.race([run(controller.signal, checkpoint), timeout])
    // Synchronous work and its microtasks can finish before an overdue timer runs.
    checkpoint()
    return result
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
