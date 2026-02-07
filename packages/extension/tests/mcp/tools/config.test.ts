import { describe, expect, it, vi } from 'vitest'

type MockOptionsValue = {
  cssUnit: 'px' | 'rem'
  rootFontSize: number
  scale: number
}

const state = vi.hoisted(() => ({
  options: {
    value: {
      cssUnit: 'px',
      rootFontSize: 16,
      scale: 1
    } as MockOptionsValue
  }
}))

vi.mock('@/ui/state', () => ({
  options: state.options
}))

import { currentCodegenConfig } from '@/mcp/tools/config'

describe('mcp/tools/config', () => {
  it('returns css config fields from the ui option state', () => {
    state.options.value = {
      cssUnit: 'rem',
      rootFontSize: 20,
      scale: 0.75
    }

    expect(currentCodegenConfig()).toEqual({
      cssUnit: 'rem',
      rootFontSize: 20,
      scale: 0.75
    })
  })

  it('reflects updated option values on subsequent calls', () => {
    state.options.value = {
      cssUnit: 'px',
      rootFontSize: 14,
      scale: 2
    }

    expect(currentCodegenConfig()).toEqual({
      cssUnit: 'px',
      rootFontSize: 14,
      scale: 2
    })
  })
})
