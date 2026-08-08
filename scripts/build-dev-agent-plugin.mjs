import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const agentPluginRoot = join(root, 'agent-plugins/tempad-dev')
const devMarketplaceRoot = join(root, '.dev')
const devAgentPluginRoot = join(devMarketplaceRoot, 'plugins/tempad-dev-dev')
const devName = 'tempad-dev-dev'
const pluginSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'

syncAgentPluginSource()
syncClientCompatibility(agentPluginRoot)
syncMarketplaceCompatibility()
buildDevAgentPlugin()

console.log(`Built development agent plugin at ${relative(root, devAgentPluginRoot)}.`)

function syncAgentPluginSource() {
  const skillRoot = join(agentPluginRoot, 'skills/figma-design-to-code')
  rmSync(skillRoot, { force: true, recursive: true })
  cpSync(join(root, 'skill'), skillRoot, { recursive: true })

  cpSync(
    join(root, 'packages/extension/public/icon-128.png'),
    join(agentPluginRoot, 'assets/icon.png')
  )
  cpSync(
    join(agentPluginRoot, 'assets/icon-padded.svg'),
    join(agentPluginRoot, 'skills/figma-canvas-authoring/assets/icon.svg')
  )
}

function buildDevAgentPlugin() {
  rmSync(devAgentPluginRoot, { force: true, recursive: true })
  cpSync(agentPluginRoot, devAgentPluginRoot, { recursive: true })

  const manifestPath = join(devAgentPluginRoot, 'plugin.json')
  const manifest = readJson(manifestPath)
  const cachebuster = new Date()
    .toISOString()
    .replaceAll(/[-:TZ.]/g, '')
    .slice(0, 14)
  manifest.name = devName
  manifest.version = `${String(manifest.version).split('+', 1)[0]}+codex.${cachebuster}`
  manifest.description = `Development build. ${manifest.description}`
  writeJson(manifestPath, manifest)

  writeJson(join(devAgentPluginRoot, 'mcp.json'), {
    $schema: mcpSchema,
    mcpServers: {
      [devName]: {
        type: 'stdio',
        command: 'node',
        args: [join(root, 'packages/mcp-server/dist/cli.mjs')]
      }
    }
  })
  syncClientCompatibility(devAgentPluginRoot, { displayName: 'TemPad Dev (Dev)' })

  const marketplace = readJson(join(root, '.agents/plugins/marketplace.json'))
  marketplace.name = devName
  marketplace.interface.displayName = 'TemPad Dev (Dev)'
  marketplace.plugins[0].name = devName
  marketplace.plugins[0].source.path = `./plugins/${devName}`
  writeJson(join(devMarketplaceRoot, '.agents/plugins/marketplace.json'), marketplace)

  const claudeMarketplace = readJson(join(root, '.claude-plugin/marketplace.json'))
  claudeMarketplace.name = devName
  claudeMarketplace.description = `Development build. ${claudeMarketplace.description}`
  claudeMarketplace.plugins[0].name = devName
  claudeMarketplace.plugins[0].source = `./plugins/${devName}`
  claudeMarketplace.plugins[0].description = `Development build. ${claudeMarketplace.plugins[0].description}`
  writeJson(join(devMarketplaceRoot, '.claude-plugin/marketplace.json'), claudeMarketplace)
}

function syncClientCompatibility(pluginRoot, options = {}) {
  const manifest = readJson(join(pluginRoot, 'plugin.json'))
  const portableMcp = readJson(join(pluginRoot, 'mcp.json'))

  if (manifest.$schema !== pluginSchema) {
    throw new Error(`Unsupported Agent Plugins manifest schema: ${String(manifest.$schema)}`)
  }
  if (portableMcp.$schema !== mcpSchema) {
    throw new Error(`Unsupported Agent Plugins MCP schema: ${String(portableMcp.$schema)}`)
  }

  const { name, version, description, author, homepage, repository, license, keywords } = manifest
  const sharedManifest = {
    name,
    version,
    description,
    author,
    homepage,
    repository,
    license,
    keywords
  }
  const codexManifestPath = join(pluginRoot, '.codex-plugin/plugin.json')
  const codexManifest = readJson(codexManifestPath)
  const interfaceMetadata = {
    ...codexManifest.interface,
    ...(options.displayName ? { displayName: options.displayName } : {})
  }

  writeJson(codexManifestPath, {
    ...sharedManifest,
    skills: './skills/',
    interface: interfaceMetadata,
    mcpServers: './.mcp.json'
  })
  writeJson(join(pluginRoot, '.claude-plugin/plugin.json'), {
    ...sharedManifest,
    skills: './skills/',
    mcpServers: './.mcp.json'
  })
  writeJson(join(pluginRoot, '.mcp.json'), buildClientMcpConfig(portableMcp))
}

function syncMarketplaceCompatibility() {
  const manifest = readJson(join(agentPluginRoot, 'plugin.json'))
  const codexMarketplacePath = join(root, '.agents/plugins/marketplace.json')
  const codexMarketplace = readJson(codexMarketplacePath)
  codexMarketplace.plugins[0].name = manifest.name
  writeJson(codexMarketplacePath, codexMarketplace)

  const claudeMarketplacePath = join(root, '.claude-plugin/marketplace.json')
  const claudeMarketplace = readJson(claudeMarketplacePath)
  claudeMarketplace.plugins[0].name = manifest.name
  claudeMarketplace.plugins[0].description = manifest.description
  writeJson(claudeMarketplacePath, claudeMarketplace)
}

function buildClientMcpConfig(portableMcp) {
  const mcpServers = Object.fromEntries(
    Object.entries(portableMcp.mcpServers ?? {}).map(([name, server]) => {
      if (server.type !== 'stdio') {
        throw new Error(`Client compatibility only supports stdio MCP servers: ${name}`)
      }

      const clientServer = { ...server }
      delete clientServer.type
      return [name, clientServer]
    })
  )

  return { mcpServers }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
