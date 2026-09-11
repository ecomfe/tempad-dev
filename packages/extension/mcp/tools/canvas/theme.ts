import type {
  CanvasBinding,
  CanvasResolvedApplyParameters,
  CanvasStyleReference,
  CanvasVariableBindings,
  CanvasVariableReference,
  CanvasVariableValue
} from '@tempad-dev/shared'

import type { DesignSystemCatalog } from '../design-system-catalog'
import type { CanvasMarkupElement } from './html'

import { getVariableCollectionById } from '../../local-resources'
import { parseCanvasHtml } from './html'
import {
  CANVAS_KEY_NAMESPACE,
  CANVAS_VARIABLE_MODE_KEYS_NAME,
  designReferenceCacheKey,
  parseVariableModeKeys
} from './identity'
import { parseCanvasClasses } from './tailwind'
import {
  type CanvasVariableState,
  createVariableState,
  resolveCollection,
  resolveVariable
} from './variables'

type VariableField = keyof CanvasVariableBindings
export type ThemeResources = {
  variables: Map<string, CanvasVariableReference>
  textStyles: Map<string, CanvasStyleReference>
  values: Map<string, CanvasVariableValue>
  boundFields: Map<string, VariableField[]>
}

const CSS_VARIABLE =
  /^([a-z-]+)-(?:\((?:(color|length|number|family-name):)?(--[a-zA-Z0-9_-]+)\)|\[(?:(color|length|number|family-name):)?var\((--[a-zA-Z0-9_-]+)\)\])$/

function variableClass(token: string) {
  const match = CSS_VARIABLE.exec(token)
  return match
    ? { utility: match[1]!, hint: match[2] ?? match[4], name: (match[3] ?? match[5])! }
    : undefined
}

function resourceIdentity(
  reference: CanvasVariableReference | CanvasStyleReference,
  input: CanvasResolvedApplyParameters,
  catalog?: DesignSystemCatalog
): string {
  if (!('variableKey' in reference) && !('styleKey' in reference))
    return designReferenceCacheKey(reference)
  const variable = 'variableKey' in reference
  const key = variable ? reference.variableKey : reference.styleKey
  const identities = new Set<string>()
  if (variable) {
    for (const collection of Object.values(input.variableCollections ?? {})) {
      const id = collection?.variables?.[key]?.id
      if (id) identities.add(`id:${id}`)
    }
  } else {
    const id = input.styles?.[key]?.id
    if (id) identities.add(`id:${id}`)
  }
  for (const entry of catalog?.entries.values() ?? []) {
    if (entry.kind !== 'variable' && entry.kind !== 'style') continue
    if (
      entry.kind !== (variable ? 'variable' : 'style') ||
      (entry.definition as { authoringKey?: string } | undefined)?.authoringKey !== key
    )
      continue
    if ('variableKey' in entry.reference || 'styleKey' in entry.reference) continue
    identities.add(designReferenceCacheKey(entry.reference))
  }
  if (identities.size > 1)
    throw new Error(`Authoring key "${key}" identifies more than one native resource.`)
  return identities.values().next().value ?? `${variable ? 'variable' : 'style'}-key:${key}`
}

function addAlias<T>(
  map: Map<string, T>,
  name: string,
  reference: T,
  identity: (reference: T) => string
): void {
  const previous = map.get(name)
  if (previous && identity(previous) !== identity(reference)) {
    throw new Error(
      `Theme alias "${name}" maps to more than one resource; choose a distinct alias.`
    )
  }
  map.set(name, reference)
}

export function createThemeResources(
  input: CanvasResolvedApplyParameters,
  catalog?: DesignSystemCatalog
): ThemeResources {
  const resources: ThemeResources = {
    variables: new Map(),
    textStyles: new Map(),
    values: new Map(),
    boundFields: new Map()
  }
  const identity = (reference: CanvasVariableReference | CanvasStyleReference): string =>
    resourceIdentity(reference, input, catalog)
  for (const entry of catalog?.entries.values() ?? []) {
    if (entry.kind === 'variable' && entry.cssName)
      resources.variables.set(entry.cssName, entry.reference)
    if (entry.kind === 'style' && entry.styleType === 'TEXT' && entry.className) {
      resources.textStyles.set(entry.className, entry.reference)
    }
  }
  for (const [name, source] of Object.entries(input.theme?.variables ?? {})) {
    if ('variableKey' in source) addAlias(resources.variables, name, source, identity)
    else {
      const entry = catalog?.entries.get(source.ref)
      if (entry?.kind !== 'variable')
        throw new Error(`Theme variable "${name}" requires a variable ref from catalogId.`)
      addAlias(resources.variables, name, entry.reference, identity)
    }
  }
  for (const [name, source] of Object.entries(input.theme?.textStyles ?? {})) {
    if ('styleKey' in source) {
      const style = input.styles?.[source.styleKey]
      if (style === null || (style && style.type !== 'TEXT'))
        throw new Error(`Theme class "${name}" requires a TEXT style.`)
      addAlias(resources.textStyles, name, source, identity)
    } else {
      const entry = catalog?.entries.get(source.ref)
      if (entry?.kind !== 'style' || entry.styleType !== 'TEXT')
        throw new Error(`Theme class "${name}" requires a text-style ref from catalogId.`)
      addAlias(resources.textStyles, name, entry.reference, identity)
    }
  }
  return resources
}

class NeedsVariableRead extends Error {
  constructor(readonly reference: CanvasVariableReference) {
    super('A theme variable requires its current native value.')
  }
}

function variableValue(
  reference: CanvasVariableReference,
  input: CanvasResolvedApplyParameters,
  catalog: DesignSystemCatalog | undefined,
  resources: ThemeResources,
  seen = new Set<string>()
): Exclude<CanvasVariableValue, { variable: CanvasVariableReference }> {
  const key = resourceIdentity(reference, input, catalog)
  if (seen.has(key) || seen.size >= 64)
    throw new Error('Theme variable aliases contain a cycle or exceed 64 levels.')
  seen.add(key)
  let value: CanvasVariableValue | undefined
  if ('variableKey' in reference) {
    for (const collection of Object.values(input.variableCollections ?? {})) {
      if (!collection?.variables || !Object.hasOwn(collection.variables, reference.variableKey))
        continue
      const variable = collection.variables[reference.variableKey]
      if (!variable)
        throw new Error(`Theme variable "${reference.variableKey}" is removed in this call.`)
      // New collections use their first declared mode as the native default.
      const mode = Object.entries(collection.modes ?? {}).find(([, spec]) => spec !== null)
      if (!collection.id && !collection.extends && mode)
        value =
          variable.values?.[mode[0]] ?? (mode[1]?.id ? variable.values?.[mode[1].id] : undefined)
      break
    }
  }
  if (value === undefined) {
    for (const entry of catalog?.entries.values() ?? []) {
      if (entry.kind === 'variable' && resourceIdentity(entry.reference, input, catalog) === key) {
        value = entry.defaultValue
        break
      }
    }
  }
  value ??= resources.values.get(key)
  if (value === undefined) throw new NeedsVariableRead(reference)
  if (typeof value === 'object' && 'variable' in value) {
    return variableValue(value.variable, input, catalog, resources, seen)
  }
  return value
}

async function readVariableDefaultValue(
  reference: CanvasVariableReference,
  input: CanvasResolvedApplyParameters,
  state: CanvasVariableState
): Promise<CanvasVariableValue> {
  let nativeReference = reference
  if ('variableKey' in reference) {
    for (const [collectionKey, spec] of Object.entries(input.variableCollections ?? {})) {
      if (!spec) continue
      const variable = spec.variables?.[reference.variableKey]
      if (!variable) continue
      if (variable.id) nativeReference = { id: variable.id }
      if (variable.values) {
        // Incremental declarations can add a variable before its native identity exists.
        const collection = await resolveCollection(spec.id ?? collectionKey, state)
        const modes = parseVariableModeKeys(
          collection.getSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_VARIABLE_MODE_KEYS_NAME),
          collection.modes
        )
        if (!modes)
          throw new Error(
            `Variable mode identity data on collection "${collection.id}" is invalid.`
          )
        for (const [mode, value] of Object.entries(variable.values)) {
          const modeId = spec.modes?.[mode]?.id ?? modes.get(mode) ?? mode
          if (modeId === collection.defaultModeId) return value
        }
      }
      break
    }
  }
  if (!('variableKey' in nativeReference) && !nativeReference.id) {
    throw new Error('Theme fallbacks require a materialized variable id or local variableKey.')
  }
  const variable = await resolveVariable(nativeReference, state)
  if (variable.resolvedType === 'EASING' || variable.resolvedType === 'TIMING') {
    throw new Error(
      `Theme variable "${variable.name}" has unsupported type ${variable.resolvedType}.`
    )
  }
  const collection = await getVariableCollectionById(variable.variableCollectionId)
  const value = collection ? variable.valuesByMode[collection.defaultModeId] : undefined
  if (value === undefined)
    throw new Error(`Theme variable "${variable.name}" has no default-mode value.`)
  if (typeof value === 'object' && 'type' in value) {
    if (value.type !== 'VARIABLE_ALIAS')
      throw new Error(`Theme variable "${variable.name}" has an unsupported default-mode value.`)
    return { variable: { id: value.id } }
  }
  return value
}

// Hydrate only aliases used in markup. Reads never import or create a resource.
export async function prepareThemeResources(
  input: CanvasResolvedApplyParameters,
  catalog?: DesignSystemCatalog
): Promise<ThemeResources> {
  const resources = createThemeResources(input, catalog)
  if (!input.markup) return resources
  const names = new Set<string>()
  const visit = (element: CanvasMarkupElement): void => {
    for (const token of (element.attributes.class ?? '').split(/\s+/)) {
      const parsed = variableClass(token)
      if (parsed) names.add(parsed.name)
    }
    element.children.forEach(visit)
  }
  visit(parseCanvasHtml(input.markup))
  const state = createVariableState()
  for (const name of names) {
    const reference = resources.variables.get(name)
    if (!reference)
      throw new Error(
        `Unknown CSS variable "${name}". Use a catalog cssName or declare theme.variables.`
      )
    for (let reads = 0; ; reads += 1) {
      try {
        variableValue(reference, input, catalog, resources)
        break
      } catch (error) {
        if (!(error instanceof NeedsVariableRead) || reads >= 64) throw error
        resources.values.set(
          resourceIdentity(error.reference, input, catalog),
          await readVariableDefaultValue(error.reference, input, state)
        )
      }
    }
  }
  return resources
}

function colorLiteral(value: unknown, token: string): string {
  if (
    !value ||
    typeof value !== 'object' ||
    !('r' in value) ||
    !('g' in value) ||
    !('b' in value)
  ) {
    throw new Error(`Class "${token}" requires a COLOR variable.`)
  }
  const color = value as RGBA
  return `#${[color.r, color.g, color.b, color.a ?? 1]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

const NUMBER_FIELDS: Record<string, VariableField[]> = {
  w: ['width'],
  h: ['height'],
  size: ['width', 'height'],
  'min-w': ['minWidth'],
  'max-w': ['maxWidth'],
  'min-h': ['minHeight'],
  'max-h': ['maxHeight'],
  p: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  px: ['paddingLeft', 'paddingRight'],
  py: ['paddingTop', 'paddingBottom'],
  pt: ['paddingTop'],
  pr: ['paddingRight'],
  pb: ['paddingBottom'],
  pl: ['paddingLeft'],
  rounded: ['cornerRadius'],
  'rounded-tl': ['topLeftRadius'],
  'rounded-tr': ['topRightRadius'],
  'rounded-br': ['bottomRightRadius'],
  'rounded-bl': ['bottomLeftRadius'],
  leading: ['lineHeight'],
  tracking: ['letterSpacing'],
  opacity: ['opacity']
}

function utilityBinding(
  token: string,
  parsed: NonNullable<ReturnType<typeof variableClass>>,
  value: ReturnType<typeof variableValue>,
  className: string
): { fields: VariableField[]; literal: string } {
  const { utility, hint } = parsed
  if (
    utility === 'bg' ||
    (utility === 'text' && hint !== 'length') ||
    (utility === 'border' && hint !== 'length')
  ) {
    if (hint && hint !== 'color') throw new Error(`Class "${token}" requires the color type hint.`)
    return {
      fields: [utility === 'border' ? 'stroke' : 'fill'],
      literal: `${utility}-[${colorLiteral(value, token)}]`
    }
  }
  if (utility === 'font' && hint === 'family-name') {
    if (typeof value !== 'string' || /[[\]"'\r\n\t]/.test(value))
      throw new Error(`Class "${token}" requires a STRING font-family variable.`)
    return {
      fields: ['fontFamily'],
      literal: `font-[family-name:${value.replaceAll('\\', '\\\\').replaceAll('_', '\\_').replaceAll(' ', '_')}]`
    }
  }
  let fields = Object.hasOwn(NUMBER_FIELDS, utility) ? NUMBER_FIELDS[utility] : undefined
  if (utility === 'text' && hint === 'length') fields = ['fontSize']
  if (utility === 'border' && hint === 'length') fields = ['strokeWeight']
  if (utility === 'font' && (!hint || hint === 'number')) fields = ['fontWeight']
  if (utility === 'gap' || utility === 'gap-x' || utility === 'gap-y') {
    const tokens = new Set(className.split(/\s+/))
    if (tokens.has('grid'))
      fields =
        utility === 'gap'
          ? ['gridRowGap', 'gridColumnGap']
          : utility === 'gap-x'
            ? ['gridColumnGap']
            : ['gridRowGap']
    else {
      const vertical = tokens.has('flex-col')
      fields =
        utility === 'gap'
          ? tokens.has('flex-wrap')
            ? ['gap', 'counterAxisSpacing']
            : ['gap']
          : (utility === 'gap-x') === vertical
            ? ['counterAxisSpacing']
            : ['gap']
    }
  }
  if (!fields || (hint && hint !== 'length' && hint !== 'number'))
    throw new Error(`Unsupported variable utility "${token}".`)
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Class "${token}" requires a FLOAT variable.`)
  return {
    fields,
    literal:
      utility === 'opacity'
        ? `opacity-[${value}]`
        : utility === 'font'
          ? `font-[${value}]`
          : `${utility}-[${value}px]`
  }
}

const TYPOGRAPHY_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textCase',
  'textDecoration'
] as const

const TYPOGRAPHY_VARIABLE_FIELDS = [
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphIndent',
  'paragraphSpacing'
] as const

function variableAttribute(field: string): string {
  return `data-var-${field.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

export function normalizeThemeClasses(
  element: CanvasMarkupElement,
  bindings: Record<string, CanvasBinding>,
  input: CanvasResolvedApplyParameters,
  catalog: DesignSystemCatalog | undefined,
  resources: ThemeResources
): CanvasMarkupElement {
  const key = element.attributes['data-key'] ?? ''
  const className = element.attributes.class ?? ''
  const variables: Partial<Record<VariableField, CanvasVariableReference>> = {}
  let textStyle: CanvasStyleReference | undefined
  const classes: string[] = []
  for (const token of className.split(/\s+/).filter(Boolean)) {
    const style = resources.textStyles.get(token)
    if (style) {
      if (textStyle) throw new Error(`Node "${key}" has more than one text-style class.`)
      textStyle = style
      continue
    }
    const parsed = variableClass(token)
    if (!parsed) {
      if (token.startsWith('type-'))
        throw new Error(
          `Unknown text-style class "${token}". Use a catalog className or declare theme.textStyles.`
        )
      classes.push(token)
      continue
    }
    const reference = resources.variables.get(parsed.name)
    if (!reference)
      throw new Error(
        `Unknown CSS variable "${parsed.name}". Use a catalog cssName or declare theme.variables.`
      )
    const mapped = utilityBinding(
      token,
      parsed,
      variableValue(reference, input, catalog, resources),
      className
    )
    for (const field of mapped.fields) {
      if (
        variables[field] !== undefined ||
        bindings[key]?.variables?.[field] !== undefined ||
        element.attributes[variableAttribute(field)] !== undefined
      ) {
        throw new Error(
          `Variable class "${token}" conflicts with another binding for ${field} on "${key}".`
        )
      }
      variables[field] = reference
    }
    classes.push(mapped.literal)
  }
  const variableFields = Object.keys(variables) as VariableField[]
  if (textStyle || variableFields.length) {
    const parsed = parseCanvasClasses(classes.join(' '))
    if (
      (bindings[key]?.styles?.text ||
        (element.attributes['data-style-text'] &&
          element.attributes['data-style-text'] !== 'none')) &&
      TYPOGRAPHY_VARIABLE_FIELDS.some((field) => variables[field] !== undefined)
    ) {
      throw new Error(`Typography variable classes on "${key}" conflict with its text style.`)
    }
    if (textStyle) {
      if (
        bindings[key]?.styles?.text !== undefined ||
        element.attributes['data-style-text'] !== undefined
      )
        throw new Error(`Text-style class on "${key}" conflicts with another text style.`)
      if (
        TYPOGRAPHY_FIELDS.some((field) => parsed[field] !== undefined) ||
        TYPOGRAPHY_VARIABLE_FIELDS.some((field) => variables[field] !== undefined)
      ) {
        throw new Error(
          `Text-style class on "${key}" owns typography; remove conflicting font, size, leading, tracking, case, or decoration classes.`
        )
      }
      const binding = bindings[key]
      if (
        (
          [
            'fontName',
            'case',
            'paragraphIndent',
            'paragraphSpacing',
            'listSpacing',
            'leadingTrim',
            'hangingPunctuation',
            'hangingList'
          ] as const
        ).some((field) => binding?.figma?.text?.[field] !== undefined) ||
        TYPOGRAPHY_VARIABLE_FIELDS.some(
          (field) =>
            binding?.variables?.[field] != null ||
            (element.attributes[variableAttribute(field)] !== undefined &&
              element.attributes[variableAttribute(field)] !== 'none')
        )
      ) {
        throw new Error(`Text-style class on "${key}" conflicts with native typography fields.`)
      }
    }
    resources.boundFields.set(key, variableFields)
    bindings[key] = {
      ...bindings[key],
      ...(variableFields.length
        ? { variables: { ...bindings[key]?.variables, ...variables } }
        : {}),
      ...(textStyle ? { styles: { ...bindings[key]?.styles, text: textStyle } } : {})
    }
  }
  return {
    ...element,
    attributes: { ...element.attributes, class: classes.join(' ') },
    children: element.children.map((child) =>
      normalizeThemeClasses(child, bindings, input, catalog, resources)
    )
  }
}
