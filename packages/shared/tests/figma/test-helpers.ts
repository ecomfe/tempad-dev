import { vi } from 'vitest'

type FigmaMockOptions = {
  styles?: Record<string, BaseStyle | null>
  styleErrors?: string[]
  variables?: Record<string, Variable | null>
  variableErrors?: string[]
}

export function installFigmaMocks(options: FigmaMockOptions = {}) {
  const { styles = {}, styleErrors = [], variables = {}, variableErrors = [] } = options

  const getStyleById = vi.fn((id: string) => {
    if (styleErrors.includes(id)) {
      throw new Error(`style error: ${id}`)
    }
    return styles[id] ?? null
  })

  const getVariableById = vi.fn((id: string) => {
    if (variableErrors.includes(id)) {
      throw new Error(`variable error: ${id}`)
    }
    return variables[id] ?? null
  })

  ;(globalThis as { figma?: PluginAPI }).figma = {
    getStyleById,
    variables: {
      getVariableById
    }
  } as unknown as PluginAPI

  return {
    getStyleById,
    getVariableById
  }
}

export function uninstallFigmaMocks() {
  delete (globalThis as { figma?: PluginAPI }).figma
}
