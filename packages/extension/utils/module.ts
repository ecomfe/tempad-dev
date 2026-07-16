import { parse } from 'es-module-lexer/js'

const EXTERNAL_MODULE_ERROR = 'External module loading is not allowed in plugins.'
const INVALID_MODULE_ERROR = 'Plugin module syntax could not be validated.'

export function assertPluginModuleIsSelfContained(code: string): void {
  let imports: ReturnType<typeof parse>[0]
  try {
    imports = parse(code)[0]
  } catch {
    throw new Error(INVALID_MODULE_ERROR)
  }

  if (imports.some(({ d: dynamicImportPosition }) => dynamicImportPosition !== -2)) {
    throw new Error(EXTERNAL_MODULE_ERROR)
  }
}

export async function evaluate(code: string) {
  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    return await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
