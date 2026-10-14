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
  const typedRuntimeFiles = [
    'packages/{mcp-server,shared,plugins}/src/**/*.ts',
    'src/**/*.{ts,vue}',
    'mcp/**/*.ts',
    'components/**/*.vue',
    'composables/**/*.ts',
    'utils/**/*.ts',
    'codegen/**/*.ts',
    'entrypoints/**/*.{ts,vue}',
    'ui/**/*.ts',
    'rewrite/**/*.ts',
    'plugin-sandbox/**/*.ts',
    'worker/**/*.ts'
  ]

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
    },
    {
      name: 'app/typed-promises',
      files: typedRuntimeFiles,
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir } },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error'
      }
    },
    {
      // Vue's helper enables project service for all TS files; keep it scoped to runtime code.
      name: 'app/untyped-tooling',
      files: ['**/*.{ts,tsx,mts,cts}'],
      ignores: typedRuntimeFiles,
      languageOptions: { parserOptions: { projectService: false } }
    }
  )
}
