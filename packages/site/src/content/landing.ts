export type SiteSkill = 'canvas' | 'code'

export type SiteMarketingImage = {
  alt: string
  dark: string
  light: string
  width: number
  height: number
}

export type InspectionSlide = {
  id: string
  caption: string
  image: SiteMarketingImage
}

export const SITE_LINKS = {
  install: 'https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc',
  github: 'https://github.com/ecomfe/tempad-dev',
  discord: 'https://discord.gg/MXGXwtkEck',
  license: 'https://github.com/ecomfe/tempad-dev/blob/main/LICENSE',
  guide: 'https://github.com/ecomfe/tempad-dev#readme',
  agentGuide: 'https://github.com/ecomfe/tempad-dev/tree/main/agent-plugins/tempad-dev',
  inspectGuide: 'https://github.com/ecomfe/tempad-dev#inspect-designs'
} as const

function createMarketingImage(name: string, alt: string): SiteMarketingImage {
  return {
    alt,
    dark: `/marketing/${name}-dark.png`,
    light: `/marketing/${name}-light.png`,
    width: 1440,
    height: 960
  }
}

export const INSPECTION_SLIDES: readonly InspectionSlide[] = [
  {
    id: 'inspect-code',
    image: createMarketingImage(
      'code',
      'TemPad Dev showing generated code for a selected frame in Figma.'
    ),
    caption: 'Code view'
  },
  {
    id: 'transform-plugins',
    image: createMarketingImage(
      'plugins',
      'TemPad Dev plugin output for a selected button inside Figma.'
    ),
    caption: 'Plugin output'
  },
  {
    id: 'inspect-deep',
    image: createMarketingImage(
      'deep',
      'TemPad Dev showing deep selection tools inside the extension.'
    ),
    caption: 'Deep selection'
  },
  {
    id: 'inspect-measure',
    image: createMarketingImage(
      'measure',
      'TemPad Dev showing measurement tools inside the extension.'
    ),
    caption: 'Measure'
  },
  {
    id: 'inspect-scroll',
    image: createMarketingImage(
      'scroll',
      'TemPad Dev showing scroll-into-view tools inside the extension.'
    ),
    caption: 'Scroll into view'
  },
  {
    id: 'inspect-units',
    image: createMarketingImage(
      'unit',
      'TemPad Dev showing units and conversion controls inside the extension.'
    ),
    caption: 'Units and scale'
  }
] as const

export const AGENT_SETUP_SHOT: SiteMarketingImage = {
  alt: 'TemPad Dev’s agent setup dialog with the Codex plugin installation options.',
  light: '/marketing/mcp-config-light.png',
  dark: '/marketing/mcp-config-dark.png',
  width: 1200,
  height: 960
}
