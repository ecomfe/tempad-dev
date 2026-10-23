import { parseSync, stringify, type INode } from 'svgson'

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"'
}
const TEXT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\r': '&#13;'
}

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000
    )
      continue
    throw new Error('SVG XML contains invalid characters.')
  }
}

function preserveWhitespace(value: string): string {
  // svgson drops text nodes whose entire value is JavaScript whitespace.
  return value.trim() ? value : value.replace(/\s/g, (character) => `&#${character.charCodeAt(0)};`)
}

function escapeText(value: string): string {
  return preserveWhitespace(value.replace(/[&<>\r]/g, (character) => TEXT_ESCAPES[character]!))
}

function decodeEntities(value: string): string {
  const decoded = value.replace(
    /&(#x[\dA-Fa-f]+|#\d+|amp|apos|gt|lt|quot);|&/g,
    (_match, reference: string | undefined) => {
      if (!reference) throw new Error('SVG XML contains an unsupported or malformed reference.')
      if (!reference.startsWith('#')) return XML_ENTITIES[reference]!
      const hex = reference.startsWith('#x')
      const codePoint = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (codePoint > 0x10ffff) throw new Error('SVG XML contains an invalid character reference.')
      return String.fromCodePoint(codePoint)
    }
  )
  assertXmlCharacters(decoded)
  return decoded
}

export function parseSvgXml(source: string): INode {
  assertXmlCharacters(source)
  // svgson does not distinguish CDATA from encoded text. Escape it before parsing
  // so both can be decoded once. Keep tags/quoted attributes opaque, discard
  // complete comments, and preserve internal whitespace without encoding prologs.
  let depth = 0
  const normalized = source
    .replace(/\r\n?/g, '\n')
    .replace(
      /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[([\s\S]*?)(?:\]\]>|$)|<(?:"[^"]*"|'[^']*'|[^'"><])*>|[^<]+/g,
      (token, cdata: string | undefined) => {
        if (token.startsWith('<!--')) {
          if (!token.endsWith('-->')) throw new Error('SVG XML contains an unclosed comment.')
          return ''
        }
        if (cdata !== undefined) {
          if (!token.endsWith(']]>')) throw new Error('SVG XML contains unclosed CDATA.')
          return escapeText(cdata)
        }
        if (!token.startsWith('<')) return depth > 0 ? preserveWhitespace(token) : token
        if (token.startsWith('</')) depth -= 1
        else if (!token.startsWith('<?') && !token.startsWith('<!') && !token.endsWith('/>'))
          depth += 1
        return token
      }
    )
  const root = parseSync(normalized)
  if (Array.isArray(root)) throw new Error('SVG XML requires exactly one document root.')
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()!
    node.attributes = Object.fromEntries(
      Object.entries(node.attributes).map(([name, value]) => [
        name,
        decodeEntities(value.replace(/[\t\n]/g, ' '))
      ])
    )
    if (node.type === 'text') node.value = decodeEntities(node.value)
    for (const child of node.children) pending.push(child)
  }
  return root
}

export function stringifySvgXml(root: INode): string {
  const texts: string[] = []
  const serialized = stringify(root, {
    transformNode(node) {
      if (node.type !== 'text') return node
      // Valid XML cannot contain NUL, making these placeholders collision-free.
      const index = texts.push(escapeText(node.value)) - 1
      return { ...node, value: `\0${index}\0` }
    },
    transformAttr(name, value, escape) {
      const escaped = escape(value).replace(
        /[\t\n\r]/g,
        (character) => `&#${character.charCodeAt(0)};`
      )
      return `${name}="${escaped}"`
    }
  })
  // svgson's text serializer only escapes the first CDATA closing sequence.
  return serialized.replace(/\0(\d+)\0/g, (_match, index: string) => texts[Number(index)]!)
}
