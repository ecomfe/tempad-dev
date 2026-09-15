import { normalize, resolve } from 'node:path'

export const devPluginName = 'tempad-dev-dev'
export const devPluginId = `${devPluginName}@${devPluginName}`

export type ReinstallArguments = {
  appPath?: string
  timeoutMs: number
  version?: string
}

export function parseReinstallArguments(argv: string[]): ReinstallArguments | null {
  if (argv.includes('--help')) return null
  const args: ReinstallArguments = { timeoutMs: 60_000 }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--app-path' || argument === '--timeout-ms') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`)
      if (argument === '--app-path') args.appPath = value
      else {
        args.timeoutMs = Number(value)
        if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs <= 0) {
          throw new Error(`Invalid --timeout-ms value: ${value}`)
        }
      }
    } else {
      if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`)
      if (args.version) throw new Error(`Unexpected positional argument: ${argument}`)
      args.version = argument
    }
  }
  return args
}

export function resolveDevPluginVersion(input: unknown, requested?: string): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Generated development plugin manifest must be an object.')
  }
  const manifest = input as Record<string, unknown>
  if (manifest.name !== 'tempad-dev-dev' || typeof manifest.version !== 'string') {
    throw new Error('Generated development plugin manifest has an unexpected identity.')
  }
  if (requested && requested !== manifest.version) {
    throw new Error(
      `Generated plugin version is ${manifest.version}, not ${requested}. ` +
        'Run pnpm agent-plugin:dev, then omit the version or pass the generated value.'
    )
  }
  return manifest.version
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object from the Codex plugin CLI.')
  }
  return value as Record<string, unknown>
}

function assertLocalPlugin(entry: Record<string, unknown>, pluginRoot: string): void {
  const source = objectValue(entry.source)
  const marketplace = objectValue(entry.marketplaceSource)
  if (
    entry.name !== devPluginName ||
    entry.marketplaceName !== devPluginName ||
    source.source !== 'local' ||
    typeof source.path !== 'string' ||
    normalize(source.path) !== normalize(pluginRoot) ||
    marketplace.sourceType !== 'local' ||
    typeof marketplace.source !== 'string' ||
    normalize(marketplace.source) !== resolve(pluginRoot, '../..')
  ) {
    throw new Error(
      'The configured development marketplace must point at this checkout’s local generated plugin.'
    )
  }
}

export async function reinstallDevPlugin(
  runCodex: (args: string[]) => Promise<unknown>,
  pluginRoot: string,
  version: string
): Promise<string> {
  const listed = objectValue(
    await runCodex(['plugin', 'list', '--available', '--json', '--marketplace', devPluginName])
  )
  if (!Array.isArray(listed.installed) || !Array.isArray(listed.available)) {
    throw new Error('Codex did not return installed and available plugin lists.')
  }
  const candidates = [...listed.installed, ...listed.available]
    .map(objectValue)
    .filter((entry) => entry.pluginId === devPluginId)
  if (candidates.length !== 1) {
    throw new Error('Expected exactly one development plugin in the configured local marketplace.')
  }
  assertLocalPlugin(candidates[0]!, pluginRoot)

  const added = objectValue(await runCodex(['plugin', 'add', devPluginId, '--json']))
  if (
    added.pluginId !== devPluginId ||
    added.version !== version ||
    typeof added.installedPath !== 'string'
  ) {
    throw new Error(`Codex did not confirm installation of ${devPluginId} ${version}.`)
  }
  const verified = objectValue(
    await runCodex(['plugin', 'list', '--json', '--marketplace', devPluginName])
  )
  if (!Array.isArray(verified.installed)) throw new Error('Codex did not return installed plugins.')
  const installed = verified.installed
    .map(objectValue)
    .filter((entry) => entry.pluginId === devPluginId)
  if (installed.length !== 1)
    throw new Error('Codex did not report exactly one installed development plugin.')
  const entry = installed[0]!
  assertLocalPlugin(entry, pluginRoot)
  if (entry.installed !== true || entry.enabled !== true || entry.version !== version) {
    throw new Error(`The installed development plugin is not enabled at version ${version}.`)
  }
  return added.installedPath
}
