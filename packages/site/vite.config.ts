import vue from '@vitejs/plugin-vue'
import { marked } from 'marked'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { parse as parseYaml } from 'yaml'

type FrontmatterEntry = {
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

function flattenFrontmatterEntries(value: unknown, parentKey = ''): readonly FrontmatterEntry[] {
  if (value == null) {
    return parentKey ? [{ key: parentKey, value: 'null' }] : []
  }

  if (Array.isArray(value)) {
    if (!parentKey) {
      return value.flatMap((entry) => flattenFrontmatterEntries(entry))
    }

    if (value.every((entry) => !isPlainRecord(entry) && !Array.isArray(entry))) {
      return [{ key: parentKey, value: value.map(formatFrontmatterValue).join('\n') }]
    }

    return value.flatMap((entry, index) =>
      flattenFrontmatterEntries(entry, `${parentKey}[${index}]`)
    )
  }

  if (isPlainRecord(value)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      flattenFrontmatterEntries(entry, parentKey ? `${parentKey}.${key}` : key)
    )
  }

  return parentKey ? [{ key: parentKey, value: formatFrontmatterValue(value) }] : []
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatFrontmatterValue(value: unknown): string {
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

  return count === 0 ? base : `${base}-${count + 1}`
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

function renderSkillPreview(markdown: string): { html: string; toc: readonly TocEntry[] } {
  const slugCounts = new Map<string, number>()
  const toc: TocEntry[] = []
  const renderer = new marked.Renderer()
  const renderLink = renderer.link.bind(renderer)

  renderer.heading = function (token) {
    const inlineTokens = token.tokens ?? []
    const text = extractHeadingText(inlineTokens)
    const content = this.parser.parseInline(inlineTokens)

    if (token.depth !== 2 || !text) {
      return renderHeadingHtml(token.depth, content)
    }

    const id = slugifyHeading(text, slugCounts)
    const entry = { depth: token.depth, id, text }
    toc.push(entry)

    return renderHeadingHtml(token.depth, content, id)
  }

  renderer.link = function (token) {
    return addExternalLinkAttributes(renderLink(token))
  }

  const tokens = marked.lexer(markdown)
  const html = String(marked.parser(tokens, { renderer }))
  return { html, toc }
}

function skillPreviewPlugin(): Plugin {
  return {
    name: 'skill-preview',
    async load(id: string) {
      if (!id.endsWith('?skill-preview')) {
        return null
      }

      const filePath = id.slice(0, -'?skill-preview'.length)
      const source = await readFile(filePath, 'utf8')
      const { frontmatter, body } = splitFrontmatter(source)
      const frontmatterEntries = frontmatter.trim()
        ? flattenFrontmatterEntries(parseYaml(frontmatter))
        : []
      const { toc, html } = renderSkillPreview(body)

      return `export default ${JSON.stringify({ frontmatterEntries, html, toc })}`
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), skillPreviewPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
