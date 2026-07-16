interface Window {
  readonly __TEMPAD_PLUGIN_SANDBOX_URL__?: string
  DebuggingHelpers: {
    logSelected?: () => string
    logNode?: (id: string) => string
  }
  Prism?: typeof import('prismjs')
}

declare module 'prismjs/components/prism-sass'
declare module 'prismjs/components/prism-scss'
declare module 'prismjs/components/prism-less'
declare module 'prismjs/components/prism-stylus'
declare module 'prismjs/components/prism-css-extras'
