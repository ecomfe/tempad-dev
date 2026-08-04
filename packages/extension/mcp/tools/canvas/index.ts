import type {
  ApplyCanvasParametersInput,
  ApplyCanvasResult,
  CanvasResolvedApplyParameters
} from '@tempad-dev/shared'

import { ApplyCanvasParametersSchema, TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'

import type { DesignSystemCatalog } from '../design-system-catalog'

import { createCodedError } from '../../errors'
import { formatSchemaError, specError } from './errors'
import { parseCanvasMarkup } from './markup'
import { reconcileCanvas } from './reconcile'
import { resolveCanvasInput } from './resolve'

let applyInProgress = false

function parseSpec<Result>(parse: () => Result, fallback = 'Canvas input is invalid.'): Result {
  try {
    return parse()
  } catch (error) {
    specError(typeof error === 'string' ? error : error instanceof Error ? error.message : fallback)
  }
}

function assertCanvasAvailable(): void {
  if (figma.editorType !== 'figma') {
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_UNSUPPORTED_EDITOR,
      'Canvas authoring is supported only in Figma Design files.'
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
  const parsedInput = parseSpec(
    () => parseCanvasMarkup(input, catalog),
    'Canvas markup is invalid.'
  )

  applyInProgress = true
  try {
    return await reconcileCanvas(parsedInput)
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    throw createCodedError(
      TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      error instanceof Error ? error.message : 'Canvas apply failed.'
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
