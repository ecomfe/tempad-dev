import commentMark from 'comment-mark'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Vendor {
  name: string
  icon: string
}

const vendorDomainMap: Record<string, Vendor> = {
  'raw.githubusercontent.com': {
    name: 'GitHub',
    icon: 'github'
  },
  'gist.githubusercontent.com': {
    name: 'GitHub Gist',
    icon: 'github'
  },
  'gitlab.com': {
    name: 'GitLab',
    icon: 'gitlab'
  }
}

interface PluginMeta {
  name: string
  description: string
  author: string
  repo: string
  url: string
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

function getVendor(url: string): Vendor | string | null {
  const domain = getDomain(url)

  if (!domain) {
    return null
  }

  const vendor = vendorDomainMap[domain]

  return vendor || domain
}

function generatePluginTable(plugins: PluginMeta[]) {
  return `| Plugin name | Description | Author | Repository |
| -- | -- | -- | -- |
${plugins
  .map(({ name, description, author, repo, url }) => {
    const vendor = getVendor(url)
    const link = vendor
      ? typeof vendor === 'string'
        ? `[${vendor}](${repo})`
        : `<img alt="${vendor.name}" src="https://simpleicons.org/icons/${vendor.icon}.svg" width="12" height="12"> [${vendor.name}](${repo})`
      : ''

    return `| \`@${name}\` | ${description} | [${author}](https://github.com/${author}) | ${link} |`
  })
  .join('\n')}`
}

writeFileSync(
  readmePath,
  commentMark(readme, {
    availablePlugins: generatePluginTable(plugins)
  }),
  'utf-8'
)
