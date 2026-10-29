import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { describe, expect, it } from 'vitest'

import { canvasAbortedError, coerceToolErrorPayload, createCodedError } from '@/mcp/errors'

describe('mcp/errors', () => {
  it('marks proven pre-execution rejection without losing its original diagnostic', () => {
    const cause = createCodedError(TEMPAD_MCP_ERROR_CODES.DESIGN_TARGET_CHANGED, 'Wrong file')
    const error = canvasAbortedError(cause)
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_ABORTED', cause })
    expect(coerceToolErrorPayload(error)).toEqual({
      code: 'CANVAS_APPLY_ABORTED',
      message: 'Wrong file [DESIGN_TARGET_CHANGED]'
    })
    expect(canvasAbortedError(error).message).toBe(error.message)
    expect(canvasAbortedError(new Error('Invalid input')).message).toBe('Invalid input')
  })

  it('creates coded errors with message and code', () => {
    const error = createCodedError(TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION, 'bad request')

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('bad request')
    expect(error.code).toBe(TEMPAD_MCP_ERROR_CODES.NO_ACTIVE_EXTENSION)
  })

  it('coerces Error inputs with recognized and unrecognized codes', () => {
    const coded = Object.assign(new Error('transport down'), {
      code: TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED
    })
    expect(coerceToolErrorPayload(coded)).toEqual({
      message: 'transport down',
      code: TEMPAD_MCP_ERROR_CODES.TRANSPORT_NOT_CONNECTED
    })

    const unknownCode = Object.assign(new Error('oops'), { code: 'UNKNOWN' })
    expect(coerceToolErrorPayload(unknownCode)).toEqual({ message: 'oops' })
  })

  it('handles string and plain object inputs', () => {
    expect(coerceToolErrorPayload('plain message')).toEqual({ message: 'plain message' })

    expect(
      coerceToolErrorPayload({
        message: 'validation failed',
        code: TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT
      })
    ).toEqual({
      message: 'validation failed',
      code: TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT
    })

    expect(coerceToolErrorPayload({ message: 'validation failed', code: 'NOPE' })).toEqual({
      message: 'validation failed'
    })
  })

  it('falls back for blank or non-error values', () => {
    const blankMessageError = Object.assign(new Error('x'), { message: '' })
    expect(coerceToolErrorPayload(blankMessageError)).toEqual({ message: 'Unknown error' })

    expect(coerceToolErrorPayload({ message: '   ' })).toEqual({ message: '[object Object]' })
    expect(coerceToolErrorPayload(null)).toEqual({ message: 'Unknown error' })
    expect(coerceToolErrorPayload(404)).toEqual({ message: '404' })
  })
})
