import { describe, expect, it } from 'vitest'

import {
  validateCodegenBatchResponse,
  validateCodegenResponse,
  validateTransformVariableResponse
} from '@/plugin-sandbox/validation'

describe('plugin sandbox response validation', () => {
  it('accepts codegen and variable-transform responses that match the public contract', () => {
    const codegen = {
      pluginName: 'Example',
      codeBlocks: [{ name: 'css', title: 'CSS', code: 'color: red;', lang: 'css' }],
      devComponent: {
        name: 'Button',
        props: { kind: 'primary' },
        children: ['Save']
      }
    }

    expect(validateCodegenResponse(codegen)).toBe(codegen)
    expect(validateCodegenBatchResponse({ results: [codegen] })).toEqual([codegen])
    expect(validateTransformVariableResponse({ results: ['--color-primary'] })).toEqual({
      results: ['--color-primary']
    })
  })

  it('rejects malformed code blocks and component trees', () => {
    expect(() =>
      validateCodegenResponse({
        codeBlocks: [{ name: 'css', title: 'CSS', code: '', lang: 'executable' }]
      })
    ).toThrow('Invalid plugin code block.')

    expect(() =>
      validateCodegenResponse({
        codeBlocks: [],
        devComponent: { name: 'Button', props: {}, children: [{ name: 1 }] }
      })
    ).toThrow('Invalid plugin development component.')

    expect(() => validateCodegenBatchResponse({ results: [{ codeBlocks: null }] })).toThrow(
      'Invalid plugin codegen response.'
    )
  })

  it('rejects malformed variable-transform responses', () => {
    expect(() => validateTransformVariableResponse({ results: ['ok', 1] })).toThrow(
      'Invalid plugin variable transform response.'
    )
  })
})
