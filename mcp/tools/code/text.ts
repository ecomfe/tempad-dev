import type { DevComponent } from '@/types/plugin'

import {
  formatHexAlpha,
  normalizeCssVarName,
  pruneInheritedTextStyles,
  stripDefaultTextStyles,
  canonicalizeValue
} from '@/utils/css'
import { joinClassNames } from '@/utils/tailwind'

import type { RenderContext } from './index'

import { applyVariableTransforms, styleToClassNames } from './style'

const MARK_PRIORITY = ['link', 'code', 'bold', 'italic', 'strike', 'underline'] as const
type TextMark = (typeof MARK_PRIORITY)[number]

const MARK_WEIGHTS = Object.fromEntries(
  MARK_PRIORITY.map((mark, index) => [mark, index])
) as Record<TextMark, number>

const HOIST_ALLOWLIST = new Set(['color', 'font-family', 'font-size', 'line-height', 'letter-spacing', 'text-align', 'text-transform'])

const CODE_FONT_KEYWORDS = ['mono', 'code', 'consolas', 'menlo', 'courier', 'source code']

const TYPO_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent'
] as const

const NEWLINE_RE = /\r\n|[\n\r\u2028\u2029]/

export interface TextRun {
  text: string
  marks: Set<TextMark>
  attrs: Record<string, string>
  link?: string
  originalSegment?: StyledTextSegmentSubset
}

export interface TextLine {
  runs: TextRun[]
  attrs: {
    listType: 'ORDERED' | 'UNORDERED' | 'NONE'
    indentation: number
    listSpacing: number
    paragraphSpacing: number
  }
}

export type BlockType = 'paragraph' | 'ordered-list' | 'unordered-list'

export interface TextBlock {
  type: BlockType
  lines: TextLine[]
  attrs: TextLine['attrs']
}

interface StackNode {
  container: { children: Array<DevComponent | string> }
  markType?: TextMark
  linkHref?: string
}

type TokenRef = { id: string; name: string }

interface ResolvedFill {
  type: Paint['type']
  token?: TokenRef | null
  raw?: Paint
}

type SegmentStyleMeta = {
  raw: Partial<StyledTextSegmentSubset>
  tokens: {
    typography: Partial<Record<(typeof TYPO_FIELDS)[number], TokenRef>>
    fills: Array<{
      type: Paint['type']
      color?: TokenRef | null
      other?: Record<string, TokenRef | null>
    }>
  }
  refs: { textStyleId?: string | null; fillStyleId?: string | null }
}

type SegmentFieldForRequest = keyof Omit<StyledTextSegment, 'characters' | 'start' | 'end'>

const REQUESTED_SEGMENT_FIELDS: SegmentFieldForRequest[] = [
  'fontName',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textDecorationSkipInk',
  'paragraphSpacing',
  'indentation',
  'listOptions',
  'fills',
  'textStyleId',
  'fillStyleId',
  'boundVariables',
  'hyperlink'
]

type StyledTextSegmentSubset = Pick<
  StyledTextSegment,
  SegmentFieldForRequest | 'characters' | 'start' | 'end'
>

type VariableAlias = { id?: string; type?: string }

export type RenderTextSegmentsOptions = {
  inheritedTextStyle?: Record<string, string>
  segments?: StyledTextSegmentSubset[] | null
}

export async function renderTextSegments(
  node: TextNode,
  classProp: 'class' | 'className',
  ctx: RenderContext,
  options: RenderTextSegmentsOptions
): Promise<{
  segments: Array<DevComponent | string>
  commonStyle: Record<string, string>
  metas: SegmentStyleMeta[]
}> {
  const { inheritedTextStyle, segments: providedSegments } = options

  const rawSegments = providedSegments ?? getStyledSegments(node)
  if (!rawSegments || !rawSegments.length) {
    const literal = formatTextLiteral(node.characters ?? '')
    return {
      segments: literal ? [literal] : [],
      commonStyle: {},
      metas: []
    }
  }

  const blocks = buildTextBlocks(node, rawSegments)

  const runStyleMap = new Map<string, Record<string, string>>()
  let runCounter = 0

  for (const block of blocks) {
    for (const line of block.lines) {
      for (const run of line.runs) {
        runStyleMap.set(`run:${runCounter++}`, run.attrs)
      }
    }
  }

  await applyVariableTransforms(runStyleMap, {
    pluginCode: ctx.pluginCode,
    config: ctx.config
  })

  const allRunStyles: Array<{ style: Record<string, string>; weight: number }> = []

  for (const block of blocks) {
    for (const line of block.lines) {
      for (const run of line.runs) {
        const cleaned = stripDefaultTextStyles({ ...run.attrs })
        pruneInheritedTextStyles(cleaned, inheritedTextStyle)

        const hoistableCandidate: Record<string, string> = {}
        for (const key in cleaned) {
          if (HOIST_ALLOWLIST.has(key)) {
            hoistableCandidate[key] = cleaned[key]
          }
        }

        if (Object.keys(hoistableCandidate).length > 0) {
          allRunStyles.push({ style: hoistableCandidate, weight: run.text.length })
        }
      }
    }
  }

  const commonStyle = computeDominantStyle(allRunStyles)

  const outputSegments: Array<DevComponent | string> = []

  for (const block of blocks) {
    const renderedBlock = renderBlock(block, commonStyle, classProp, ctx, node)
    if (renderedBlock) {
      optimizeComponentTree(renderedBlock, classProp)
      outputSegments.push(renderedBlock)
    }
  }

  return { segments: outputSegments, commonStyle, metas: [] }
}

interface ListStackItem {
  list: DevComponent
  level: number
  lastLi?: DevComponent
}

function renderBlock(
  block: TextBlock,
  commonStyle: Record<string, string>,
  classProp: 'class' | 'className',
  ctx: RenderContext,
  node: TextNode
): DevComponent | null {
  const { type, lines, attrs } = block
  const { paragraphSpacing } = attrs
  const { config } = ctx

  const isList = type === 'ordered-list' || type === 'unordered-list'

  const props: Record<string, string> = {}
  const blockClasses: string[] = []

  if (Object.keys(commonStyle).length) {
    blockClasses.push(...styleToClassNames(commonStyle, config, node))
  }

  if (paragraphSpacing > 0) {
    const mbStyle = { 'margin-bottom': `${paragraphSpacing}px` }
    blockClasses.push(...styleToClassNames(mbStyle, config, node))
  }

  const cls = joinClassNames(blockClasses)
  if (cls) props[classProp] = cls

  if (!isList) {
    const pTag: DevComponent = { name: 'p', props, children: [] }

    lines.forEach((line, idx) => {
      const lineNodes = buildInlineTree(line.runs, commonStyle, classProp, ctx, node)
      pTag.children.push(...lineNodes)
      if (idx < lines.length - 1) {
        pTag.children.push({ name: 'br', props: {}, children: [] })
      }
    })

    if (pTag.children.length === 0) {
      pTag.children.push({ name: 'br', props: {}, children: [] })
    }

    return pTag
  }

  const rootType = type === 'ordered-list' ? 'ORDERED' : 'UNORDERED'
  const rootTag = rootType === 'ORDERED' ? 'ol' : 'ul'
  const rootListStyle = getListStyleClass(rootType, 0)

  const rootClasses = [rootListStyle, 'list-outside', 'pl-[1.2em]']
  const rootCls = joinClassNames([...rootClasses, cls])

  const rootList: DevComponent = { name: rootTag, props: { [classProp]: rootCls }, children: [] }

  const stack: ListStackItem[] = [{ list: rootList, level: lines[0]?.attrs.indentation || 1 }]

  for (const line of lines) {
    const currentIndent = line.attrs.indentation

    while (stack.length > 0 && currentIndent < stack[stack.length - 1].level) {
      stack.pop()
    }

    if (stack.length > 0 && currentIndent > stack[stack.length - 1].level) {
      const parentStackItem = stack[stack.length - 1]

      if (!parentStackItem.lastLi) {
        const dummyLi: DevComponent = { name: 'li', props: {}, children: [] }
        parentStackItem.list.children.push(dummyLi)
        parentStackItem.lastLi = dummyLi
      }

      const currentDepth = stack.length
      const newListTypeKey = line.attrs.listType === 'ORDERED' ? 'ORDERED' : 'UNORDERED'
      const newListTag = newListTypeKey === 'ORDERED' ? 'ol' : 'ul'

      const newListStyle = getListStyleClass(newListTypeKey, currentDepth)
      const newListClasses = [newListStyle, 'list-outside', 'pl-[1.2em]']

      const newList: DevComponent = {
        name: newListTag,
        props: { [classProp]: joinClassNames(newListClasses) },
        children: []
      }

      parentStackItem.lastLi.children.push(newList)
      stack.push({ list: newList, level: currentIndent })
    }

    const lineChildren = buildInlineTree(line.runs, commonStyle, classProp, ctx, node)
    if (lineChildren.length === 0) {
      lineChildren.push({ name: 'br', props: {}, children: [] })
    }

    const li: DevComponent = { name: 'li', props: {}, children: lineChildren }

    const activeItem = stack[stack.length - 1]
    activeItem.list.children.push(li)
    activeItem.lastLi = li
  }

  return rootList
}

function getListStyleClass(type: 'ORDERED' | 'UNORDERED', depth: number): string {
  if (type === 'UNORDERED') {
    return 'list-disc'
  } else {
    const d = depth % 3
    if (d === 1) return 'list-[lower-alpha]'
    if (d === 2) return 'list-[lower-roman]'
    return 'list-decimal'
  }
}

function optimizeComponentTree(node: DevComponent | string, classProp: string) {
  if (typeof node === 'string') return

  if (node.children) {
    for (const child of node.children) {
      optimizeComponentTree(child, classProp)
    }
  }

  const UNWRAP_WHITELIST = new Set([
    'li',
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'u',
    's',
    'code',
    'a'
  ])

  if (UNWRAP_WHITELIST.has(node.name) && node.children && node.children.length === 1) {
    const child = node.children[0]
    if (typeof child !== 'string' && child.name === 'span') {
      const childProps = child.props || {}
      const extraChildProps = Object.keys(childProps).filter((key) => key !== classProp)
      if (extraChildProps.length === 0) {
        const parentClass = String(node.props?.[classProp] || '')
        const childClass = String(childProps?.[classProp] || '')
        const mergedClass = joinClassNames([parentClass, childClass])

        if (mergedClass) {
          if (!node.props) node.props = {}
          node.props[classProp] = mergedClass
        }

        node.children = child.children
      }
    }
  }
}

function buildInlineTree(
  runs: TextRun[],
  commonStyle: Record<string, string>,
  classProp: 'class' | 'className',
  ctx: RenderContext,
  node: TextNode
): Array<DevComponent | string> {
  const root: { children: Array<DevComponent | string> } = { children: [] }
  const stack: StackNode[] = [{ container: root }]

  for (const run of runs) {
    if (!run.text) continue

    const sortedMarks = [...run.marks].sort((a, b) => MARK_WEIGHTS[a] - MARK_WEIGHTS[b])

    let k = 0
    while (k < sortedMarks.length && k < stack.length - 1) {
      const { markType, linkHref } = stack[k + 1]
      const currentMark = sortedMarks[k]

      if (markType === currentMark && (currentMark !== 'link' || linkHref === run.link)) {
        k++
      } else {
        break
      }
    }
    const matchDepth = k

    while (stack.length - 1 > matchDepth) {
      stack.pop()
    }

    while (stack.length - 1 < sortedMarks.length) {
      const mark = sortedMarks[stack.length - 1]
      const component = createMarkComponent(mark, run)

      stack[stack.length - 1].container.children.push(component)

      stack.push({
        container: component,
        markType: mark,
        linkHref: mark === 'link' ? run.link : undefined
      })
    }

    const cleanedAttrs = stripDefaultTextStyles(run.attrs)
    const style = omitCommon(cleanedAttrs, commonStyle)
    const classNames = styleToClassNames(style, ctx.config, node)
    const cls = joinClassNames(classNames)
    const top = stack[stack.length - 1].container

    if (cls) {
      top.children.push({
        name: 'span',
        props: { [classProp]: cls },
        children: [run.text]
      })
    } else {
      top.children.push(run.text)
    }
  }

  return root.children
}

function createMarkComponent(mark: TextMark, run: TextRun): DevComponent {
  switch (mark) {
    case 'bold':
      return { name: 'strong', props: {}, children: [] }
    case 'italic':
      return { name: 'em', props: {}, children: [] }
    case 'underline':
      return { name: 'u', props: {}, children: [] }
    case 'strike':
      return { name: 'del', props: {}, children: [] }
    case 'code':
      return { name: 'code', props: {}, children: [] }
    case 'link':
      return { name: 'a', props: { href: run.link }, children: [] }
  }
}

function buildTextBlocks(node: TextNode, segments: StyledTextSegmentSubset[]): TextBlock[] {
  const lines = splitIntoLines(node, segments)
  return groupLinesIntoBlocks(lines)
}

function splitIntoLines(node: TextNode, segments: StyledTextSegmentSubset[]): TextLine[] {
  const lines: TextLine[] = []

  let currentRuns: TextRun[] = []
  let currentSegmentForAttrs: StyledTextSegmentSubset | null = null

  for (const seg of segments) {
    const text = seg.characters
    const parts = text.split(NEWLINE_RE)

    for (let i = 0; i < parts.length; i++) {
      const partText = parts[i]

      if (partText.length > 0) {
        const run = createRun(node, seg, partText)
        currentRuns.push(run)
      }

      if (i < parts.length - 1) {
        lines.push({
          runs: optimizeRuns(currentRuns),
          attrs: extractLineAttrs(seg)
        })
        currentRuns = []
      }
    }
    currentSegmentForAttrs = seg
  }

  if (currentRuns.length > 0 && currentSegmentForAttrs) {
    lines.push({
      runs: optimizeRuns(currentRuns),
      attrs: extractLineAttrs(currentSegmentForAttrs)
    })
  }

  return lines
}

function groupLinesIntoBlocks(lines: TextLine[]): TextBlock[] {
  const blocks: TextBlock[] = []
  if (!lines.length) return blocks

  let currentBlock: TextBlock | null = null

  for (const line of lines) {
    const { listType } = line.attrs
    const isList = listType !== 'NONE'
    const blockType: BlockType = isList
      ? listType === 'ORDERED'
        ? 'ordered-list'
        : 'unordered-list'
      : 'paragraph'

    const canMerge = currentBlock && currentBlock.type === blockType

    if (canMerge) {
      currentBlock!.lines.push(line)
    } else {
      currentBlock = {
        type: blockType,
        lines: [line],
        attrs: line.attrs
      }
      blocks.push(currentBlock)
    }
  }

  return blocks
}

function optimizeRuns(runs: TextRun[]): TextRun[] {
  applyStickySpace(runs)

  const result: TextRun[] = []

  const cleanedRuns = runs.map((run) => {
    // Regex matches pure whitespace including ZWSP and other invisibles
    if (/^[\s\u200B-\u200D\uFEFF]*$/.test(run.text)) {
      const newAttrs = { ...run.attrs }
      delete newAttrs['color']
      delete newAttrs['text-decoration-color']
      delete newAttrs['text-decoration-line']
      delete newAttrs['background-color']
      return { ...run, attrs: newAttrs }
    }
    return run
  })

  for (const run of cleanedRuns) {
    if (result.length === 0) {
      result.push(run)
      continue
    }

    const prev = result[result.length - 1]

    // Aggressive Merge: If current is whitespace, merge if Mark/Link match. Ignore attrs.
    const isWhitespace = /^[\s\u200B-\u200D\uFEFF]*$/.test(run.text)

    if (isWhitespace) {
      if (prev.marks.size !== run.marks.size) {
        result.push(run)
        continue
      }
      let marksMatch = true
      for (const m of prev.marks) {
        if (!run.marks.has(m)) {
          marksMatch = false
          break
        }
      }

      if (marksMatch && prev.link === run.link) {
        prev.text += run.text
        continue
      }
    }

    if (prev.marks.size !== run.marks.size) {
      result.push(run)
      continue
    }

    let marksMatch = true
    for (const m of prev.marks) {
      if (!run.marks.has(m)) {
        marksMatch = false
        break
      }
    }
    if (!marksMatch) {
      result.push(run)
      continue
    }

    const prevKeys = Object.keys(prev.attrs)
    const runKeys = Object.keys(run.attrs)

    if (prevKeys.length !== runKeys.length) {
      result.push(run)
      continue
    }

    let attrsMatch = true
    for (const key of prevKeys) {
      if (canonicalizeValue(key, prev.attrs[key]) !== canonicalizeValue(key, run.attrs[key])) {
        attrsMatch = false
        break
      }
    }

    if (attrsMatch && prev.link === run.link) {
      prev.text += run.text
    } else {
      result.push(run)
    }
  }

  return result
}

function createRun(node: TextNode, seg: StyledTextSegmentSubset, text: string): TextRun {
  const marks = new Set<TextMark>()
  const { typography, fills } = resolveTokens(node, seg)
  const attrs = resolveRunAttrs(seg, typography, fills)

  const weight = inferFontWeight(seg.fontName?.style, seg.fontWeight) ?? 400
  if (weight >= 600) {
    marks.add('bold')
  }

  if (seg.fontStyle === 'ITALIC') {
    marks.add('italic')
    // Retain attr
  }

  const family = typography.fontFamily?.name || seg.fontName?.family || ''
  if (isCodeFont(family)) {
    marks.add('code')
    delete attrs['font-family']
  }

  if (seg.textDecoration === 'UNDERLINE') {
    marks.add('underline')
    // Retain attr
  }
  if (seg.textDecoration === 'STRIKETHROUGH') {
    marks.add('strike')
    // Retain attr
  }

  let link: string | undefined
  if (seg.hyperlink) {
    marks.add('link')
    if (seg.hyperlink.type === 'URL') link = seg.hyperlink.value
  }

  return {
    text,
    marks,
    attrs,
    link,
    originalSegment: seg
  }
}

function applyStickySpace(runs: TextRun[]): TextRun[] {
  for (let i = 1; i < runs.length - 1; i++) {
    const curr = runs[i]
    if (!curr.text.trim()) {
      const prev = runs[i - 1]
      const next = runs[i + 1]

      const commonMarks = new Set([...prev.marks].filter((m) => next.marks.has(m)))

      for (const m of commonMarks) {
        curr.marks.add(m)
      }
    }
  }
  return runs
}

function extractLineAttrs(seg: StyledTextSegmentSubset): TextLine['attrs'] {
  return {
    listType: seg.listOptions?.type || 'NONE',
    indentation: seg.indentation || 0,
    listSpacing: seg.listOptions?.type !== 'NONE' ? seg.paragraphSpacing || 0 : 0,
    paragraphSpacing: seg.paragraphSpacing || 0
  }
}

function resolveRunAttrs(
  seg: StyledTextSegmentSubset,
  typography: Record<string, TokenRef>,
  fills: ResolvedFill[]
): Record<string, string> {
  const style: Record<string, string> = {}

  const solid = fills.find((f) => f.type === 'SOLID')
  if (solid) {
    const rawPaint = solid.raw as SolidPaint | undefined
    if (rawPaint) {
      const val = formatHexAlpha(rawPaint.color, rawPaint.opacity ?? 1)
      const css = constructCssVar(solid.token, val)
      if (css) style.color = css
    }
  }

  const { fontFamily, fontSize, lineHeight, letterSpacing, fontWeight } = typography

  const fontVal = constructCssVar(fontFamily, seg.fontName?.family)
  if (fontVal) style['font-family'] = fontVal

  const sizeVal = constructCssVar(
    fontSize,
    typeof seg.fontSize === 'number' ? `${seg.fontSize}px` : undefined
  )
  if (sizeVal) style['font-size'] = sizeVal

  if (fontWeight || typeof seg.fontWeight === 'number') {
    const wVal = inferFontWeight(seg.fontName?.style, seg.fontWeight)
    const wStr = wVal != null ? String(wVal) : undefined
    const weightCss = constructCssVar(fontWeight, wStr)
    if (weightCss) style['font-weight'] = weightCss
  }

  const lhVal = constructCssVar(lineHeight, formatLineHeightValue(seg.lineHeight))
  if (lhVal) style['line-height'] = lhVal

  const lsVal = constructCssVar(letterSpacing, formatLetterSpacingValue(seg.letterSpacing))
  if (lsVal) style['letter-spacing'] = lsVal

  if (seg.textCase) {
    const transform = mapTextCase(seg.textCase)
    if (transform) style['text-transform'] = transform
  }

  if (seg.textDecoration === 'UNDERLINE' || seg.textDecoration === 'STRIKETHROUGH') {
    style['text-decoration-line'] = seg.textDecoration.toLowerCase().replace('_', '-')
  }

  return style
}

function resolveTokens(textNode: TextNode, seg: StyledTextSegmentSubset) {
  const typography: Record<string, TokenRef> = {}

  TYPO_FIELDS.forEach((field) => {
    const bindings = seg.boundVariables as Record<string, VariableAlias> | undefined
    let token = resolveAliasToTokenSync(bindings?.[field])

    if (!token && seg.textStyleId && typeof seg.textStyleId === 'string') {
      try {
        const style = figma.getStyleById(seg.textStyleId) as TextStyle
        const styleBindings = style?.boundVariables as Record<string, VariableAlias> | undefined
        token = resolveAliasToTokenSync(styleBindings?.[field])
      } catch {
        // noop
      }
    }

    if (!token) {
      try {
        const alias = textNode.getRangeBoundVariable(
          seg.start,
          seg.end,
          field as VariableBindableTextField
        )
        if (alias !== figma.mixed) {
          token = resolveAliasToTokenSync(alias)
        }
      } catch {
        // noop
      }
    }
    if (token) typography[field] = token
  })

  const fillRaw = Array.isArray(seg.fills) ? seg.fills : []
  const fills: ResolvedFill[] = fillRaw.map((paint) => {
    if (paint.type === 'SOLID') {
      const colorToken = resolveAliasToTokenSync(paint.boundVariables?.color)
      return { type: 'SOLID', token: colorToken, raw: paint }
    }
    return { type: paint.type, raw: paint }
  })

  return { typography, fills }
}

export function getStyledSegments(node: TextNode): StyledTextSegmentSubset[] | null {
  try {
    if (typeof node.getStyledTextSegments !== 'function') return null
    const segments = node.getStyledTextSegments(REQUESTED_SEGMENT_FIELDS)
    return Array.isArray(segments) ? (segments as StyledTextSegmentSubset[]) : null
  } catch {
    return null
  }
}

function resolveAliasToTokenSync(alias: VariableAlias | null | undefined): TokenRef | null {
  if (!alias || !alias.id) return null
  try {
    const variable = figma.variables.getVariableById(alias.id)
    if (!variable) return null
    return { id: variable.id, name: variable.name }
  } catch {
    return null
  }
}

function constructCssVar(token?: TokenRef | null, fallback?: string): string | undefined {
  if (token) return `var(--${normalizeCssVarName(token.name)})`
  return fallback?.trim() || undefined
}

function formatTextLiteral(value: string): string | null {
  return value.trim() ? value : null
}

function isCodeFont(family: string): boolean {
  const lower = family.toLowerCase()
  return CODE_FONT_KEYWORDS.some((k) => lower.includes(k))
}

function inferFontWeight(styleName?: string | null, explicit?: number): number | undefined {
  if (typeof explicit === 'number') return explicit
  if (!styleName) return undefined
  const matched = styleName.match(/(\d{3})/)
  if (matched) return Number(matched[1])

  const lowered = styleName.toLowerCase()
  const mapping: Record<string, number> = {
    black: 900,
    extrabold: 800,
    ultrabold: 800,
    bold: 700,
    semibold: 600,
    demibold: 600,
    medium: 500,
    light: 300,
    thin: 200
  }

  for (const [k, v] of Object.entries(mapping)) {
    if (lowered.includes(k)) return v
  }

  return undefined
}

function formatLineHeightValue(lineHeight?: LineHeight): string | undefined {
  if (!lineHeight) return undefined
  if (lineHeight.unit === 'AUTO') return 'normal'
  if ('value' in lineHeight) {
    return lineHeight.unit === 'PERCENT' ? `${lineHeight.value}%` : `${lineHeight.value}px`
  }
  return undefined
}

function formatLetterSpacingValue(letterSpacing?: LetterSpacing): string | undefined {
  if (!letterSpacing || !('value' in letterSpacing)) return undefined
  return letterSpacing.unit === 'PERCENT' ? `${letterSpacing.value}%` : `${letterSpacing.value}px`
}

function mapTextCase(textCase?: TextCase): string | undefined {
  const map: Record<string, string> = {
    UPPER: 'uppercase',
    LOWER: 'lowercase',
    TITLE: 'capitalize'
  }
  return map[textCase as string]
}

function computeDominantStyle(
  runStyles: Array<{ style: Record<string, string>; weight: number }>
): Record<string, string> {
  if (!runStyles.length) return {}

  const counts: Record<string, Record<string, { raw: string; score: number }>> = {}
  let totalWeight = 0

  for (const { style, weight } of runStyles) {
    totalWeight += weight
    for (const [key, value] of Object.entries(style)) {
      const normalized = canonicalizeValue(key, value)
      if (!counts[key]) counts[key] = {}

      if (!counts[key][normalized]) {
        counts[key][normalized] = { raw: value, score: weight }
      } else {
        counts[key][normalized].score += weight
      }
    }
  }

  const dominant: Record<string, string> = {}
  // Hoist a property only when it represents a clear majority of the text.
  const threshold = totalWeight * 0.5

  for (const key in counts) {
    const bucket = counts[key]
    let bestValue: { raw: string; score: number } | undefined

    for (const norm in bucket) {
      const entry = bucket[norm]
      if (!bestValue || entry.score > bestValue.score) {
        bestValue = entry
      }
    }

    if (bestValue && bestValue.score >= threshold) {
      dominant[key] = bestValue.raw
    }
  }

  return dominant
}

function omitCommon(
  style: Record<string, string>,
  common: Record<string, string>
): Record<string, string> {
  if (!common || !Object.keys(common).length) return style
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(style)) {
    if (!common[key] || canonicalizeValue(key, value) !== canonicalizeValue(key, common[key])) {
      result[key] = value
    }
  }
  return result
}
