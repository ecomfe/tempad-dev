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

function getVendor(url: string): string | null {
  // Check for GitHub raw file URL
  if (url.includes('raw.githubusercontent.com')) {
    return 'GitHub'
  }

  // Check for GitHub Gist raw file URL
  if (url.includes('gist.githubusercontent.com')) {
    return 'GitHub Gist'
  }

  // Check for Bitbucket raw file URL
  if (url.includes('bitbucket.org') && url.includes('/raw/')) {
    return 'Bitbucket'
  }

  // Check for GitLab raw file URL
  if (url.includes('gitlab.com') && url.includes('/-/raw/')) {
    return 'GitLab'
  }

  // Check for SourceForge raw file URL
  if (url.includes('sourceforge.net') && url.includes('/files/')) {
    return 'SourceForge'
  }

  // Check for AWS S3 URL
  if (url.includes('s3.amazonaws.com')) {
    return 'AWS S3'
  }

  // Check for Azure Blob Storage URL
  if (url.includes('blob.core.windows.net')) {
    return 'Azure Blob Storage'
  }

  // Check for Google Cloud Storage URL
  if (url.includes('storage.googleapis.com')) {
    return 'Google Cloud Storage'
  }

  // If no vendor is found
  return getDomain(url)
}

function generatePluginTable(plugins: PluginMeta[]) {
  return `| Name | Description | Author | Source |
| -- | -- | -- | -- |
${plugins
  .map(
    ({ name, description, author, source }) =>
      `| \`@${name}\` | ${description} | ${author} | [${getVendor(source) ?? 'URL'}](${source}) |`
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
