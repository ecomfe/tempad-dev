import { reactive } from 'vue'

const NATIVE_PANEL_WIDTH = 241
const TEMPAD_PANEL_WIDTH = 240
const TEMPAD_PANEL_MAX_WIDTH = 500
const TEMPAD_PANEL_MIN_HEIGHT = 40
const TEMPAD_PANEL_SPACING = 12

const ui = reactive({
  get nativePanelWidth() {
    return NATIVE_PANEL_WIDTH
  },

  get tempadPanelWidth() {
    return TEMPAD_PANEL_WIDTH
  },

  get tempadPanelMaxWidth() {
    return TEMPAD_PANEL_MAX_WIDTH
  },

  get tempadPanelMinHeight() {
    return TEMPAD_PANEL_MIN_HEIGHT
  },

  get topBoundary() {
    return sumLength(TEMPAD_PANEL_SPACING, '--editor-banner-height')
  },

  get bottomBoundary() {
    return TEMPAD_PANEL_SPACING
  }
})

function sumLength(...values: (string | number)[]): number {
  return values.reduce((total: number, val: string | number) => {
    if (typeof val === 'string') {
      const parsed = parseInt(getComputedStyle(document.body).getPropertyValue(val), 10)
      return total + (Number.isFinite(parsed) ? parsed : 0)
    } else {
      return total + val
    }
  }, 0)
}

export { ui }
