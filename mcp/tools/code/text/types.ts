export const MARK_PRIORITY = ['link', 'code', 'bold', 'italic', 'strike', 'underline'] as const
export type TextMark = (typeof MARK_PRIORITY)[number]

export const MARK_WEIGHTS = Object.fromEntries(
  MARK_PRIORITY.map((mark, index) => [mark, index])
) as Record<TextMark, number>

export const HOIST_ALLOWLIST = new Set([
  'color',
  'font-family',
  'font-size',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform'
])

export const CODE_FONT_KEYWORDS = ['mono', 'code', 'consolas', 'menlo', 'courier', 'source code']

export const TYPO_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent'
] as const

export const NEWLINE_RE = /\r\n|[\n\r\u2028\u2029]/

export type BlockType = 'paragraph' | 'ordered-list' | 'unordered-list'

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

export interface TextBlock {
  type: BlockType
  lines: TextLine[]
  attrs: TextLine['attrs']
}

export type TokenRef = { id: string; name: string }
export type VariableAlias = { id?: string; type?: string }

export interface ResolvedFill {
  type: Paint['type']
  token?: TokenRef | null
  raw?: Paint
}

export type SegmentStyleMeta = {
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
export type StyledTextSegmentSubset = Pick<
  StyledTextSegment,
  SegmentFieldForRequest | 'characters' | 'start' | 'end'
>

export const REQUESTED_SEGMENT_FIELDS: SegmentFieldForRequest[] = [
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

export type RenderTextSegmentsOptions = {
  inheritedTextStyle?: Record<string, string>
  segments?: StyledTextSegmentSubset[] | null
}

export type RunStyleEntry = { style: Record<string, string>; weight: number }
