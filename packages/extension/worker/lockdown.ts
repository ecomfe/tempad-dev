import safe from './safe'

export function lockdownWorker(name: string): void {
  Object.getOwnPropertyNames(globalThis)
    .filter((key) => !safe.has(key))
    .forEach((key) => {
      Reflect.set(globalThis, key, undefined)
    })

  Object.defineProperties(globalThis, {
    name: { value: name, writable: false, configurable: false },
    onmessage: { value: undefined, writable: false, configurable: false },
    onmessageerror: { value: undefined, writable: false, configurable: false },
    postMessage: { value: undefined, writable: false, configurable: false }
  })
}
