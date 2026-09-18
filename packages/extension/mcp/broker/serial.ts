/** Preserve operation order without letting a failed write block later work. */
export function createSerialQueue() {
  let pending: Promise<unknown> = Promise.resolve()
  return <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action)
    pending = result.catch(() => undefined)
    return result
  }
}
