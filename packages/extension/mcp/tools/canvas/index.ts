import type {
  ApplyCanvasParametersInput,
  ApplyCanvasResult,
  CanvasResolvedApplyParameters
} from '@tempad-dev/shared'

import { ApplyCanvasParametersSchema, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import type { DesignSystemCatalog } from '../design-system-catalog'

import { createCodedError } from '../../errors'
import { errorMessage, formatSchemaError, specError } from './errors'
import { parseCanvasMarkup } from './markup'
import { collectUpdateNodeTypeHints, reconcileCanvas } from './reconcile'
import { resolveCanvasInput } from './resolve'

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
    const existingNodeTypes =
      input.mode === 'update' && input.markup !== null
        ? await collectUpdateNodeTypeHints(input.targetNodeId!)
        : undefined
    const parsedInput = parseSpec(
      () => parseCanvasMarkup(input, catalog, existingNodeTypes),
      'Canvas markup is invalid.'
    )
    return await reconcileCanvas(parsedInput)
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      errorMessage(error, 'Canvas apply failed.')
    )
  } finally {
    applyInProgress = false
  }
}

export async function handleApplyCanvas(
  args?: ApplyCanvasParametersInput
): Promise<ApplyCanvasResult> {
  assertCanvasAvailable()
  const parsed = ApplyCanvasParametersSchema.safeParse(args)
  if (!parsed.success) specError(formatSchemaError(parsed.error))
  const resolved = parseSpec(() => resolveCanvasInput(parsed.data))
  return applyResolvedCanvas(resolved.input, resolved.catalog)
}
