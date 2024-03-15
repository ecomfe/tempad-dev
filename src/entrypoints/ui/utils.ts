const metaKey = Reflect.getOwnPropertyDescriptor(MouseEvent.prototype, 'metaKey')!
const altKey = Reflect.getOwnPropertyDescriptor(MouseEvent.prototype, 'altKey')!

export function setLockMetaKey(lock: boolean) {
  if (lock) {
    Reflect.defineProperty(MouseEvent.prototype, 'metaKey', {
      get: () => true
    })
  } else {
    Reflect.defineProperty(MouseEvent.prototype, 'metaKey', metaKey)
  }
}

export function setLockAltKey(lock: boolean) {
  if (lock) {
    Reflect.defineProperty(MouseEvent.prototype, 'altKey', {
      get: () => true
    })
  } else {
    Reflect.defineProperty(MouseEvent.prototype, 'altKey', altKey)
  }
}

function escapeSingleQuote(value: string) {
  return value.replace(/'/g, "\\'")
}

function trimComments(value: string) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '')
}

function parseNumber(value: string) {
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return parsed
}

const PX_VALUE_RE = /\b(\d+(?:.\d+)?)px\b/g
const KEEP_PX_PROPS = ['border', 'box-shadow', 'filter', 'backdrop-filter']
function pxToRem(value: string, rootFontSize: number) {
  if (rootFontSize <= 0) {
    return value
  }

  return value.replace(PX_VALUE_RE, (_, val) => {
    const parsed = parseNumber(val)
    if (parsed == null) {
      return val
    }
    if (parsed === 0) {
      return '0'
    }
    return `${Number((parsed / rootFontSize).toFixed(5))}rem`
  })
}

type ProcessValueOptions = {
  useRem: boolean
  rootFontSize: number
}

type SerializeOptions = {
  toJS?: boolean
} & ProcessValueOptions

function processValue(key: string, value: string, { useRem, rootFontSize }: ProcessValueOptions) {
  let current: string | number = trimComments(value).trim()

  return (
    parseNumber(current) ??
    (useRem && !KEEP_PX_PROPS.includes(key) ? pxToRem(current, rootFontSize) : current)
  )
}

function stringifyValue(value: string | number) {
  return typeof value === 'string' ? `'${escapeSingleQuote(value)}'` : value
}

export function serializeCSS(
  style: Record<string, string>,
  { toJS = false, useRem, rootFontSize }: SerializeOptions
) {
  if (toJS) {
    return (
      '{\n' +
      Object.entries(style)
        .map(
          ([key, value]) =>
            `  ${kebabToCamel(key)}: ${stringifyValue(processValue(key, value, { useRem, rootFontSize }))}`
        )
        .join(',\n') +
      '\n}'
    )
  }

  return Object.entries(style)
    .map(([key, value]) => `${key}: ${processValue(key, value, { useRem, rootFontSize })};`)
    .join('\n')
}

export function kebabToCamel(str: string) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

const COMPONENT_RE = /<>[\s\n]+<Stack[^>]*>[\s\n]+([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/>/
const COMPONENT_PROVIDER_RE =
  /<ProviderConfig[^>]*>[\s\n]+<Stack[^>]*>[\s\n]+([\s\S]+?)[\s\n]+<\/Stack>[\s\n]+<\/ProviderConfig>/
export function extractJSX(code: string) {
  const [, jsx] = code.match(COMPONENT_RE) || code.match(COMPONENT_PROVIDER_RE) || []
  return jsx || ''
}

export function getCanvas() {
  // Need to ensure the whole plugin is rendered after canvas is ready
  // so that we can cast the result to HTMLElement here.
  // The `waitFor` logic is in `./index.ts`.
  return (document.querySelector('#fullscreen-root .gpu-view-content canvas')) as HTMLElement
}

export function getObjectsPanel() {
  // Similar to `getCanvas()`.
  return document.querySelector('[data-testid="objects-panel"]') as HTMLElement
}
