import commentMark from 'comment-mark'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface PluginMeta {
  name: string
  description: string
  author: string
  source: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const readmePath = resolve(__dirname, '../README.md')
const pluginsPath = resolve(__dirname, '../plugins/available-plugins.json')

const readme = readFileSync(readmePath, 'utf-8')
const plugins = JSON.parse(readFileSync(pluginsPath, 'utf-8')) as PluginMeta[]

function getDomain(url: string) {
  try {
    const { hostname } = new URL(url)
    return hostname
  } catch (error) {
    console.error('Invalid URL:', url)
    return null
  }
}

function generatePluginTable(plugins: PluginMeta[]) {
  return `| Name | Description | Author | Source |
| -- | -- | -- | -- |
${plugins
  .map(
    ({ name, description, author, source }) =>
      `| \`@${name}\` | ${description} | ${author} | [${getDomain(source) ?? 'URL'}](${source}) |`
  )
  .join('\n')}`
}

writeFileSync(
  readmePath,
  commentMark(readme, {
    availablePlugins: generatePluginTable(plugins)
  }),
  'utf-8'
)
