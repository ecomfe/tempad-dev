import type { DevComponent } from '@/types/plugin'

import { pruneInheritedTextStyles, stripDefaultTextStyles } from '@/utils/css'
import { resolveTextNodeVariableId, resolveTextSegmentVariable } from '@/utils/figma-variables'
import { joinClassNames } from '@/utils/tailwind'

import type { RenderContext } from '../render'

import { styleToClassNames } from '../styles'
import { buildTextBlocks, formatTextLiteral, getStyledSegments } from './segments'
import { computeDominantStyle, omitCommon } from './style'
import {
  HOIST_ALLOWLIST,
  MARK_WEIGHTS,
  type RenderTextSegmentsOptions,
  type SegmentStyleMeta,
  type TextBlock,
  type TextMark,
  type TextRun
} from './types'

export async function renderTextSegments(
  node: TextNode,
  classProp: 'class' | 'className',
  ctx: RenderContext,
  options: RenderTextSegmentsOptions
): Promise<{
  segments: Array<DevComponent | string>
  commonStyle: Record<string, string>
  metas: SegmentStyleMeta[]
  segmentCount: number
  fontStyleVariableIds: Set<string>
}> {
  const { inheritedTextStyle, segments: providedSegments } = options

  const rawSegments = providedSegments === undefined ? getStyledSegments(node) : providedSegments
  const fontStyleVariableIds = new Set<string>()
  if (!rawSegments || !rawSegments.length) {
    const literal = formatTextLiteral(node.characters ?? '')
    const fontStyleId = literal && resolveTextNodeVariableId(node, 'fontStyle', ctx.readers)
    if (fontStyleId) fontStyleVariableIds.add(fontStyleId)
    return {
      segments: literal ? [literal] : [],
      commonStyle: {},
      metas: [],
      segmentCount: 0,
      fontStyleVariableIds
    }
  }

  const blocks = buildTextBlocks(node, rawSegments, ctx.readers)
  for (const segment of rawSegments) {
    if (!/[^\r\n\u2028\u2029]/.test(segment.characters)) continue
    const variable = resolveTextSegmentVariable(node, segment, 'fontStyle', ctx.readers)
    if (variable) fontStyleVariableIds.add(variable.id)
  }

  const segmentCount = rawSegments.length
  const allRunStyles: Array<{ style: Record<string, string>; weight: number }> = []

  for (const block of blocks) {
    for (const line of block.lines) {
      for (const run of line.runs) {
        const cleaned = stripDefaultTextStyles({ ...run.attrs })
        pruneInheritedTextStyles(cleaned, inheritedTextStyle)
        const resolved = ctx.resolveStyleVars ? ctx.resolveStyleVars(cleaned, node) : cleaned

        const hoistableCandidate: Record<string, string> = {}
        for (const [key, value] of Object.entries(resolved)) {
          if (HOIST_ALLOWLIST.has(key)) {
            hoistableCandidate[key] = value
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

  for (const [index, block] of blocks.entries()) {
    const renderedBlock = renderBlock(
      block,
      commonStyle,
      classProp,
      ctx,
      node,
      index < blocks.length - 1
    )
    if (renderedBlock) {
      optimizeComponentTree(renderedBlock, classProp)
      outputSegments.push(renderedBlock)
    }
  }

  return { segments: outputSegments, commonStyle, metas: [], segmentCount, fontStyleVariableIds }
}

function renderBlock(
  block: TextBlock,
  commonStyle: Record<string, string>,
  classProp: 'class' | 'className',
  ctx: RenderContext,
  node: TextNode,
  hasFollowingBlock: boolean
): DevComponent | null {
  const { type, lines, attrs } = block
  const { paragraphIndent, paragraphSpacing } = attrs
  const { config } = ctx

  const isList = type === 'ordered-list' || type === 'unordered-list'

  const props: Record<string, string> = {}
  const blockClasses: string[] = []

  if (Object.keys(commonStyle).length) {
    blockClasses.push(...styleToClassNames(commonStyle, config))
  }

  if (block.paragraphLayout) {
    blockClasses.push(...styleToClassNames({ 'text-indent': `${paragraphIndent}px` }, config))
  }

  if (paragraphSpacing > 0 && (isList || hasFollowingBlock)) {
    const mbStyle = { 'margin-bottom': `${paragraphSpacing}px` }
    blockClasses.push(...styleToClassNames(mbStyle, config))
  }

  const cls = joinClassNames(blockClasses)
  if (cls) props[classProp] = cls

  if (!isList) {
    const isMultiline =
      lines.length > 1 || lines.some((line) => line.runs.some((run) => run.text.includes('\u2028')))
    const tagName = block.paragraphLayout || isMultiline || paragraphSpacing > 0 ? 'p' : 'span'
    const container: DevComponent = { name: tagName, props, children: [] }

    lines.forEach((line, idx) => {
      if (paragraphIndent !== 0 && line.runs.some((run) => run.text.includes('\u2028'))) {
        // Native forced lines repeat the indent, but automatic wraps do not.
        // Separate line boxes inherit text-indent without adding paragraph gaps.
        for (const runs of splitSoftLines(line.runs)) {
          const children = buildInlineTree(runs, commonStyle, classProp, ctx, node)
          if (!runs.some((run) => /[^\t\n\f\r ]/.test(run.text))) {
            children.push({ name: 'br', props: {}, children: [] })
          }
          container.children.push({
            name: 'span',
            props: { [classProp]: 'block' },
            children
          })
        }
      } else {
        container.children.push(...buildInlineTree(line.runs, commonStyle, classProp, ctx, node))
      }
      if (isMultiline && idx < lines.length - 1) {
        container.children.push({ name: 'br', props: {}, children: [] })
      }
    })

    if (container.children.length === 0 && tagName === 'p') {
      container.children.push({ name: 'br', props: {}, children: [] })
    }

    return container
  }

  const rootType = type === 'ordered-list' ? 'ORDERED' : 'UNORDERED'
  const rootTag = rootType === 'ORDERED' ? 'ol' : 'ul'
  const rootListStyle = getListStyleClass(rootType, 0)

  const rootClasses = [rootListStyle, 'list-outside', 'pl-[1.2em]']
  const rootCls = joinClassNames([...rootClasses, cls])

  const rootList: DevComponent = { name: rootTag, props: { [classProp]: rootCls }, children: [] }

  const rootStackItem: ListStackItem = {
    list: rootList,
    level: lines[0]?.attrs.indentation ?? 1
  }
  const stack: ListStackItem[] = [rootStackItem]

  for (const line of lines) {
    const currentIndent = line.attrs.indentation
    const listTag = line.attrs.listType === 'ORDERED' ? 'ol' : 'ul'
    rootStackItem.level = Math.min(rootStackItem.level, currentIndent)

    while (stack.length > 1) {
      const activeItem = stack.at(-1)
      if (
        !activeItem ||
        currentIndent > activeItem.level ||
        (currentIndent === activeItem.level && listTag === activeItem.list.name)
      )
        break
      stack.pop()
    }

    const parentStackItem = stack.at(-1) ?? rootStackItem
    if (currentIndent > parentStackItem.level) {
      if (!parentStackItem.lastLi) {
        const dummyLi: DevComponent = { name: 'li', props: {}, children: [] }
        parentStackItem.list.children.push(dummyLi)
        parentStackItem.lastLi = dummyLi
      }

      const currentDepth = stack.length
      const newListTypeKey = line.attrs.listType === 'ORDERED' ? 'ORDERED' : 'UNORDERED'
      const newListStyle = getListStyleClass(newListTypeKey, currentDepth)
      const newListClasses = [newListStyle, 'list-outside', 'pl-[1.2em]']

      const newList: DevComponent = {
        name: listTag,
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

    const activeItem = stack.at(-1) ?? rootStackItem
    activeItem.list.children.push(li)
    activeItem.lastLi = li
  }

  return rootList
}

function splitSoftLines(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]]
  for (const run of runs) {
    for (const [index, text] of run.text.split('\u2028').entries()) {
      if (index) lines.push([])
      if (text) lines.at(-1)!.push({ ...run, text })
    }
  }
  return lines
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
    'a',
    'span'
  ])

  if (UNWRAP_WHITELIST.has(node.name) && node.children && node.children.length === 1) {
    const [child] = node.children
    if (child && typeof child !== 'string' && child.name === 'span') {
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
      const stackNode = stack[k + 1]
      const currentMark = sortedMarks[k]
      if (!stackNode || !currentMark) break
      const { markType, linkHref } = stackNode

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
      const parent = stack.at(-1)
      if (!mark || !parent) break
      const component = createMarkComponent(mark, run)

      parent.container.children.push(component)

      stack.push({
        container: component,
        markType: mark,
        linkHref: mark === 'link' ? run.link : undefined
      })
    }

    const cleanedAttrs = stripDefaultTextStyles(run.attrs)
    // Defaults still reset a weight/style inherited from the text node or its ancestors.
    for (const key of ['font-weight', 'font-style']) {
      if (run.attrs[key] !== undefined) cleanedAttrs[key] = run.attrs[key]
    }
    const resolvedAttrs = ctx.resolveStyleVars
      ? ctx.resolveStyleVars(cleanedAttrs, node)
      : cleanedAttrs
    const style = omitCommon(resolvedAttrs, commonStyle)
    const classNames = styleToClassNames(style, ctx.config)
    // The general CSS converter omits normal as its default, but this run can inherit italic.
    if (style['font-style'] === 'normal') classNames.push('not-italic')
    const cls = joinClassNames(classNames)
    const top = stack.at(-1)?.container ?? root
    const children: Array<DevComponent | string> = []
    for (const [index, text] of run.text.split('\u2028').entries()) {
      if (index) children.push({ name: 'br', props: {}, children: [] })
      if (text) children.push(text)
    }

    if (cls) {
      top.children.push({
        name: 'span',
        props: { [classProp]: cls },
        children
      })
    } else {
      top.children.push(...children)
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

interface StackNode {
  container: { children: Array<DevComponent | string> }
  markType?: TextMark
  linkHref?: string
}

interface ListStackItem {
  list: DevComponent
  level: number
  lastLi?: DevComponent
}
