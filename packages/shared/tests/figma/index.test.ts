import { describe, expect, it } from 'vitest'

import * as figma from '../../src/figma'
import * as color from '../../src/figma/color'
import * as gradient from '../../src/figma/gradient'
import * as stroke from '../../src/figma/stroke'
import * as styleResolver from '../../src/figma/style-resolver'

describe('shared/figma index barrel', () => {
  it('re-exports figma style utilities', () => {
    expect(figma.formatHexAlpha).toBe(color.formatHexAlpha)
    expect(figma.resolveGradientFromPaints).toBe(gradient.resolveGradientFromPaints)
    expect(figma.resolveSolidFromPaints).toBe(gradient.resolveSolidFromPaints)
    expect(figma.resolveStrokeFromPaints).toBe(stroke.resolveStrokeFromPaints)
    expect(figma.applyStrokeToCSS).toBe(stroke.applyStrokeToCSS)
    expect(figma.resolveFillStyleForNode).toBe(styleResolver.resolveFillStyleForNode)
    expect(figma.resolveStrokeStyleForNode).toBe(styleResolver.resolveStrokeStyleForNode)
    expect(figma.resolveStylesFromNode).toBe(styleResolver.resolveStylesFromNode)
  })
})
