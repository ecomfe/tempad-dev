import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { resolveCodexExecutable } from './agent-authoring-runtime-preflight'
import {
  devPluginName,
  parseReinstallArguments,
  reinstallDevPlugin,
  resolveDevPluginVersion
} from './reinstall-codex-dev-plugin-runtime'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const pluginRoot = join(repoRoot, '.dev/plugins/tempad-dev-dev')

async function main(): Promise<void> {
  const args = parseReinstallArguments(process.argv.slice(2))
  if (!args) {
    console.log(
      [
        'Reinstall TemPad Dev (Dev) using the Codex plugin CLI:',
        '',
        '  pnpm agent-plugin:reinstall [version] [--app-path <path>] [--timeout-ms <number>]',
        '',
        'Version defaults to the generated development plugin manifest.',
        'On macOS, --app-path selects the bundled CLI (CODEX_APP_PATH or /Applications/ChatGPT.app by default).',
        'Each CLI command has a 60000 ms timeout by default.',
        'No remote debugging or app restart is needed. Use a new task after installation.'
      ].join('\n')
    )
    return
  }
  const version = resolveDevPluginVersion(
    JSON.parse(await readFile(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8')),
    args.version
  )
  const marketplace = JSON.parse(
    await readFile(join(repoRoot, '.dev/.agents/plugins/marketplace.json'), 'utf8')
  ) as { name?: string }
  if (marketplace.name !== devPluginName)
    throw new Error('Unexpected generated development marketplace name.')
  const executable = resolveCodexExecutable(args.appPath)
  if (isAbsolute(executable)) await access(executable)
  console.log(`Installing TemPad Dev (Dev) ${version} using ${executable}...`)
  const installedPath = await reinstallDevPlugin(
    async (command) => {
      const { stdout } = await execFileAsync(executable, command, {
        encoding: 'utf8',
        timeout: args.timeoutMs,
        maxBuffer: 16 * 1024 * 1024
      })
      return JSON.parse(stdout) as unknown
    },
    pluginRoot,
    version
  )
  console.log(`Verified enabled plugin ${version} at ${installedPath}.`)
  console.log(
    'Use a new Codex task to load the updated skills and tools. Existing MCP processes are not refreshed by this install; run pnpm agent-eval:preflight before live authoring.'
  )
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
