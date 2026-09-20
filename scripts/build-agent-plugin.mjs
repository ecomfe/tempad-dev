import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = join(root, 'agent-plugin/src')
const targetRoot = join(root, 'agent-plugin/targets')
const devRoot = join(root, '.dev/plugins/tempad-dev-dev')
const devName = 'tempad-dev-dev'
const devMaxAssetStoreBytes = 1024 * 1024 * 1024
const pluginSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'

const manifest = readJson(join(srcRoot, 'plugin.json'))
const portableMcp = readJson(join(srcRoot, 'mcp.json'))
const codexInterface = readJson(join(srcRoot, 'clients/codex/interface.json'))

if (manifest.$schema !== pluginSchema) {
  throw new Error(`Unsupported Agent Plugins manifest schema: ${String(manifest.$schema)}`)
}
if (portableMcp.$schema !== mcpSchema) {
  throw new Error(`Unsupported Agent Plugins MCP schema: ${String(portableMcp.$schema)}`)
}

rmSync(targetRoot, { force: true, recursive: true })
buildStandard()
buildHost(join(targetRoot, 'plugins-cli'), (target) =>
  writeJson(join(target, '.plugin/plugin.json'), sharedManifestFields(manifest))
)
buildHost(join(targetRoot, 'codex'), (target) =>
  writeCodexManifest(target, manifest, codexInterface)
)
buildHost(join(targetRoot, 'claude'), (target) => writeClaudeManifest(target, manifest))
const marketplaces = syncMarketplaces()
buildDev(marketplaces)

console.log(
  [
    `Built agent plugin from ${relative(root, srcRoot)}:`,
    ...['standard', 'plugins-cli', 'codex', 'claude'].map(
      (target) => `  ${target.padEnd(9)} ${relative(root, join(targetRoot, target))}`
    ),
    `  dev       ${relative(root, devRoot)}`
  ].join('\n')
)

/**
 * Agent Plugins 1.0 package and standalone skills URL. The current `plugins` CLI reads the
 * separate compatibility target's `.plugin/plugin.json` and `.mcp.json` instead.
 */
function buildStandard() {
  const target = join(targetRoot, 'standard')
  stageSharedContent(target)
  writeJson(join(target, 'plugin.json'), manifest)
  writeJson(join(target, 'mcp.json'), portableMcp)
}

/** Codex marketplace manifest. Codex binds tasks over native IPC and registers no hooks. */
function writeCodexManifest(target, pluginManifest, interfaceMetadata) {
  writeJson(join(target, '.codex-plugin/plugin.json'), {
    ...sharedManifestFields(pluginManifest),
    skills: './skills/',
    interface: interfaceMetadata,
    mcpServers: './.mcp.json'
  })
}

/** Claude marketplace manifest. Only Claude loads lifecycle hooks, so only it carries `clients/`. */
function writeClaudeManifest(target, pluginManifest) {
  cpSync(join(srcRoot, 'clients/claude'), join(target, 'clients/claude'), { recursive: true })
  cpSync(join(srcRoot, 'clients/shared'), join(target, 'clients/shared'), { recursive: true })
  writeJson(join(target, '.claude-plugin/plugin.json'), {
    ...sharedManifestFields(pluginManifest),
    skills: './skills/',
    hooks: './clients/claude/hooks.json',
    mcpServers: './.mcp.json'
  })
}

/** A host package: shared content, the host's own manifest, and the MCP config it points at. */
function buildHost(target, writeManifest, mcpConfig = hostMcpConfig(portableMcp)) {
  stageSharedContent(target)
  writeManifest(target)
  writeJson(join(target, '.mcp.json'), mcpConfig)
}

/** Ignored checkout runtime package, installable from either native host during development. */
function buildDev(marketplaces) {
  const devManifest = {
    ...manifest,
    name: devName,
    version: `${String(manifest.version).split('+', 1)[0]}+codex.${cachebuster()}`,
    description: `Development build. ${manifest.description}`
  }
  rmSync(devRoot, { force: true, recursive: true })
  buildHost(
    devRoot,
    (target) => {
      writeCodexManifest(target, devManifest, {
        ...codexInterface,
        displayName: 'TemPad Dev (Dev)'
      })
      writeClaudeManifest(target, devManifest)
    },
    {
      mcpServers: {
        [devName]: {
          command: 'node',
          args: [join(root, 'packages/mcp-server/dist/cli.mjs')],
          env: {
            TEMPAD_MCP_DEV_CHECKOUT: root,
            TEMPAD_MCP_MAX_ASSET_STORE_BYTES: String(devMaxAssetStoreBytes)
          }
        }
      }
    }
  )

  const codexMarketplace = structuredClone(marketplaces.codex)
  codexMarketplace.name = devName
  codexMarketplace.interface.displayName = 'TemPad Dev (Dev)'
  codexMarketplace.plugins[0].name = devName
  codexMarketplace.plugins[0].source.path = `./plugins/${devName}`
  writeJson(join(root, '.dev/.agents/plugins/marketplace.json'), codexMarketplace)

  const claudeMarketplace = structuredClone(marketplaces.claude)
  claudeMarketplace.name = devName
  claudeMarketplace.description = `Development build. ${claudeMarketplace.description}`
  claudeMarketplace.plugins[0].name = devName
  claudeMarketplace.plugins[0].source = `./plugins/${devName}`
  claudeMarketplace.plugins[0].description = `Development build. ${claudeMarketplace.plugins[0].description}`
  writeJson(join(root, '.dev/.claude-plugin/marketplace.json'), claudeMarketplace)
}

/** Content every target carries verbatim. */
function stageSharedContent(target) {
  mkdirSync(target, { recursive: true })
  for (const name of ['README.md', 'README.zh-Hans.md', 'CHANGELOG.md']) {
    cpSync(join(srcRoot, name), join(target, name))
  }
  cpSync(join(srcRoot, 'skills'), join(target, 'skills'), { recursive: true })
  cpSync(join(srcRoot, 'assets'), join(target, 'assets'), { recursive: true })
  cpSync(join(root, 'packages/extension/public/icon-128.png'), join(target, 'assets/icon.png'))
  // Each skill shows the plugin mark in host skill pickers.
  for (const skill of readdirSync(join(srcRoot, 'skills'), { withFileTypes: true })) {
    if (skill.isDirectory()) {
      cpSync(
        join(srcRoot, 'assets/icon-padded.svg'),
        join(target, 'skills', skill.name, 'assets/icon.svg')
      )
    }
  }
}

function sharedManifestFields({
  name,
  version,
  description,
  author,
  homepage,
  repository,
  license,
  keywords
}) {
  return { name, version, description, author, homepage, repository, license, keywords }
}

function syncMarketplaces() {
  // The plugins CLI checks this before the Claude marketplace. Keep its consumers on a
  // hook-free compatibility package without changing either native host's source.
  writeJson(join(root, '.plugin/marketplace.json'), {
    name: manifest.name,
    owner: manifest.author,
    plugins: [
      {
        name: manifest.name,
        source: `./${relative(root, join(targetRoot, 'plugins-cli'))}`,
        description: manifest.description
      }
    ]
  })
  const codexMarketplacePath = join(root, '.agents/plugins/marketplace.json')
  const codexMarketplace = readJson(codexMarketplacePath)
  codexMarketplace.plugins[0].name = manifest.name
  codexMarketplace.plugins[0].source.path = `./${relative(root, join(targetRoot, 'codex'))}`
  writeJson(codexMarketplacePath, codexMarketplace)

  const claudeMarketplacePath = join(root, '.claude-plugin/marketplace.json')
  const claudeMarketplace = readJson(claudeMarketplacePath)
  claudeMarketplace.plugins[0].name = manifest.name
  claudeMarketplace.plugins[0].source = `./${relative(root, join(targetRoot, 'claude'))}`
  claudeMarketplace.plugins[0].description = manifest.description
  writeJson(claudeMarketplacePath, claudeMarketplace)

  return { claude: claudeMarketplace, codex: codexMarketplace }
}

/** Host `.mcp.json` omits the portable `type` discriminator. */
function hostMcpConfig(portable) {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(portable.mcpServers ?? {}).map(([name, server]) => {
        if (server.type !== 'stdio') {
          throw new Error(`Host compatibility only supports stdio MCP servers: ${name}`)
        }
        const { type: _type, ...hostServer } = server
        return [name, hostServer]
      })
    )
  }
}

function cachebuster() {
  return new Date()
    .toISOString()
    .replaceAll(/[-:TZ.]/g, '')
    .slice(0, 14)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
