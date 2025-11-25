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

// Allow both TS and JS inside <script> of .vue files
configureVueProject({ scriptLangs: ['ts', 'js'] })

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
