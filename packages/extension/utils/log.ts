const PREFIX = '[tempad-dev]'

const withPrefix = (args: unknown[]): unknown[] => {
  if (!args.length) return [PREFIX]
  const [first, ...rest] = args
  if (typeof first === 'string') {
    if (first.startsWith(PREFIX)) return args
    return [`${PREFIX} ${first}`, ...rest]
  }
  return [PREFIX, ...args]
}

export const logger = {
  log: (...args: unknown[]): void => {
    console.log(...withPrefix(args))
  },
  warn: (...args: unknown[]): void => {
    console.warn(...withPrefix(args))
  },
  error: (...args: unknown[]): void => {
    console.error(...withPrefix(args))
  },
  debug: (...args: unknown[]): void => {
    if (!__DEV__) return
    if (typeof console.debug === 'function') {
      console.debug(...withPrefix(args))
      return
    }
    console.log(...withPrefix(args))
  }
}
