import vue from '@vitejs/plugin-vue'
import { marked } from 'marked'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
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

function collectTocEntries(markdown: string): readonly TocEntry[] {
  const slugCounts = new Map<string, number>()
  let isInFence = false

  return markdown.split('\n').flatMap((line) => {
    if (line.startsWith('```')) {
      isInFence = !isInFence
      return []
    }

    if (isInFence) {
      return []
    }

    const match = line.match(/^(##)\s+(.+?)\s*$/)

    if (!match) {
      return []
    }

    const depth = match[1]?.length
    const text = normalizeHeadingText(match[2] ?? '')

    if (!depth || !text) {
      return []
    }

    return [
      {
        depth,
        id: slugifyHeading(text, slugCounts),
        text
      }
    ]
  })
}

function normalizeHeadingText(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
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

function injectHeadingIds(html: string, tocEntries: readonly TocEntry[]): string {
  let tocIndex = 0

  return html.replace(/<h([2-4])>/g, (match, rawLevel) => {
    const level = Number(rawLevel)
    const entry = tocEntries[tocIndex]

    if (!entry || entry.depth !== level) {
      return match
    }

    tocIndex += 1

    return `<h${rawLevel} id="${entry.id}">`
  })
}

function renderSkillPreviewHtml(markdown: string, tocEntries: readonly TocEntry[]): string {
  return injectHeadingIds(String(marked.parse(markdown)), tocEntries).replace(
    /<a\s+/g,
    '<a target="_blank" rel="noopener noreferrer" '
  )
}

function skillPreviewPlugin() {
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
      const toc = collectTocEntries(body)
      const html = renderSkillPreviewHtml(body, toc)

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
