import { marked } from 'marked'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

export type MetadataEntry = {
  key: string
  value: string
}

type TocEntry = {
  depth: number
  id: string
  text: string
}

const tocTextParser = new marked.Parser()
const tocTextRenderer = new marked.TextRenderer()
type InlineTokens = Parameters<typeof tocTextParser.parseInline>[0]

tocTextRenderer.html = function (): string {
  return ''
}

function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  const normalized = source.replace(/\r\n/g, '\n').trim()

  if (!normalized.startsWith('---\n')) {
    return { frontmatter: '', body: normalized }
  }

  const end = normalized.indexOf('\n---\n', 4)

  if (end < 0) {
    return { frontmatter: '', body: normalized }
  }

  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 5).trim()
  }
}

const PREFERRED_METADATA_KEYS = new Map([
  ['name', 0],
  ['version', 1],
  ['description', 2]
])

function flattenMetadataEntries(value: unknown, parentKey = ''): readonly MetadataEntry[] {
  if (value == null) {
    return parentKey ? [{ key: parentKey, value: 'null' }] : []
  }

  if (Array.isArray(value)) {
    if (!parentKey) {
      return value.flatMap((entry) => flattenMetadataEntries(entry))
    }

    if (value.some((entry) => isPlainRecord(entry) || Array.isArray(entry))) {
      return value.flatMap((entry, index) =>
        flattenMetadataEntries(entry, `${parentKey}[${index}]`)
      )
    }

    return [{ key: parentKey, value: value.map(formatMetadataValue).join('\n') }]
  }

  if (!isPlainRecord(value)) {
    return parentKey ? [{ key: parentKey, value: formatMetadataValue(value) }] : []
  }

  return Object.entries(value).flatMap(([key, entry]) =>
    flattenMetadataEntries(
      entry,
      !parentKey && key === 'metadata' ? '' : joinMetadataKey(parentKey, key)
    )
  )
}

function orderMetadataEntries(entries: readonly MetadataEntry[]): readonly MetadataEntry[] {
  return [...entries].sort((left, right) => {
    const leftPriority = PREFERRED_METADATA_KEYS.get(left.key) ?? Number.MAX_SAFE_INTEGER
    const rightPriority = PREFERRED_METADATA_KEYS.get(right.key) ?? Number.MAX_SAFE_INTEGER
    return leftPriority - rightPriority
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function joinMetadataKey(parentKey: string, key: string): string {
  return parentKey ? `${parentKey}.${key}` : key
}

function formatMetadataValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value)
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function extractHeadingText(tokens: InlineTokens): string {
  return normalizeHeadingText(tocTextParser.parseInline(tokens, tocTextRenderer))
}

function slugifyHeading(value: string, slugCounts: Map<string, number>): string {
  const base =
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-') || 'section'

  const count = slugCounts.get(base) ?? 0
  slugCounts.set(base, count + 1)

  return count === 0 ? base : `${base}-${count}`
}

function renderHeadingHtml(depth: number, content: string, id?: string): string {
  if (!id) {
    return `<h${depth}>${content}</h${depth}>\n`
  }

  return `<h${depth} id="${id}">${content}</h${depth}>\n`
}

function addExternalLinkAttributes(html: string): string {
  if (!html.startsWith('<a ')) {
    return html
  }

  return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ')
}

export function renderSkillPreview(
  markdown: string,
  sourceUrl: string,
  files: ReadonlyMap<string, string> = new Map()
): { html: string; toc: readonly TocEntry[] } {
  const slugCounts = new Map<string, number>()
  const toc: TocEntry[] = []
  const renderer = new marked.Renderer()
  const renderLink = renderer.link.bind(renderer)

  renderer.heading = function (token) {
    const inlineTokens = token.tokens ?? []
    const text = extractHeadingText(inlineTokens)
    const content = this.parser.parseInline(inlineTokens)

    if (!text) return renderHeadingHtml(token.depth, content)

    const id = slugifyHeading(text, slugCounts)
    const entry = { depth: token.depth, id, text }
    if (token.depth === 2) toc.push(entry)

    return renderHeadingHtml(token.depth, content, id)
  }

  renderer.link = function (token) {
    const target = new URL(token.href, sourceUrl)
    const anchor = target.hash
    target.hash = ''
    const file = files.get(target.href)
    const html = renderLink({ ...token, href: target.href + anchor })
    if (file) {
      return html.replace(
        '<a ',
        `<a data-skill-file="${escapeAttribute(file)}" data-skill-anchor="${escapeAttribute(anchor)}" `
      )
    }
    return addExternalLinkAttributes(html)
  }

  const tokens = marked.lexer(markdown)
  const html = String(marked.parser(tokens, { renderer }))
  return { html, toc }
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

async function markdownPaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return markdownPaths(path)
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
    })
  )
  return paths.flat().sort()
}

export async function loadSkillPreview(entryPath: string, watchFile: (path: string) => void) {
  const root = dirname(entryPath)
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const paths = await markdownPaths(root)
  const sourceUrl = (path: string) =>
    `https://github.com/ecomfe/tempad-dev/blob/main/${relative(repoRoot, path).replaceAll('\\', '/')}`
  const localPath = (path: string) => relative(root, path).replaceAll('\\', '/')
  const fileUrls = new Map(paths.map((path) => [sourceUrl(path), localPath(path)]))
  const files = await Promise.all(
    paths.map(async (path) => {
      watchFile(path)
      const source = await readFile(path, 'utf8')
      const { frontmatter, body } = splitFrontmatter(source)
      const metadataEntries = frontmatter.trim()
        ? orderMetadataEntries(flattenMetadataEntries(parseYaml(frontmatter)))
        : []
      return {
        path: localPath(path),
        sourceUrl: sourceUrl(path),
        source,
        metadataEntries,
        ...renderSkillPreview(body, sourceUrl(path), fileUrls)
      }
    })
  )
  return { entry: localPath(entryPath), files }
}
