import safe from './safe'

export function lockdownWorker(name: string): void {
  Object.getOwnPropertyNames(globalThis)
    .filter((key) => !safe.has(key))
    .forEach((key) => {
      clearGlobalProperty(key)
    })

  Object.defineProperties(globalThis, {
    name: { value: name, writable: false, configurable: false },
    onmessage: { value: undefined, writable: false, configurable: false },
    onmessageerror: { value: undefined, writable: false, configurable: false },
    postMessage: { value: undefined, writable: false, configurable: false }
  })
}

function clearGlobalProperty(key: string): void {
  try {
    ;(globalThis as Record<string, unknown>)[key] = undefined
  } catch (error) {
    throw new Error(`Failed to clear global property: ${key}`, { cause: error })
  }
}
