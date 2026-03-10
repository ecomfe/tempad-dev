import type { McpClientId } from '@tempad-dev/shared'

export type SiteDetailIconId =
  | 'braces'
  | 'component'
  | 'open-source'
  | 'pocket-knife'
  | 'sliders-horizontal'
  | 'variable'

export type SiteDetail = {
  title: string
  body: string
  icon: SiteDetailIconId
}

export type SiteMarketingImage = {
  alt: string
  dark: string
  light: string
}

export type HeroCarouselSlide = {
  id: string
  caption: string
  image: SiteMarketingImage
  objectFit?: 'cover' | 'contain'
  objectPosition?: string
}

export const SITE_LINKS = {
  install: 'https://chromewebstore.google.com/detail/tempad-dev/lgoeakbaikpkihoiphamaeopmliaimpc',
  github: 'https://github.com/ecomfe/tempad-dev',
  discord: 'https://discord.gg/MXGXwtkEck',
  license: 'https://github.com/ecomfe/tempad-dev/blob/main/LICENSE',
  plugins: 'https://www.npmjs.com/package/@tempad-dev/plugins'
} as const

export const HERO_NOTES = ['Free', 'Open source', 'MIT licensed'] as const

function createMarketingImage(name: string, alt: string): SiteMarketingImage {
  return {
    alt,
    dark: `/marketing/${name}-dark${name === 'hero' ? '.svg' : '.png'}`,
    light: `/marketing/${name}-light${name === 'hero' ? '.svg' : '.png'}`
  }
}

export const INSPECT_SHOT = createMarketingImage(
  'code',
  'TemPad Dev showing generated code for a selected frame in Figma.'
)

export const TRANSFORM_SHOT = createMarketingImage(
  'plugins',
  'TemPad Dev plugin output for a selected button inside Figma.'
)

export const HERO_CAROUSEL_SLIDES: readonly HeroCarouselSlide[] = [
  {
    id: 'inspect-code',
    image: INSPECT_SHOT,
    caption: 'Code view',
    objectFit: 'contain'
  },
  {
    id: 'transform-plugins',
    image: TRANSFORM_SHOT,
    caption: 'Plugin output',
    objectFit: 'contain'
  },
  {
    id: 'inspect-deep',
    image: createMarketingImage(
      'deep',
      'TemPad Dev showing deep selection tools inside the extension.'
    ),
    caption: 'Deep selection',
    objectFit: 'contain'
  },
  {
    id: 'inspect-measure',
    image: createMarketingImage(
      'measure',
      'TemPad Dev showing measurement tools inside the extension.'
    ),
    caption: 'Measure',
    objectFit: 'contain'
  },
  {
    id: 'inspect-scroll',
    image: createMarketingImage(
      'scroll',
      'TemPad Dev showing scroll-into-view tools inside the extension.'
    ),
    caption: 'Scroll into view',
    objectFit: 'contain'
  },
  {
    id: 'inspect-units',
    image: createMarketingImage(
      'unit',
      'TemPad Dev showing units and conversion controls inside the extension.'
    ),
    caption: 'Units and scale',
    objectFit: 'contain'
  }
] as const

export const INSPECT_DETAILS: readonly SiteDetail[] = [
  {
    title: 'Code views',
    body: 'CSS and JavaScript from the current selection, ready to read or copy.',
    icon: 'braces'
  },
  {
    title: 'Resolved context',
    body: 'Variables, units, scale, and root font size shown in the same place.',
    icon: 'variable'
  },
  {
    title: 'Handoff tools',
    body: 'Deep select, measure, and scroll-into-view built into the inspect flow.',
    icon: 'pocket-knife'
  }
] as const

export const TRANSFORM_DETAILS: readonly SiteDetail[] = [
  {
    title: 'Component mapping',
    body: 'Map the same design context to your own component names.',
    icon: 'component'
  },
  {
    title: 'Syntax transforms',
    body: 'Generate CSS, JavaScript, Tailwind, or repo-specific output through plugins.',
    icon: 'sliders-horizontal'
  },
  {
    title: 'Open by nature',
    body: 'Load shared plugins, inspect how they work, or point at your own module URL.',
    icon: 'open-source'
  }
] as const

export const CONNECT_CLIENT_ORDER: McpClientId[] = [
  'vscode',
  'cursor',
  'windsurf',
  'claude',
  'codex',
  'trae'
]
