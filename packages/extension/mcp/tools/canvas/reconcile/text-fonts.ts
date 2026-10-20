import type {
  CanvasStyleResource,
  CanvasVariableReference,
  CanvasVariableBindings,
  CanvasFigmaTextRange
} from '@tempad-dev/shared'

import type { CanvasNodeSpec } from '../model'
import type { ApplyState, SupportedCanvasNode } from './state'

import { getVariableCollectionById } from '../../../local-resources'
import { specError, scopeError, applyError } from '../errors'
import {
  resolveFamilyFont,
  loadFont,
  resolvePortableFont,
  loadFonts,
  currentTextFonts
} from '../fonts'
import { normalizePortableFontStyle } from '../tailwind'
import { resolveVariable, resolvedVariable } from '../variables'
import { currentBoundVariableId } from './binding-values'
import { baseTextStyleScope, type BaseTextStyleScope } from './text-style-scope'

export const TEXT_STYLE_VALUE_FIELDS = [
  'fontName',
  'fontSize',
  'textDecoration',
  'letterSpacing',
  'lineHeight',
  'leadingTrim',
  'paragraphIndent',
  'paragraphSpacing',
  'listSpacing',
  'hangingPunctuation',
  'hangingList',
  'textCase'
] as const satisfies ReadonlyArray<keyof Extract<CanvasStyleResource, { type: 'TEXT' }>>

export const TEXT_STYLE_VARIABLES_BY_VALUE = {
  fontName: ['fontFamily', 'fontStyle', 'fontWeight'],
  fontSize: ['fontSize'],
  textDecoration: [],
  letterSpacing: ['letterSpacing'],
  lineHeight: ['lineHeight'],
  leadingTrim: [],
  paragraphIndent: ['paragraphIndent'],
  paragraphSpacing: ['paragraphSpacing'],
  listSpacing: [],
  hangingPunctuation: [],
  hangingList: [],
  textCase: []
} satisfies Record<(typeof TEXT_STYLE_VALUE_FIELDS)[number], readonly VariableBindableTextField[]>

export type TextStyleResource = Extract<CanvasStyleResource, { type: 'TEXT' }>

export function textStyleVariableEntries(
  spec: TextStyleResource
): Array<[VariableBindableTextField, CanvasVariableReference | null]> {
  return Object.entries(spec.variables ?? {}) as Array<
    [VariableBindableTextField, CanvasVariableReference | null]
  >
}

async function defaultFontVariableValue(
  variable: Variable,
  state: ApplyState,
  seen = new Set<string>()
): Promise<VariableValue> {
  if (seen.has(variable.id) || seen.size >= 64) {
    specError('Text style font variable aliases contain a cycle or exceed 64 levels.')
  }
  seen.add(variable.id)
  const collection = await getVariableCollectionById(variable.variableCollectionId)
  const value = collection && variable.valuesByMode[collection.defaultModeId]
  if (value === undefined || value === null) {
    scopeError(`Font variable "${variable.id}" has no accessible default-mode value.`)
  }
  if (typeof value === 'object' && 'type' in value && value.type === 'VARIABLE_ALIAS') {
    return defaultFontVariableValue(
      await resolveVariable({ id: value.id }, state.variables),
      state,
      seen
    )
  }
  return value
}

export async function loadTextStyleVariableFonts(
  style: TextStyle,
  spec: TextStyleResource,
  state: ApplyState
): Promise<void> {
  const fields = TEXT_STYLE_VARIABLES_BY_VALUE.fontName
  const variables = await Promise.all(
    fields.map(async (field) => {
      const reference = spec.variables?.[field]
      const retained = style.boundVariables?.[field]
      if (reference === null) return undefined
      if (reference) return resolveVariable(reference, state.variables)
      if (retained) return resolveVariable({ id: retained.id }, state.variables)
      return undefined
    })
  )
  if (!variables.some(Boolean)) return
  const hasRetainedBinding = fields.some(
    (field) => style.boundVariables?.[field] && spec.variables?.[field] !== null
  )
  const base = (!hasRetainedBinding && spec.fontName) || style.fontName
  // A style has no consumer mode of its own. Cover its default values and every
  // existing consumer context without creating temporary canvas nodes.
  const contexts: Array<SceneNode | undefined> = [
    undefined,
    ...(await style.getStyleConsumersAsync()).map(({ node }) => node)
  ]
  for (const consumer of contexts) {
    const [family = base.family, fontStyle = base.style, weight] = await Promise.all(
      variables.map((variable) => {
        if (!variable) return undefined
        if (consumer) return variable.resolveForConsumer(consumer).value
        return defaultFontVariableValue(variable, state)
      })
    )
    if (
      typeof family !== 'string' ||
      typeof fontStyle !== 'string' ||
      (weight !== undefined &&
        (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000))
    ) {
      specError(
        `Font variables on Text style "${style.id}" must resolve to STRING family/style and a weight between 1 and 1000.`
      )
    }
    const font =
      weight === undefined
        ? { ...base, family, style: fontStyle }
        : await resolveFamilyFont(family, fontStyle, state.fonts, weight)
    await loadVariableFontTransitions(
      [base],
      spec.variables,
      { family, style: fontStyle, weight },
      state
    )
    await loadFont(font, state.fonts)
  }
}

export async function preflightTextFont(
  spec: CanvasNodeSpec,
  state: ApplyState,
  existing?: SupportedCanvasNode
): Promise<void> {
  if (spec.type !== 'TEXT' || !spec.text) return
  const textNode = existing?.type === 'TEXT' ? existing : null
  const hasTextStyle = baseTextStyleScope(spec, textNode).kind === 'retained'
  const hasFontFamilyVariable = !!(
    spec.variables?.fontFamily ||
    (textNode && currentBoundVariableId(textNode, 'fontFamily'))
  )
  const hasFontStyleVariable = !!(
    spec.variables?.fontStyle ||
    (textNode && currentBoundVariableId(textNode, 'fontStyle'))
  )
  const fontFamily = hasTextStyle || hasFontFamilyVariable ? undefined : spec.text.fontFamily
  const fontStyle = hasTextStyle || hasFontStyleVariable ? undefined : spec.text.fontStyle
  if (
    (fontFamily !== undefined || fontStyle !== undefined) &&
    !(spec.text.fontStyleMatching && (hasFontFamilyVariable || hasFontStyleVariable))
  ) {
    const currentFont = textNode?.fontName ?? { family: 'Inter', style: 'Regular' }
    if (currentFont === figma.mixed && (!fontFamily || !fontStyle)) {
      specError(
        `TEXT "${spec.key}" has mixed fonts; provide both fontFamily and fontStyle to replace them.`
      )
    }
    const desiredFamily = fontFamily ?? (currentFont === figma.mixed ? '' : currentFont.family)
    const desiredStyle = fontStyle ?? (currentFont === figma.mixed ? '' : currentFont.style)
    const desiredFont = spec.text.portableFontFamily
      ? await resolvePortableFont(spec.text.portableFontFamily, desiredStyle, state.fonts)
      : spec.text.fontStyleMatching
        ? await resolveFamilyFont(desiredFamily, desiredStyle, state.fonts)
        : await resolveLiteralFont(desiredFamily, desiredStyle, spec, state)
    if (spec.text.portableFontFamily) {
      spec.text.fontFamily = desiredFont.family
      spec.text.fontStyle = desiredFont.style
    }
    await loadFont(desiredFont, state.fonts)
  }
}

async function resolveLiteralFont(
  family: string,
  style: string,
  spec: CanvasNodeSpec,
  state: ApplyState
): Promise<FontName> {
  if (spec.figma?.text?.fontName) return { family, style }
  if (family === 'Inter' || family === 'Noto Serif' || family === 'Noto Sans Mono') {
    return { family, style: normalizePortableFontStyle(family, style) }
  }
  return resolveFamilyFont(family, style, state.fonts)
}

export async function loadTextFonts(
  node: TextNode,
  spec: CanvasNodeSpec,
  state: ApplyState,
  styleScope: BaseTextStyleScope
): Promise<FontName | null> {
  const text = spec.text
  const currentFont = node.fontName
  const hasTextStyle = styleScope.kind === 'retained'
  if (text?.fontStyleMatching && !hasTextStyle) {
    const familyReference = spec.variables?.fontFamily
    const styleReference = spec.variables?.fontStyle
    const weightReference = spec.variables?.fontWeight
    const family = familyReference
      ? resolvedFontVariableValue(node, familyReference, state)
      : currentBoundVariableId(node, 'fontFamily') && currentFont !== figma.mixed
        ? currentFont.family
        : (text.fontFamily ?? (currentFont === figma.mixed ? '' : currentFont.family))
    const style = styleReference
      ? resolvedFontVariableValue(node, styleReference, state)
      : currentBoundVariableId(node, 'fontStyle') && currentFont !== figma.mixed
        ? currentFont.style
        : (text.fontStyle ?? (currentFont === figma.mixed ? '' : currentFont.style))
    if (currentFont === figma.mixed && (!family || !style)) {
      specError(
        `TEXT "${spec.key}" has mixed fonts; provide both fontFamily and fontStyle to replace them.`
      )
    }
    const weight = weightReference
      ? resolvedVariable(weightReference, state.variables).resolveForConsumer(node).value
      : undefined
    if (
      weight !== undefined &&
      (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000)
    ) {
      specError(`Font weight on "${spec.key}" must resolve to a number between 1 and 1000.`)
    }
    const desiredFont = styleReference
      ? { family, style }
      : await resolveFamilyFont(family, style, state.fonts, weight)
    await loadFont(desiredFont, state.fonts)
    return desiredFont
  }
  const fontFamily =
    hasTextStyle || spec.variables?.fontFamily || currentBoundVariableId(node, 'fontFamily')
      ? undefined
      : text?.fontFamily
  const fontStyle =
    hasTextStyle || spec.variables?.fontStyle || currentBoundVariableId(node, 'fontStyle')
      ? undefined
      : text?.fontStyle
  const hasExplicitFont = fontFamily !== undefined || fontStyle !== undefined
  if (currentFont === figma.mixed && hasExplicitFont && (!fontFamily || !fontStyle)) {
    specError(
      `TEXT "${spec.key}" has mixed fonts; provide both fontFamily and fontStyle to replace them.`
    )
  }

  const desiredFamily = fontFamily ?? (currentFont === figma.mixed ? '' : currentFont.family)
  const desiredStyle = fontStyle ?? (currentFont === figma.mixed ? '' : currentFont.style)
  const desiredFont: FontName | null = hasExplicitFont
    ? text?.portableFontFamily
      ? await resolvePortableFont(text.portableFontFamily, desiredStyle, state.fonts)
      : await resolveLiteralFont(desiredFamily, desiredStyle, spec, state)
    : null
  if (desiredFont && text?.portableFontFamily) {
    text.fontFamily = desiredFont.family
    text.fontStyle = desiredFont.style
  }
  const fonts = desiredFont
    ? [desiredFont]
    : currentFont === figma.mixed
      ? node.getRangeAllFontNames(0, node.characters.length)
      : [currentFont]
  await loadFonts(fonts, state.fonts)
  return desiredFont
}

type FontVariableBindings = Pick<CanvasVariableBindings, 'fontFamily' | 'fontStyle' | 'fontWeight'>

async function loadVariableFontTransitions(
  current: FontName[],
  bindings: FontVariableBindings | undefined,
  values: { family?: string; style?: string; weight?: number },
  state: ApplyState
): Promise<void> {
  let fonts = current
  const required = [...fonts]
  // Native setters apply one binding at a time, in the supplied binding order.
  for (const field of Object.keys(bindings ?? {}) as Array<keyof FontVariableBindings>) {
    if (!bindings?.[field]) continue
    if (field === 'fontFamily' && values.family !== undefined) {
      const family = values.family
      fonts = await Promise.all(
        fonts.map((font) =>
          font.family === family ? font : resolveFamilyFont(family, font.style, state.fonts)
        )
      )
    } else if (field === 'fontStyle' && values.style !== undefined) {
      const style = values.style
      fonts = fonts.map((font) => ({ family: font.family, style }))
    } else if (field === 'fontWeight' && values.weight !== undefined) {
      fonts = await Promise.all(
        fonts.map((font) => resolveFamilyFont(font.family, font.style, state.fonts, values.weight))
      )
    } else continue
    required.push(...fonts)
  }
  await loadFonts(required, state.fonts)
}

function resolvedFontVariableValue(
  node: TextNode,
  reference: CanvasVariableReference,
  state: ApplyState
): string {
  const value = resolvedVariable(reference, state.variables).resolveForConsumer(node).value
  if (typeof value !== 'string') {
    applyError('A preflighted font variable did not resolve to a string.')
  }
  return value
}

export async function loadVariableFonts(
  node: TextNode,
  bindings: FontVariableBindings | undefined,
  state: ApplyState,
  range?: Pick<CanvasFigmaTextRange, 'start' | 'end'>
): Promise<void> {
  const familyReference = bindings?.fontFamily
  const styleReference = bindings?.fontStyle
  const weightReference = bindings?.fontWeight
  if (!familyReference && !styleReference && !weightReference) return
  const weight = weightReference
    ? resolvedVariable(weightReference, state.variables).resolveForConsumer(node).value
    : undefined
  if (
    weight !== undefined &&
    (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000)
  ) {
    specError(`Font weight on "${node.id}" must resolve to a number between 1 and 1000.`)
  }

  await loadVariableFontTransitions(
    currentTextFonts(node, range),
    bindings,
    {
      family: familyReference ? resolvedFontVariableValue(node, familyReference, state) : undefined,
      style: styleReference ? resolvedFontVariableValue(node, styleReference, state) : undefined,
      weight
    },
    state
  )
}
