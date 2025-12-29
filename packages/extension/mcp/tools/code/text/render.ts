import type { DevComponent } from '@/types/plugin'

import { pruneInheritedTextStyles, stripDefaultTextStyles } from '@/utils/css'
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
}> {
  const { inheritedTextStyle, segments: providedSegments } = options

  const rawSegments = providedSegments === undefined ? getStyledSegments(node) : providedSegments
  if (!rawSegments || !rawSegments.length) {
    const literal = formatTextLiteral(node.characters ?? '')
    return {
      segments: literal ? [literal] : [],
      commonStyle: {},
      metas: [],
      segmentCount: 0
    }
  }

  const blocks = buildTextBlocks(node, rawSegments)

  const segmentCount = rawSegments.length
  const allRunStyles: Array<{ style: Record<string, string>; weight: number }> = []

  for (const block of blocks) {
    for (const line of block.lines) {
      for (const run of line.runs) {
        const cleaned = stripDefaultTextStyles({ ...run.attrs })
        pruneInheritedTextStyles(cleaned, inheritedTextStyle)
        const resolved = ctx.resolveStyleVars ? ctx.resolveStyleVars(cleaned, node) : cleaned

        const hoistableCandidate: Record<string, string> = {}
        for (const key in resolved) {
          if (HOIST_ALLOWLIST.has(key)) {
            hoistableCandidate[key] = resolved[key]
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

  return { segments: outputSegments, commonStyle, metas: [], segmentCount }
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
    blockClasses.push(...styleToClassNames(commonStyle, config))
  }

  if (paragraphSpacing > 0) {
    const mbStyle = { 'margin-bottom': `${paragraphSpacing}px` }
    blockClasses.push(...styleToClassNames(mbStyle, config))
  }

  const cls = joinClassNames(blockClasses)
  if (cls) props[classProp] = cls

  if (!isList) {
    const isMultiline = lines.length > 1
    const tagName = isMultiline || paragraphSpacing > 0 ? 'p' : 'span'
    const container: DevComponent = { name: tagName, props, children: [] }

    lines.forEach((line, idx) => {
      const lineNodes = buildInlineTree(line.runs, commonStyle, classProp, ctx, node)
      container.children.push(...lineNodes)
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
    'a',
    'span'
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
    const resolvedAttrs = ctx.resolveStyleVars
      ? ctx.resolveStyleVars(cleanedAttrs, node)
      : cleanedAttrs
    const style = omitCommon(resolvedAttrs, commonStyle)
    const classNames = styleToClassNames(style, ctx.config)
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
