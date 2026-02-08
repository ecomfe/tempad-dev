import { describe, expect, it } from 'vitest'

import { ui } from '@/ui/figma'

describe('ui/figma', () => {
  it('exposes stable panel size constants', () => {
    expect(ui.nativePanelWidth).toBe(241)
    expect(ui.tempadPanelWidth).toBe(240)
    expect(ui.tempadPanelMaxWidth).toBe(500)
    expect(ui.tempadPanelMinHeight).toBe(40)
    expect(ui.bottomBoundary).toBe(12)
  })

  it('computes top boundary from spacing plus editor banner css variable', () => {
    document.body.style.setProperty('--editor-banner-height', '24px')
    expect(ui.topBoundary).toBe(36)
  })

  it('falls back to spacing when editor banner variable is unset', () => {
    document.body.style.removeProperty('--editor-banner-height')
    expect(ui.topBoundary).toBe(12)
  })
})
