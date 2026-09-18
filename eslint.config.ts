import { createConfig } from './eslint.shared'

export default [
  ...createConfig(import.meta.url),
  // Generated agent plugin targets are verbatim copies; lint agent-plugin/src/ instead.
  { ignores: ['agent-plugin/targets/**'] },
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        structuredClone: 'readonly',
        URL: 'readonly'
      }
    }
  }
]
