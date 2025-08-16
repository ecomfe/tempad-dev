const EXT_SCHEMES = /(?:chrome|moz)-extension:\/\//g
const PATCHED = Symbol()

function sanitizeStack(text: string = '') {
  return text.replace(EXT_SCHEMES, '')
}

export function patchErrorStack() {
  if ((globalThis as any)[PATCHED]) return

  const NativeError = globalThis.Error

  function Error(...args: any[]) {
    const error = new NativeError(...args)

    if (typeof NativeError.captureStackTrace === 'function') {
      NativeError.captureStackTrace(error, Error)
    }

    let rawStack
    try {
      rawStack = error.stack
    } catch {}

    if (typeof rawStack === 'string') {
      let stored = rawStack
      Object.defineProperty(error, 'stack', {
        configurable: true,
        enumerable: false,
        get() {
          return sanitizeStack(stored)
        },
        set(v) {
          stored = v
        }
      })
    }

    return error
  }

  Object.setPrototypeOf(Error, NativeError)
  Error.prototype = NativeError.prototype

  globalThis.Error = Error as ErrorConstructor

  Object.defineProperty(globalThis, PATCHED, {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false
  })
}
