const NATIVE_PANEL_WIDTH = 241
const TEMPAD_PANEL_WIDTH = 240

class FigmaUI {
  get isUi3 () {
    return document.body.dataset.fplVersion === 'ui3'
  }

  get nativePanelWidth () {
    return NATIVE_PANEL_WIDTH
  }

  get tempadPanelWidth () {
    return TEMPAD_PANEL_WIDTH
  }

  get topBoundary () {
    return sumLength(this.isUi3 ? 12 : '--toolbar-height', '--editor-banner-height')
  }

  get bottomBoundary () {
    return this.isUi3 ? 12 : 0
  }
}

export const ui = new FigmaUI()

function sumLength(...values: (string | number)[]): number {
  return values.reduce((total: number, val: string | number) => {
    if (typeof val === 'string') {
      return total + parseInt(getComputedStyle(document.body).getPropertyValue(val), 10)
    } else {
      return total + val
    }
  }, 0)
}
