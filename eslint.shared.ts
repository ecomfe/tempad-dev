import js from '@eslint/js'
import {
  configureVueProject,
  defineConfigWithVueTs,
  vueTsConfigs
} from '@vue/eslint-config-typescript'
import gitignore from 'eslint-config-flat-gitignore'
import perfectionist from 'eslint-plugin-perfectionist'
import pluginVue from 'eslint-plugin-vue'
import { fileURLToPath, URL } from 'node:url'

configureVueProject({ scriptLangs: ['ts', 'js'] })

export function createConfig(metaUrl: string) {
  const tsconfigRootDir = fileURLToPath(new URL('.', metaUrl))

  return defineConfigWithVueTs(
    gitignore(),
    {
      name: 'app/files-to-lint',
      files: ['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs,vue}']
    },
    js.configs.recommended,
    pluginVue.configs['flat/essential'],
    vueTsConfigs.recommended,
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
}
