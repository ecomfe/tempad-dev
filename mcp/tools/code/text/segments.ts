import { canonicalizeValue } from '@/utils/css'

import { inferFontWeight, isCodeFont, resolveRunAttrs, resolveTokens } from './style'
import {
  NEWLINE_RE,
  REQUESTED_SEGMENT_FIELDS,
  type StyledTextSegmentSubset,
  type TextBlock,
  type TextLine,
  type TextMark,
  type TextRun
} from './types'

export function buildTextBlocks(node: TextNode, segments: StyledTextSegmentSubset[]): TextBlock[] {
  const lines = splitIntoLines(node, segments)
  return groupLinesIntoBlocks(lines)
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

export function formatTextLiteral(value: string): string | null {
  return value.trim() ? value : null
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
    const blockType = isList
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
  }

  const family = typography.fontFamily?.name || seg.fontName?.family || ''
  if (isCodeFont(family)) {
    marks.add('code')
    delete attrs['font-family']
  }

  if (seg.textDecoration === 'UNDERLINE') {
    marks.add('underline')
  }
  if (seg.textDecoration === 'STRIKETHROUGH') {
    marks.add('strike')
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
