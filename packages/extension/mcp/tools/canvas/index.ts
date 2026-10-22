import type {
  ApplyCanvasParametersInput,
  ApplyCanvasResult,
  CanvasResolvedApplyParameters
} from '@tempad-dev/shared'

import { ApplyCanvasParametersSchema, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import type { DesignSystemCatalog } from '../design-system-catalog'

import { canvasAbortedError, coerceToolErrorPayload, createCodedError } from '../../errors'
import { errorMessage, formatSchemaError, specError } from './errors'
import { parseCanvasMarkup } from './markup'
import { collectUpdateNodeTypeHints, reconcileCanvas } from './reconcile'
import { resolveCanvasInput } from './resolve'
import { prepareCanvasTheme } from './theme'

let applyInProgress = false

function parseSpec<Result>(parse: () => Result, fallback = 'Canvas input is invalid.'): Result {
  try {
    return parse()
  } catch (error) {
    specError(errorMessage(error, fallback))
  }
}

function assertCanvasAvailable(): void {
  if (typeof window === 'undefined' || window.INITIAL_OPTIONS?.editor_type !== 'design') {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_UNSUPPORTED_EDITOR,
      'Canvas authoring is available only when the current Figma editor type is design.'
    )
  }
  if (applyInProgress) {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_BUSY,
      'Another apply_canvas call is already running in this Figma session.'
    )
  }
}

export async function applyResolvedCanvas(
  input: CanvasResolvedApplyParameters,
  catalog?: DesignSystemCatalog
): Promise<ApplyCanvasResult> {
  applyInProgress = true
  try {
    let parsedInput
    try {
      const preparedTheme = await prepareCanvasTheme(input, catalog)
      const existingNodeTypes =
        input.mode === 'update' && input.markup !== undefined
          ? await collectUpdateNodeTypeHints(input.targetNodeId!)
          : undefined
      parsedInput = parseSpec(() => {
        if (input.mode === 'remove' && input.targetNodeId) {
          return { mode: 'remove' as const, targetNodeId: input.targetNodeId, root: null }
        }
        if (input.markup === undefined) {
          if (input.mode === 'update' && input.targetNodeId) {
            return {
              mode: 'update' as const,
              targetNodeId: input.targetNodeId,
              bindings: input.bindings!,
              ...(input.assets === undefined ? {} : { assets: input.assets }),
              ...(input.styles === undefined ? {} : { styles: input.styles }),
              ...(input.variableCollections === undefined
                ? {}
                : { variableCollections: input.variableCollections })
            }
          }
          if (!input.page) throw new Error('A page identity is required for this operation.')
          return {
            mode: input.mode,
            page: input.page,
            ...(input.selection === undefined ? {} : { selection: input.selection })
          }
        }
        return parseCanvasMarkup(input, catalog, existingNodeTypes, preparedTheme)
      }, 'Canvas markup is invalid.')
    } catch (error) {
      // Theme hydration and markup parsing only read existing local resources.
      throw canvasAbortedError(error)
    }
    try {
      return await reconcileCanvas(parsedInput)
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED
      )
        throw error
      // Resource preflight can import library resources before the Undo boundary.
      // Even a later aborted preparation step cannot prove that nothing changed.
      const payload = coerceToolErrorPayload(error)
      const diagnostic =
        payload.code && payload.code !== TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_ABORTED
          ? ` [${payload.code}]`
          : ''
      throw Object.assign(
        createCodedError(
          TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
          `${payload.message}${diagnostic}`
        ),
        { cause: error }
      )
    }
  } finally {
    applyInProgress = false
  }
}

export async function handleApplyCanvas(
  args?: ApplyCanvasParametersInput
): Promise<ApplyCanvasResult> {
  let resolved: ReturnType<typeof resolveCanvasInput>
  try {
    assertCanvasAvailable()
    const parsed = ApplyCanvasParametersSchema.safeParse(args)
    if (!parsed.success) specError(formatSchemaError(parsed.error))
    resolved = parseSpec(() => resolveCanvasInput(parsed.data))
  } catch (error) {
    throw canvasAbortedError(error)
  }
  return applyResolvedCanvas(resolved.input, resolved.catalog)
}
