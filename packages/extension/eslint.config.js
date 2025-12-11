import js from '@eslint/js'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import {
  configureVueProject,
  defineConfigWithVueTs,
  vueTsConfigs
} from '@vue/eslint-config-typescript'
import gitignore from 'eslint-config-flat-gitignore'
import perfectionist from 'eslint-plugin-perfectionist'
import pluginVue from 'eslint-plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Allow both TS and JS inside <script> of .vue files
configureVueProject({ scriptLangs: ['ts', 'js'] })

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfigWithVueTs(
  // Respect .gitignore
  gitignore(),
  // Files to lint
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,vue}']
  },
  // Base JS + Vue + TS presets
  js.configs.recommended,
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,
  // Project rules
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir
      }
    },
    plugins: {
      perfectionist
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'perfectionist/sort-imports': 'error'
    }
  }
)
