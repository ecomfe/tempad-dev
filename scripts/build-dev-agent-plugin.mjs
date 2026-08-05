import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const agentPluginRoot = join(root, 'agent-plugins/tempad-dev')
const devMarketplaceRoot = join(root, '.dev')
const devAgentPluginRoot = join(devMarketplaceRoot, 'plugins/tempad-dev-dev')
const devName = 'tempad-dev-dev'

syncAgentPluginSource()
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

  const codexManifest = readJson(join(devAgentPluginRoot, '.codex-plugin/plugin.json'))
  const cachebuster = new Date()
    .toISOString()
    .replaceAll(/[-:TZ.]/g, '')
    .slice(0, 14)
  const devVersion = `${String(codexManifest.version).split('+', 1)[0]}+codex.${cachebuster}`
  for (const manifestPath of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    const path = join(devAgentPluginRoot, manifestPath)
    const manifest = readJson(path)
    manifest.name = devName
    manifest.version = devVersion
    manifest.description = `Development build. ${manifest.description}`
    if (manifest.interface) manifest.interface.displayName = 'TemPad Dev (Dev)'
    writeJson(path, manifest)
  }

  writeJson(join(devAgentPluginRoot, '.mcp.json'), {
    mcpServers: {
      [devName]: {
        command: 'node',
        args: [join(root, 'packages/mcp-server/dist/cli.mjs')]
      }
    }
  })

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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
