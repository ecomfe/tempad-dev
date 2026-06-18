import { createConfig } from './eslint.shared'

export default [
  ...createConfig(import.meta.url),
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly'
      }
    }
  }
]
