import { MAX_CANVAS_DEPTH } from '@tempad-dev/shared'

export type CanvasMarkupElement = {
  attributes: Record<string, string>
  children: CanvasMarkupElement[]
  tag: string
  text: string
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"'
}

function htmlError(message: string): never {
  throw new Error(message)
}

function normalizeTag(tag: string): string {
  const normalized = tag.toLowerCase()
  return normalized === 'div' || normalized === 'span' ? normalized : tag
}

function decodeEntities(value: string): string {
  let result = ''
  let index = 0
  while (index < value.length) {
    if (value[index] !== '&') {
      result += value[index]
      index += 1
      continue
    }
    const end = value.indexOf(';', index + 1)
    if (end < 0) htmlError('HTML entities must end with ";".')
    const entity = value.slice(index + 1, end)
    if (Object.hasOwn(HTML_ENTITIES, entity)) {
      result += HTML_ENTITIES[entity]
    } else {
      const hex = entity.startsWith('#x') || entity.startsWith('#X')
      const digits = hex ? entity.slice(2) : entity.startsWith('#') ? entity.slice(1) : ''
      if (!digits || !(hex ? /^[\dA-Fa-f]+$/ : /^\d+$/).test(digits)) {
        htmlError(`Unsupported HTML entity "&${entity};".`)
      }
      const codePoint = Number.parseInt(digits, hex ? 16 : 10)
      if (
        !Number.isInteger(codePoint) ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        htmlError(`Invalid HTML character reference "&${entity};".`)
      }
      result += String.fromCodePoint(codePoint)
    }
    index = end + 1
  }
  return result
}

class CanvasHtmlParser {
  private index = 0

  constructor(private readonly source: string) {}

  parse(): CanvasMarkupElement {
    this.skipWhitespace()
    if (this.index >= this.source.length) htmlError('Canvas markup is empty.')
    const root = this.parseElement(1)
    this.skipWhitespace()
    if (this.index !== this.source.length) {
      htmlError('Canvas markup must contain exactly one root element.')
    }
    return root
  }

  private parseElement(depth: number): CanvasMarkupElement {
    if (depth > MAX_CANVAS_DEPTH) {
      htmlError(`Canvas markup may be at most ${MAX_CANVAS_DEPTH} levels deep.`)
    }
    this.expect('<')
    if (this.peek('/') || this.peek('!') || this.peek('?')) {
      htmlError('Unexpected closing tag, declaration, or processing instruction.')
    }
    const rawTag = this.readName()
    if (!rawTag) htmlError('Expected an element name.')
    const tag = normalizeTag(rawTag)
    const attributes: Record<string, string> = Object.create(null) as Record<string, string>
    let selfClosing = false
    while (true) {
      this.skipWhitespace()
      if (this.peek('>')) {
        this.index += 1
        break
      }
      if (this.peek('/>')) {
        this.index += 2
        selfClosing = true
        break
      }
      const name = this.readName()
      if (!name) htmlError(`Malformed attribute on <${tag}>.`)
      if (name in attributes) htmlError(`Duplicate attribute "${name}" on <${tag}>.`)
      this.skipWhitespace()
      this.expect('=')
      this.skipWhitespace()
      const quote = this.source[this.index]
      if (quote !== '"' && quote !== "'") {
        htmlError(`Attribute "${name}" must use a quoted value.`)
      }
      this.index += 1
      const end = this.source.indexOf(quote, this.index)
      if (end < 0) htmlError(`Attribute "${name}" has an unterminated value.`)
      attributes[name] = decodeEntities(this.source.slice(this.index, end))
      this.index = end + 1
    }
    if (selfClosing) return { attributes, children: [], tag, text: '' }

    const children: CanvasMarkupElement[] = []
    let text = ''
    while (true) {
      if (this.index >= this.source.length) htmlError(`Missing closing </${tag}>.`)
      if (this.source.startsWith('</', this.index)) {
        this.index += 2
        const rawClosing = this.readName()
        const closing = normalizeTag(rawClosing)
        if (closing !== tag) htmlError(`Expected </${tag}>, found </${rawClosing || '?'}>.`)
        this.skipWhitespace()
        this.expect('>')
        break
      }
      if (this.peek('<')) {
        children.push(this.parseElement(depth + 1))
      } else {
        const end = this.source.indexOf('<', this.index)
        const textEnd = end < 0 ? this.source.length : end
        text += decodeEntities(this.source.slice(this.index, textEnd))
        this.index = textEnd
      }
    }
    return { attributes, children, tag, text }
  }

  private expect(value: string): void {
    if (!this.source.startsWith(value, this.index)) {
      htmlError(`Expected "${value}" at character ${this.index}.`)
    }
    this.index += value.length
  }

  private peek(value: string): boolean {
    return this.source.startsWith(value, this.index)
  }

  private readName(): string {
    const start = this.index
    while (this.index < this.source.length && /[A-Za-z0-9:-]/.test(this.source[this.index]!)) {
      this.index += 1
    }
    return this.source.slice(start, this.index)
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index]!)) {
      this.index += 1
    }
  }
}

export function parseCanvasHtml(source: string): CanvasMarkupElement {
  return new CanvasHtmlParser(source).parse()
}
