import type {
  CanvasAssets,
  CanvasBinding,
  CanvasFigmaPaint,
  CanvasResolvedApplyParameters,
  CanvasStyleReference,
  CanvasStyleBindings,
  CanvasVariableReference,
  CanvasVariableBindings
} from '@tempad-dev/shared'

import { CanvasStableKeySchema, MAX_CANVAS_DEPTH, MAX_CANVAS_NODES } from '@tempad-dev/shared'

import type { CatalogComponent, DesignSystemCatalog } from '../design-system-catalog'
import type { CanvasMarkupElement } from './html'
import type {
  CanvasNodeTypeHints,
  CanvasNodeSpec,
  CanvasPreservedNodeType,
  CanvasShapeNodeType,
  CanvasSizingMode,
  ParsedCanvasInput
} from './model'
import type { CanvasClasses } from './tailwind'

import { parseCanvasHtml } from './html'
import { MAX_GRID_TRACKS, parseCanvasClasses } from './tailwind'

const ALLOWED_ATTRIBUTES = new Set(['class', 'data-key', 'data-node-id'])
const SIZE_VARIABLE_FIELDS = [
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight'
] as const
const SIZE_BOUND_FIELDS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const
const STROKE_SIDE_VARIABLE_FIELDS = [
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight'
] as const
const CORNER_SIDE_VARIABLE_FIELDS = [
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius'
] as const
const FRAME_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  'fill',
  'stroke',
  'visible',
  ...SIZE_VARIABLE_FIELDS,
  'gap',
  'counterAxisSpacing',
  'gridRowGap',
  'gridColumnGap',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'cornerRadius',
  ...CORNER_SIDE_VARIABLE_FIELDS,
  'strokeWeight',
  ...STROKE_SIDE_VARIABLE_FIELDS,
  'opacity'
])
const TEXT_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  'fill',
  'characters',
  'visible',
  ...SIZE_VARIABLE_FIELDS,
  'strokeWeight',
  'opacity',
  'fontFamily',
  'fontStyle',
  'fontWeight',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphIndent',
  'paragraphSpacing'
])
const INSTANCE_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  'visible',
  ...SIZE_VARIABLE_FIELDS,
  'cornerRadius',
  ...CORNER_SIDE_VARIABLE_FIELDS,
  'strokeWeight',
  ...STROKE_SIDE_VARIABLE_FIELDS,
  'opacity'
])
const SECTION_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  'fill',
  'stroke',
  'visible',
  'width',
  'height',
  'cornerRadius',
  ...CORNER_SIDE_VARIABLE_FIELDS,
  'strokeWeight'
])
const GROUP_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>(['visible', 'opacity'])
const BOOLEAN_OPERATION_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  'fill',
  'stroke',
  'visible',
  'cornerRadius',
  'strokeWeight',
  'opacity'
])
const BASE_SHAPE_VARIABLE_FIELDS = [
  'fill',
  'stroke',
  'visible',
  ...SIZE_VARIABLE_FIELDS,
  'opacity'
] as const satisfies ReadonlyArray<keyof CanvasVariableBindings>
const RECTANGLE_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  ...BASE_SHAPE_VARIABLE_FIELDS,
  'cornerRadius',
  ...CORNER_SIDE_VARIABLE_FIELDS,
  'strokeWeight',
  ...STROKE_SIDE_VARIABLE_FIELDS
])
const LINE_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  ...BASE_SHAPE_VARIABLE_FIELDS,
  'strokeWeight'
])
const ROUND_SHAPE_VARIABLE_FIELDS = new Set<keyof CanvasVariableBindings>([
  ...BASE_SHAPE_VARIABLE_FIELDS,
  'cornerRadius',
  'strokeWeight'
])
const VARIABLE_FIELDS = {
  BOOLEAN_OPERATION: BOOLEAN_OPERATION_VARIABLE_FIELDS,
  COMPONENT: FRAME_VARIABLE_FIELDS,
  COMPONENT_SET: FRAME_VARIABLE_FIELDS,
  FRAME: FRAME_VARIABLE_FIELDS,
  GROUP: GROUP_VARIABLE_FIELDS,
  TEXT: TEXT_VARIABLE_FIELDS,
  INSTANCE: INSTANCE_VARIABLE_FIELDS,
  SECTION: SECTION_VARIABLE_FIELDS,
  SLOT: FRAME_VARIABLE_FIELDS,
  RECTANGLE: RECTANGLE_VARIABLE_FIELDS,
  LINE: LINE_VARIABLE_FIELDS,
  ELLIPSE: ROUND_SHAPE_VARIABLE_FIELDS,
  POLYGON: ROUND_SHAPE_VARIABLE_FIELDS,
  STAR: ROUND_SHAPE_VARIABLE_FIELDS,
  VECTOR: ROUND_SHAPE_VARIABLE_FIELDS
} satisfies Record<CanvasNodeSpec['type'], Set<keyof CanvasVariableBindings>>
const SHAPE_STYLE_FIELDS = new Set<keyof CanvasStyleBindings>(['fill', 'stroke', 'effect'])
const FRAME_STYLE_FIELDS = new Set<keyof CanvasStyleBindings>(['fill', 'stroke', 'effect', 'grid'])
const STYLE_FIELDS = {
  BOOLEAN_OPERATION: SHAPE_STYLE_FIELDS,
  COMPONENT: FRAME_STYLE_FIELDS,
  COMPONENT_SET: FRAME_STYLE_FIELDS,
  FRAME: FRAME_STYLE_FIELDS,
  GROUP: new Set<keyof CanvasStyleBindings>(['effect']),
  TEXT: new Set<keyof CanvasStyleBindings>(['fill', 'stroke', 'text', 'effect']),
  INSTANCE: FRAME_STYLE_FIELDS,
  SECTION: new Set<keyof CanvasStyleBindings>(['fill', 'stroke']),
  SLOT: FRAME_STYLE_FIELDS,
  RECTANGLE: SHAPE_STYLE_FIELDS,
  LINE: SHAPE_STYLE_FIELDS,
  ELLIPSE: SHAPE_STYLE_FIELDS,
  POLYGON: SHAPE_STYLE_FIELDS,
  STAR: SHAPE_STYLE_FIELDS,
  VECTOR: SHAPE_STYLE_FIELDS
} satisfies Record<CanvasNodeSpec['type'], Set<keyof CanvasStyleBindings>>
const VARIABLE_ATTRIBUTES = new Map(
  [...new Set(Object.values(VARIABLE_FIELDS).flatMap((fields) => [...fields]))].map((field) => [
    `data-var-${field.replaceAll(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}`,
    field
  ])
)
const STYLE_ATTRIBUTES = new Map(
  [...new Set(Object.values(STYLE_FIELDS).flatMap((fields) => [...fields]))].map((field) => [
    `data-style-${field}`,
    field
  ])
)

function isInlineBindingAttribute(name: string): boolean {
  return VARIABLE_ATTRIBUTES.has(name) || STYLE_ATTRIBUTES.has(name)
}

function markupError(message: string): never {
  throw new Error(message)
}

function componentPropertyEntry(
  component: CatalogComponent,
  name: string,
  value: string,
  catalog: DesignSystemCatalog
): [string, NonNullable<CanvasBinding['componentProperties']>[string]] {
  const property = Object.hasOwn(component.properties, name)
    ? component.properties[name]
    : undefined
  if (!property) markupError(`Unsupported property "${name}" on <${component.tag}>.`)
  if (property.type === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      markupError(`Boolean property "${name}" on <${component.tag}> must be true or false.`)
    }
    return [property.name, value === 'true']
  }
  if (property.type === 'instance') {
    const replacement = catalog.entries.get(value)
    const reference =
      replacement?.kind === 'component'
        ? replacement.reference
        : catalog.componentReferences.get(value)
    if (!reference) {
      markupError(`Instance property "${name}" on <${component.tag}> requires a component ref.`)
    }
    if (!reference.id) {
      markupError(`Component ref "${value}" is not materialized in the current file.`)
    }
    return [property.name, reference.id]
  }
  if (property.type === 'variant' && property.options && !property.options.includes(value)) {
    markupError(`Property "${name}" on <${component.tag}> has no variant "${value}".`)
  }
  return [property.name, value]
}

function normalizeCatalogElement(
  element: CanvasMarkupElement,
  bindings: Record<string, CanvasBinding>,
  catalog: DesignSystemCatalog | undefined
): CanvasMarkupElement {
  if (element.tag === 'div' || element.tag === 'span') {
    if (element.attributes['data-ref']) {
      markupError(`data-ref is only valid on a catalog component tag.`)
    }
    return {
      ...element,
      children: element.children.map((child) => normalizeCatalogElement(child, bindings, catalog))
    }
  }
  if (!catalog) markupError(`Catalog component <${element.tag}> requires catalogId.`)
  const component = catalog.tags.get(element.tag)
  if (!component) {
    markupError(`Unknown component tag <${element.tag}> in catalog "${catalog.id}".`)
  }
  if (element.children.length || hasText(element.text)) {
    markupError(`Catalog component <${element.tag}> must be childless.`)
  }
  if (element.attributes['data-ref'] !== component.ref) {
    markupError(`<${element.tag}> requires data-ref="${component.ref}".`)
  }
  const keyResult = CanvasStableKeySchema.safeParse(element.attributes['data-key'])
  if (!keyResult.success) {
    markupError(`Catalog component <${element.tag}> requires a valid, stable data-key.`)
  }
  const key = keyResult.data
  const properties = Object.fromEntries(
    Object.entries(element.attributes)
      .filter(
        ([name]) =>
          !['class', 'data-key', 'data-node-id', 'data-ref'].includes(name) &&
          !isInlineBindingAttribute(name)
      )
      .map(([name, value]) => componentPropertyEntry(component, name, value, catalog))
  )
  const existing = bindings[key]
  bindings[key] = {
    ...(existing ?? {}),
    component: component.reference,
    ...(Object.keys(properties).length ? { componentProperties: properties } : {})
  }
  const classes = parseCanvasClasses(element.attributes.class ?? '')
  const className = [
    element.attributes.class,
    classes.width ? undefined : `w-[${component.nativeSize.width}px]`,
    classes.height ? undefined : `h-[${component.nativeSize.height}px]`
  ]
    .filter(Boolean)
    .join(' ')
  return {
    tag: 'div',
    text: '',
    children: [],
    lineBreakOffsets: [],
    attributes: {
      'data-key': key,
      ...(element.attributes['data-node-id']
        ? { 'data-node-id': element.attributes['data-node-id'] }
        : {}),
      ...Object.fromEntries(
        Object.entries(element.attributes).filter(([name]) => isInlineBindingAttribute(name))
      ),
      class: className
    }
  }
}

function hasText(value: string): boolean {
  return /[^\t\n\f\r ]/.test(value)
}

function textContent(value: string, preserve: boolean, lineBreakOffsets: number[]): string {
  const normalize = preserve
    ? (segment: string) => segment
    : (segment: string) => segment.replace(/[\t\n\f\r ]+/g, ' ').trim()
  if (!lineBreakOffsets.length) return normalize(value)

  let start = 0
  const segments = lineBreakOffsets.map((offset) => {
    const segment = normalize(value.slice(start, offset))
    start = offset
    return segment
  })
  segments.push(normalize(value.slice(start)))
  return segments.join('\n')
}

function textAutoResize(
  horizontal: CanvasSizingMode,
  vertical: CanvasSizingMode
): NonNullable<CanvasNodeSpec['text']>['autoResize'] {
  return horizontal === 'HUG' ? 'WIDTH_AND_HEIGHT' : vertical === 'HUG' ? 'HEIGHT' : 'NONE'
}

const SHAPE_TYPES = new Set<CanvasShapeNodeType>([
  'RECTANGLE',
  'LINE',
  'ELLIPSE',
  'POLYGON',
  'STAR',
  'VECTOR'
])

function isShapeType(type: CanvasNodeSpec['type']): type is CanvasShapeNodeType {
  return SHAPE_TYPES.has(type as CanvasShapeNodeType)
}

function isFrameContainerType(
  type: CanvasNodeSpec['type']
): type is 'COMPONENT' | 'COMPONENT_SET' | 'FRAME' | 'SLOT' {
  return type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'FRAME' || type === 'SLOT'
}

function hasShapeAppearance(type: CanvasNodeSpec['type']): boolean {
  return type === 'BOOLEAN_OPERATION' || isShapeType(type)
}

function isIntrinsicContainer(type: CanvasNodeSpec['type']): boolean {
  return type === 'BOOLEAN_OPERATION' || type === 'GROUP'
}

function hasFields(value: object): boolean {
  return Object.keys(value).length > 0
}

function nodeType(
  element: CanvasMarkupElement,
  binding: CanvasBinding | undefined,
  existingNodeType?: CanvasPreservedNodeType
): CanvasNodeSpec['type'] {
  if (element.tag === 'span') return 'TEXT'
  if (binding?.component || binding?.componentProperties || binding?.figma?.instance) {
    return 'INSTANCE'
  }
  if (binding?.figma?.component) return binding.figma.component.type
  if (binding?.figma?.slot) return 'SLOT'
  if (binding?.figma?.section) return 'SECTION'
  if (binding?.figma?.group) return 'GROUP'
  if (binding?.figma?.booleanOperation) return 'BOOLEAN_OPERATION'
  return binding?.figma?.shape?.type ?? existingNodeType ?? 'FRAME'
}

function hasVariable(
  variables: CanvasVariableBindings | undefined,
  fields: ReadonlyArray<keyof CanvasVariableBindings>
): boolean {
  return fields.some((field) => variables?.[field] != null)
}

function hasStrokeWeight(binding: CanvasBinding | undefined, classes: CanvasClasses): boolean {
  return (
    classes.strokeWeight !== undefined ||
    hasFields(classes.strokeWeights) ||
    binding?.figma?.stroke?.weight !== undefined ||
    binding?.figma?.stroke?.weights !== undefined ||
    binding?.variables?.strokeWeight != null ||
    hasVariable(binding?.variables, STROKE_SIDE_VARIABLE_FIELDS)
  )
}

function validateAttributes(element: CanvasMarkupElement): {
  className: string
  key: string
  nodeId?: string
} {
  for (const name of Object.keys(element.attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(name) && !isInlineBindingAttribute(name)) {
      markupError(`Unsupported attribute "${name}" on <${element.tag}>.`)
    }
  }
  const key = element.attributes['data-key']
  const parsedKey = CanvasStableKeySchema.safeParse(key)
  if (!parsedKey.success) {
    markupError('Every element requires a valid, stable data-key.')
  }
  const nodeId = element.attributes['data-node-id']?.trim()
  if (nodeId !== undefined && (!nodeId || nodeId.length > 200)) {
    markupError(`data-node-id on "${key}" must be a non-empty Figma node ID.`)
  }
  return {
    className: element.attributes.class ?? '',
    key: parsedKey.data,
    ...(nodeId === undefined ? {} : { nodeId })
  }
}

function validateVariables(
  key: string,
  type: CanvasNodeSpec['type'],
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): void {
  const variables = binding?.variables
  if (!variables) return
  const allowed = VARIABLE_FIELDS[type]
  for (const field of Object.keys(variables) as Array<keyof CanvasVariableBindings>) {
    if (!allowed.has(field)) {
      markupError(`Variable field "${field}" is not supported on ${type} node "${key}".`)
    }
    if (variables[field] === null) continue
    if (field === 'width' && classes.width?.mode !== 'FIXED') {
      markupError(`Width variable on "${key}" requires a fixed width fallback.`)
    }
    if (field === 'height' && classes.height?.mode !== 'FIXED') {
      markupError(`Height variable on "${key}" requires a fixed height fallback.`)
    }
    if (field === 'gap' && !classes.direction) {
      markupError(`Variable field "${field}" requires flex layout on "${key}".`)
    }
    if (field.startsWith('padding') && !classes.direction && !classes.grid) {
      markupError(`Variable field "${field}" requires auto layout on "${key}".`)
    }
    if (field === 'counterAxisSpacing' && classes.wrap !== 'WRAP') {
      markupError(`Variable field "${field}" requires flex-wrap on "${key}".`)
    }
    if ((field === 'gridRowGap' || field === 'gridColumnGap') && !classes.grid) {
      markupError(`Variable field "${field}" requires grid layout on "${key}".`)
    }
  }
  if (
    variables.fill &&
    (isFrameContainerType(type) || type === 'SECTION' || hasShapeAppearance(type)) &&
    !classes.fill
  ) {
    markupError(`Fill variable on "${key}" requires a solid bg-[#RRGGBB] fallback.`)
  }
  if (
    variables.stroke &&
    (isFrameContainerType(type) || type === 'SECTION' || hasShapeAppearance(type)) &&
    (!classes.stroke || !hasStrokeWeight(binding, classes))
  ) {
    markupError(`Stroke variable on "${key}" requires border width and color fallbacks.`)
  }
}

function validateStyles(
  key: string,
  type: CanvasNodeSpec['type'],
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): void {
  const styles = binding?.styles
  if (!styles) return
  const variables = binding.variables
  for (const field of Object.keys(styles) as Array<keyof CanvasStyleBindings>) {
    if (!STYLE_FIELDS[type].has(field)) {
      markupError(`Style field "${field}" is not supported on ${type} node "${key}".`)
    }
  }
  if (styles.fill && variables?.fill !== undefined) {
    markupError(`Fill style and variable bindings cannot be combined on "${key}".`)
  }
  if (styles.stroke && variables?.stroke !== undefined) {
    markupError(`Stroke style and variable bindings cannot be combined on "${key}".`)
  }
  if (
    styles.stroke &&
    (isFrameContainerType(type) || type === 'SECTION' || hasShapeAppearance(type)) &&
    !hasStrokeWeight(binding, classes)
  ) {
    markupError(`Stroke style on "${key}" requires border weight fallback.`)
  }
}

function validateEffects(
  key: string,
  type: CanvasNodeSpec['type'],
  binding: CanvasBinding | undefined
): void {
  const effects = binding?.figma?.effects
  if (effects === undefined) return
  if (binding?.styles?.effect) {
    markupError(`Direct effects and an effect style cannot be combined on "${key}".`)
  }
  if (type === 'SECTION') {
    markupError(`Direct effects are not supported on SECTION node "${key}".`)
  }
  if (
    !isFrameContainerType(type) &&
    type !== 'INSTANCE' &&
    type !== 'RECTANGLE' &&
    type !== 'ELLIPSE' &&
    effects.some(
      (effect) =>
        (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') &&
        (effect.spread !== undefined || effect.variables?.spread !== undefined)
    )
  ) {
    markupError(`Shadow spread is not supported on ${type} node "${key}".`)
  }
}

function applyClassEffects(
  key: string,
  type: CanvasNodeSpec['type'],
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): CanvasBinding | undefined {
  const hasBoxShadows = classes.boxShadows !== undefined || classes.insetShadows !== undefined
  const hasTextShadows = classes.textShadows !== undefined
  if (!hasBoxShadows && !hasTextShadows) return binding
  if (type === 'TEXT' ? hasBoxShadows : hasTextShadows) {
    markupError(
      `${type === 'TEXT' ? 'Box' : 'Text'} shadow classes are not supported on ${type} node "${key}".`
    )
  }
  if (binding?.figma?.effects !== undefined) {
    markupError(`Shadow classes and direct effects cannot be combined on "${key}".`)
  }
  if (binding?.styles?.effect) {
    markupError(`Shadow classes and an effect style cannot be combined on "${key}".`)
  }
  const effects =
    type === 'TEXT'
      ? classes.textShadows!
      : [...(classes.boxShadows ?? []), ...(classes.insetShadows ?? [])]
  return { ...binding, figma: { ...binding?.figma, effects } }
}

function validatePaints(
  key: string,
  type: CanvasNodeSpec['type'],
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): void {
  for (const [field, paints] of [
    ['fill', binding?.figma?.fills],
    ['stroke', binding?.figma?.strokes]
  ] as const) {
    if (paints === undefined) continue
    if (type === 'GROUP') {
      markupError(`Direct ${field} paints are not supported on GROUP node "${key}".`)
    }
    if (binding?.styles?.[field]) {
      markupError(`Direct ${field} paints and a ${field} style cannot be combined on "${key}".`)
    }
    if (binding?.variables?.[field] !== undefined) {
      markupError(`Direct ${field} paints and a ${field} variable cannot be combined on "${key}".`)
    }
    if (classes[field] !== undefined) {
      markupError(`Direct ${field} paints and a literal ${field} cannot be combined on "${key}".`)
    }
  }
}

function validateFigmaLayout(
  key: string,
  type: CanvasNodeSpec['type'],
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): void {
  const properties = binding?.figma
  const autoLayout = properties?.autoLayout
  if (autoLayout) {
    if (!isFrameContainerType(type) || !classes.flex) {
      markupError(`Figma Auto Layout properties on "${key}" require a flex frame container.`)
    }
    const mainGap = classes.direction === 'HORIZONTAL' ? classes.columnGap : classes.rowGap
    if (
      autoLayout.itemSpacing !== undefined &&
      (classes.gap !== undefined || mainGap !== undefined)
    ) {
      markupError(`Main-axis spacing on "${key}" cannot use both classes and Figma properties.`)
    }
    if (autoLayout.counterAxisSpacing !== undefined) {
      if (classes.wrap !== 'WRAP') {
        markupError(`Figma counter-axis spacing on "${key}" requires flex-wrap.`)
      }
      const counterGap = classes.direction === 'HORIZONTAL' ? classes.rowGap : classes.columnGap
      if (classes.gap !== undefined || counterGap !== undefined) {
        markupError(
          `Counter-axis spacing on "${key}" cannot use both classes and Figma properties.`
        )
      }
      if (autoLayout.counterAxisSpacing === null && binding?.variables?.counterAxisSpacing) {
        markupError(
          `Synchronized counter-axis spacing and a counter-axis variable cannot be combined on "${key}".`
        )
      }
    }
  }

  if (properties?.layoutGrids !== undefined || properties?.guides !== undefined) {
    if (!isFrameContainerType(type) && type !== 'INSTANCE') {
      markupError(`Layout grids and guides are not supported on ${type} node "${key}".`)
    }
  }
  if (properties?.layoutGrids !== undefined && binding?.styles?.grid) {
    markupError(`Direct layout grids and a grid style cannot be combined on "${key}".`)
  }
}

function validateTextRanges(key: string, characters: string, binding: CanvasBinding | undefined) {
  for (const [index, range] of (binding?.figma?.text?.ranges ?? []).entries()) {
    if (range.end > characters.length) {
      markupError(
        `Text range ${index} on "${key}" ends at ${range.end}, beyond its ${characters.length} UTF-16 code units.`
      )
    }
  }
}

function validateTextFont(
  key: string,
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): void {
  if (!binding?.figma?.text?.fontName) return
  if (classes.fontFamily !== undefined || classes.fontStyle !== undefined) {
    markupError(`Font on "${key}" cannot use both classes and an exact Figma font name.`)
  }
  if (binding.variables?.fontFamily || binding.variables?.fontStyle) {
    markupError(`Font on "${key}" cannot use both variables and an exact Figma font name.`)
  }
  if (binding.styles?.text) {
    markupError(`Font on "${key}" cannot use both a Text style and an exact Figma font name.`)
  }
}

type CompileState = {
  bindings: Record<string, CanvasBinding>
  catalog?: DesignSystemCatalog
  count: number
  existingNodeTypes?: CanvasNodeTypeHints
  keys: Set<string>
  mode: CanvasResolvedApplyParameters['mode']
  nodeIds: Set<string>
}

function applyInlineBindings(element: CanvasMarkupElement, key: string, state: CompileState): void {
  let binding = state.bindings[key]
  for (const [attribute, ref] of Object.entries(element.attributes)) {
    const variableField = VARIABLE_ATTRIBUTES.get(attribute)
    const styleField = STYLE_ATTRIBUTES.get(attribute)
    if (!variableField && !styleField) continue
    const field = variableField ?? styleField!
    const values = variableField ? binding?.variables : binding?.styles
    if (values && field in values) {
      markupError(`Binding "${field}" on "${key}" is declared more than once.`)
    }
    let reference: CanvasStyleReference | CanvasVariableReference | null
    if (ref === 'none') {
      reference = null
    } else {
      if (!state.catalog) markupError(`Design-system ref "${ref}" requires catalogId.`)
      const entry = state.catalog.entries.get(ref)
      const kind = variableField ? 'variable' : 'style'
      if (!entry) {
        markupError(`Unknown design-system ref "${ref}" in catalog "${state.catalog.id}".`)
      }
      if (entry.kind !== kind) {
        markupError(`Design-system ref "${ref}" is ${entry.kind}, not ${kind}.`)
      }
      if (!('reference' in entry)) {
        markupError(`Design-system ref "${ref}" cannot be applied as a binding.`)
      }
      reference = entry.reference
    }
    binding = variableField
      ? {
          ...(binding ?? {}),
          variables: {
            ...binding?.variables,
            [variableField]: reference as CanvasVariableReference | null
          }
        }
      : {
          ...(binding ?? {}),
          styles: {
            ...binding?.styles,
            [styleField!]: reference as CanvasStyleReference | null
          }
        }
  }
  if (binding) state.bindings[key] = binding
}

function validateSizeBounds(
  key: string,
  axis: 'height' | 'width',
  size: NonNullable<CanvasClasses['width']>,
  min: number | null | undefined,
  max: number | null | undefined
): void {
  if (min !== undefined && min !== null && max !== undefined && max !== null && min > max) {
    markupError(`min-${axis} on "${key}" cannot exceed max-${axis}.`)
  }
  const value = size.value
  if (size.mode !== 'FIXED' || value === undefined) return
  if (min !== undefined && min !== null && value < min) {
    markupError(`${axis} on "${key}" cannot be smaller than its minimum.`)
  }
  if (max !== undefined && max !== null && value > max) {
    markupError(`${axis} on "${key}" cannot exceed its maximum.`)
  }
}

function hasStrokePaint(binding: CanvasBinding | undefined, classes: CanvasClasses): boolean {
  if (binding?.figma?.strokes !== undefined) return binding.figma.strokes.length > 0
  return (
    classes.stroke !== undefined ||
    binding?.styles?.stroke != null ||
    binding?.variables?.stroke != null
  )
}

function includedStrokeSize(
  axis: 'height' | 'width',
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): number {
  if (
    classes.strokesIncluded === false ||
    (binding?.figma?.stroke?.align !== undefined && binding.figma.stroke.align !== 'INSIDE') ||
    !hasStrokePaint(binding, classes)
  ) {
    return 0
  }
  const appearance = strokeAppearance(binding, classes, true)
  if (appearance.strokeWeight !== undefined) return appearance.strokeWeight * 2
  return axis === 'width'
    ? (appearance.strokeLeftWeight ?? 0) + (appearance.strokeRightWeight ?? 0)
    : (appearance.strokeTopWeight ?? 0) + (appearance.strokeBottomWeight ?? 0)
}

function validateNewAutoLayoutMinimum(
  key: string,
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): void {
  for (const [axis, start, end] of [
    ['width', 'left', 'right'],
    ['height', 'top', 'bottom']
  ] as const) {
    const size = classes[axis]!
    if (size.mode !== 'FIXED' || size.value === undefined) continue
    const minimum =
      (classes.padding[start] ?? 0) +
      (classes.padding[end] ?? 0) +
      includedStrokeSize(axis, binding, classes)
    if (size.value < minimum) {
      markupError(
        `${axis} on new Auto Layout "${key}" must be at least ${minimum}px to fit its padding and included inside stroke.`
      )
    }
  }
}

type GridPlacement = {
  columns: number
  rows: number
  manual: boolean
  occupied: Set<string>
}

function gridAreaFits(
  placement: GridPlacement,
  row: number,
  column: number,
  rowSpan: number,
  columnSpan: number
): boolean {
  if (column + columnSpan > placement.columns || row + rowSpan > placement.rows) {
    return false
  }
  for (let currentRow = row; currentRow < row + rowSpan; currentRow += 1) {
    for (let currentColumn = column; currentColumn < column + columnSpan; currentColumn += 1) {
      if (placement.occupied.has(`${currentRow}:${currentColumn}`)) return false
    }
  }
  return true
}

function occupyGridArea(
  placement: GridPlacement,
  row: number,
  column: number,
  rowSpan: number,
  columnSpan: number
): void {
  for (let currentRow = row; currentRow < row + rowSpan; currentRow += 1) {
    for (let currentColumn = column; currentColumn < column + columnSpan; currentColumn += 1) {
      placement.occupied.add(`${currentRow}:${currentColumn}`)
    }
  }
}

function placeGridChild(
  key: string,
  classes: CanvasClasses,
  placement: GridPlacement
): NonNullable<CanvasNodeSpec['gridChild']> {
  const rowSpan = classes.gridRowSpan ?? 1
  const columnSpan = classes.gridColumnSpan ?? 1
  const hasRow = classes.gridRow !== undefined
  const hasColumn = classes.gridColumn !== undefined
  if (hasRow !== hasColumn) {
    markupError(`Grid child "${key}" must provide both row-start and col-start.`)
  }
  if (!placement.manual && hasRow) {
    markupError(`Grid child "${key}" cannot use explicit placement with grid-flow-row.`)
  }

  let row = classes.gridRow
  let column = classes.gridColumn
  if (row === undefined || column === undefined) {
    for (let candidateRow = 0; candidateRow < placement.rows; candidateRow += 1) {
      for (let candidateColumn = 0; candidateColumn < placement.columns; candidateColumn += 1) {
        if (gridAreaFits(placement, candidateRow, candidateColumn, rowSpan, columnSpan)) {
          row = candidateRow
          column = candidateColumn
          break
        }
      }
      if (row !== undefined) break
    }
  }
  if (
    row === undefined ||
    column === undefined ||
    !gridAreaFits(placement, row, column, rowSpan, columnSpan)
  ) {
    markupError(`Grid child "${key}" does not fit in an unoccupied grid area.`)
  }
  occupyGridArea(placement, row, column, rowSpan, columnSpan)

  return {
    ...(placement.manual ? { row, column } : {}),
    rowSpan,
    columnSpan,
    horizontalAlign: classes.gridHorizontalAlign ?? 'AUTO',
    verticalAlign: classes.gridVerticalAlign ?? 'AUTO'
  }
}

function strokeAppearance(
  binding: CanvasBinding | undefined,
  classes: CanvasClasses,
  includeDefault: boolean
): Partial<NonNullable<CanvasNodeSpec['appearance']>> {
  const stroke = binding?.figma?.stroke
  const variables = binding?.variables
  const individual =
    stroke?.weights !== undefined ||
    hasFields(classes.strokeWeights) ||
    hasVariable(variables, STROKE_SIDE_VARIABLE_FIELDS)
  const uniform = stroke?.weight ?? classes.strokeWeight ?? 0
  if (individual) {
    return {
      strokeTopWeight: stroke?.weights?.top ?? classes.strokeWeights.top ?? uniform,
      strokeRightWeight: stroke?.weights?.right ?? classes.strokeWeights.right ?? uniform,
      strokeBottomWeight: stroke?.weights?.bottom ?? classes.strokeWeights.bottom ?? uniform,
      strokeLeftWeight: stroke?.weights?.left ?? classes.strokeWeights.left ?? uniform
    }
  }
  const weight = stroke?.weight ?? classes.strokeWeight
  return weight === undefined && !includeDefault ? {} : { strokeWeight: weight ?? 0 }
}

function cornerAppearance(
  binding: CanvasBinding | undefined,
  classes: CanvasClasses,
  includeDefault: boolean
): Partial<NonNullable<CanvasNodeSpec['appearance']>> {
  const corners = binding?.figma?.corners
  const variables = binding?.variables
  const individual =
    corners?.radii !== undefined ||
    hasFields(classes.cornerRadii) ||
    hasVariable(variables, CORNER_SIDE_VARIABLE_FIELDS)
  const uniform = corners?.radius ?? classes.cornerRadius ?? 0
  if (individual) {
    return {
      topLeftRadius: corners?.radii?.topLeft ?? classes.cornerRadii.topLeft ?? uniform,
      topRightRadius: corners?.radii?.topRight ?? classes.cornerRadii.topRight ?? uniform,
      bottomRightRadius: corners?.radii?.bottomRight ?? classes.cornerRadii.bottomRight ?? uniform,
      bottomLeftRadius: corners?.radii?.bottomLeft ?? classes.cornerRadii.bottomLeft ?? uniform
    }
  }
  const radius = corners?.radius ?? classes.cornerRadius
  return radius === undefined && !includeDefault ? {} : { cornerRadius: radius ?? 0 }
}

function fillStrokeAppearance(
  binding: CanvasBinding | undefined,
  classes: CanvasClasses
): Partial<NonNullable<CanvasNodeSpec['appearance']>> {
  return {
    ...(binding?.figma?.fills !== undefined || classes.fill === undefined
      ? {}
      : { fill: classes.fill }),
    ...(binding?.figma?.strokes !== undefined || classes.stroke === undefined
      ? {}
      : { stroke: classes.stroke }),
    ...strokeAppearance(binding, classes, false),
    ...cornerAppearance(binding, classes, false)
  }
}

function compileElement(
  element: CanvasMarkupElement,
  state: CompileState,
  depth: number,
  parent?: CanvasNodeSpec,
  gridPlacement?: GridPlacement,
  insideComponent = false
): CanvasNodeSpec {
  state.count += 1
  if (state.count > MAX_CANVAS_NODES) {
    markupError(
      `Canvas markup contains more than ${MAX_CANVAS_NODES} elements. Keep one root and split the update at a meaningful screen or section boundary; omitted siblings are preserved.`
    )
  }
  if (depth > MAX_CANVAS_DEPTH) {
    markupError(`Canvas markup may be at most ${MAX_CANVAS_DEPTH} levels deep.`)
  }

  const { className, key, nodeId } = validateAttributes(element)
  if (state.keys.has(key)) markupError(`Duplicate data-key "${key}".`)
  state.keys.add(key)
  if (nodeId) {
    if (state.mode === 'create') {
      markupError(`Create mode cannot use data-node-id on "${key}".`)
    }
    if (state.nodeIds.has(nodeId)) markupError(`Duplicate data-node-id "${nodeId}".`)
    state.nodeIds.add(nodeId)
  }

  applyInlineBindings(element, key, state)
  const classes = parseCanvasClasses(className)
  if (!classes.width || !classes.height) {
    markupError(`Element "${key}" requires exactly one width and one height class.`)
  }
  if (
    classes.gap !== undefined &&
    (classes.columnGap !== undefined || classes.rowGap !== undefined)
  ) {
    markupError(`Element "${key}" cannot combine gap-[Npx] with gap-x/y-[Npx].`)
  }

  const declaredBinding = state.bindings[key]
  const existingNodeType =
    state.mode === 'update'
      ? depth === 1
        ? state.existingNodeTypes?.root
        : ((nodeId === undefined ? undefined : state.existingNodeTypes?.byNodeId.get(nodeId)) ??
          state.existingNodeTypes?.byKey.get(key))
      : undefined
  const type = nodeType(element, declaredBinding, existingNodeType)
  const binding = applyClassEffects(key, type, declaredBinding, classes)
  const shapeType = binding?.figma?.shape?.type
  const nativeStroke = binding?.figma?.stroke
  const nativeCorners = binding?.figma?.corners
  const hasStrokeClasses = classes.strokeWeight !== undefined || hasFields(classes.strokeWeights)
  const hasCornerClasses = classes.cornerRadius !== undefined || hasFields(classes.cornerRadii)
  const characters =
    element.tag === 'span'
      ? textContent(element.text, !!classes.preserveWhitespace, element.lineBreakOffsets)
      : ''

  if ((nativeStroke?.weight !== undefined || nativeStroke?.weights) && hasStrokeClasses) {
    markupError(`Stroke weights on "${key}" cannot use both classes and Figma properties.`)
  }
  if ((nativeCorners?.radius !== undefined || nativeCorners?.radii) && hasCornerClasses) {
    markupError(`Corner radii on "${key}" cannot use both classes and Figma properties.`)
  }
  if (
    (hasFields(classes.strokeWeights) || nativeStroke?.weights) &&
    !isFrameContainerType(type) &&
    type !== 'INSTANCE' &&
    type !== 'RECTANGLE'
  ) {
    markupError(`Individual stroke weights are not supported on ${type} node "${key}".`)
  }
  if (
    hasFields(classes.cornerRadii) &&
    !isFrameContainerType(type) &&
    type !== 'SECTION' &&
    type !== 'RECTANGLE'
  ) {
    markupError(`Individual corner classes are not supported on ${type} node "${key}".`)
  }
  if (nativeCorners && (type === 'TEXT' || type === 'LINE')) {
    markupError(`Figma corner properties are not supported on ${type} node "${key}".`)
  }
  if (
    nativeCorners?.radii &&
    !isFrameContainerType(type) &&
    type !== 'INSTANCE' &&
    type !== 'SECTION' &&
    type !== 'RECTANGLE'
  ) {
    markupError(`Individual corner radii are not supported on ${type} node "${key}".`)
  }

  if (element.tag === 'span') {
    if (element.children.length) markupError(`span "${key}" cannot contain elements.`)
    if (classes.frameClass || classes.layoutClass) {
      markupError(
        `Class "${classes.frameClass ?? classes.layoutClass}" is not supported on span "${key}".`
      )
    }
    if (binding?.component) markupError(`Component binding "${key}" requires a childless div.`)
    if (shapeType) markupError(`Native shape binding "${key}" requires a childless div.`)
    if (binding?.figma?.section) markupError(`Native section binding "${key}" requires a div.`)
    if (binding?.figma?.group) markupError(`Native group binding "${key}" requires a div.`)
    if (binding?.figma?.booleanOperation) {
      markupError(`Native boolean-operation binding "${key}" requires a div.`)
    }
    if (binding?.figma?.component) {
      markupError(`Native authored-component binding "${key}" requires a div.`)
    }
    if (binding?.figma?.slot) markupError(`Native slot binding "${key}" requires a div.`)
    if (binding?.figma?.svg) markupError(`SVG binding "${key}" requires a childless div.`)
    validateTextFont(key, binding, classes)
    validateTextRanges(key, characters, binding)
  } else {
    if (hasText(element.text)) markupError(`div "${key}" cannot contain direct text.`)
    if (classes.textClass) {
      markupError(`Class "${classes.textClass}" is not supported on div "${key}".`)
    }
  }

  if (type === 'INSTANCE') {
    if (element.children.length) markupError(`Component placeholder "${key}" must be childless.`)
    if (classes.frameClass || classes.layoutClass) {
      markupError(
        `Class "${classes.frameClass ?? classes.layoutClass}" is not supported on component "${key}".`
      )
    }
  }
  if (binding?.figma?.svg && element.children.length) {
    markupError(`SVG binding "${key}" requires a childless div.`)
  }
  if (binding?.figma?.svg && classes.layoutClass) {
    markupError(`SVG wrapper "${key}" cannot define an internal layout.`)
  }
  if (
    state.mode === 'create' &&
    (isFrameContainerType(type) || type === 'SECTION' || hasShapeAppearance(type)) &&
    !binding?.styles?.stroke &&
    binding?.figma?.strokes === undefined &&
    (classes.stroke !== undefined) !== hasStrokeWeight(binding, classes)
  ) {
    markupError(`Border on "${key}" requires both stroke weight and paint sources.`)
  }
  if (isShapeType(type)) {
    if (element.children.length) markupError(`Native shape "${key}" must be childless.`)
    const vector = binding?.figma?.shape
    if (
      vector?.type === 'VECTOR' &&
      state.mode === 'create' &&
      !vector.paths?.length &&
      !vector.network?.vertices.length
    ) {
      markupError(`New vector "${key}" requires at least one path or network vertex.`)
    }
    if (classes.layoutClass) {
      markupError(`Layout class "${classes.layoutClass}" is not supported on shape "${key}".`)
    }
    if (classes.clipsContent !== undefined) {
      markupError(`Overflow classes are not supported on shape "${key}".`)
    }
    if (classes.width.mode === 'HUG' || classes.height.mode === 'HUG') {
      markupError(`Native shape "${key}" cannot use hug sizing.`)
    }
    if (type === 'LINE') {
      if (classes.height.mode !== 'FIXED' || classes.height.value !== 0) {
        markupError(`Line "${key}" requires h-[0px]; its length is represented by width.`)
      }
      if (
        classes.minHeight !== undefined ||
        classes.maxHeight !== undefined ||
        binding?.variables?.height ||
        binding?.variables?.minHeight ||
        binding?.variables?.maxHeight
      ) {
        markupError(`Line "${key}" cannot bind or constrain its zero height.`)
      }
      if (
        hasCornerClasses ||
        binding?.variables?.cornerRadius ||
        hasVariable(binding?.variables, CORNER_SIDE_VARIABLE_FIELDS)
      ) {
        markupError(`Line "${key}" does not support corner radius.`)
      }
      if (binding?.figma?.aspectRatioLocked !== undefined) {
        markupError(`Line "${key}" does not support aspect-ratio locking.`)
      }
    }
  }
  if (parent?.type === 'BOOLEAN_OPERATION' && type !== 'TEXT' && !hasShapeAppearance(type)) {
    markupError(
      `Boolean operation "${parent.key}" can contain only text, basic shapes, or nested boolean operations.`
    )
  }
  if (parent?.type === 'COMPONENT_SET' && type !== 'COMPONENT') {
    markupError(`Component set "${parent.key}" can contain only component nodes.`)
  }
  if (type === 'SLOT' && !insideComponent && !(state.mode === 'update' && parent === undefined)) {
    markupError(`Slot "${key}" must be nested inside an authored component.`)
  }
  if (
    insideComponent &&
    (type === 'COMPONENT' || type === 'COMPONENT_SET') &&
    parent?.type !== 'COMPONENT_SET'
  ) {
    markupError(`Authored component "${key}" cannot be nested inside another component.`)
  }
  if (isIntrinsicContainer(type)) {
    if (classes.width.mode !== 'HUG' || classes.height.mode !== 'HUG') {
      markupError(`${type} node "${key}" requires intrinsic w-fit and h-fit sizing.`)
    }
    if (classes.layoutClass) {
      markupError(
        `Layout class "${classes.layoutClass}" is not supported on ${type} node "${key}".`
      )
    }
    if (classes.grow) markupError(`${type} node "${key}" cannot grow.`)
    if (
      classes.minWidth !== undefined ||
      classes.maxWidth !== undefined ||
      classes.minHeight !== undefined ||
      classes.maxHeight !== undefined
    ) {
      markupError(`Min/max sizing is not supported on intrinsic ${type} node "${key}".`)
    }
    if (
      binding?.variables &&
      ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'].some(
        (field) => binding.variables?.[field as keyof CanvasVariableBindings] !== undefined
      )
    ) {
      markupError(`Size variables are not supported on intrinsic ${type} node "${key}".`)
    }
  }
  if (type === 'GROUP') {
    if (classes.frameClass) {
      markupError(`Appearance class "${classes.frameClass}" is not supported on group "${key}".`)
    }
    if (
      binding?.figma?.stroke ||
      binding?.figma?.corners ||
      binding?.figma?.fills !== undefined ||
      binding?.figma?.strokes !== undefined
    ) {
      markupError(`Fill, stroke, and corner properties are not supported on group "${key}".`)
    }
  }
  if (type === 'BOOLEAN_OPERATION' && classes.clipsContent !== undefined) {
    markupError(`Overflow classes are not supported on boolean operation "${key}".`)
  }
  if (type === 'SECTION') {
    if (parent && parent.type !== 'SECTION') {
      markupError(`Section "${key}" can only be a canvas root or a direct child of a section.`)
    }
    if (classes.layoutClass) {
      markupError(`Layout class "${classes.layoutClass}" is not supported on section "${key}".`)
    }
    if (classes.width.mode !== 'FIXED' || classes.height.mode !== 'FIXED') {
      markupError(`Section "${key}" requires fixed width and height.`)
    }
    if (classes.grow) markupError(`Section "${key}" cannot grow.`)
    if (classes.clipsContent !== undefined) {
      markupError(`Overflow classes are not supported on section "${key}".`)
    }
    if (classes.opacity !== undefined || classes.blendMode !== undefined) {
      markupError(`Opacity and blend modes are not supported on section "${key}".`)
    }
    if (classes.rotation !== undefined) {
      markupError(`Rotation classes are not supported on section "${key}".`)
    }
    if (binding?.figma?.mask !== undefined) {
      markupError(`Masks are not supported on section "${key}".`)
    }
    if (nativeStroke?.cap !== undefined || nativeStroke?.miterLimit !== undefined) {
      markupError(`Stroke caps and miter limits are not supported on section "${key}".`)
    }
  }
  if (binding?.figma?.text && type !== 'TEXT') {
    markupError(`Figma text properties on "${key}" require a span.`)
  }
  const propertyReferences = binding?.figma?.componentPropertyReferences
  if (propertyReferences?.characters !== undefined && type !== 'TEXT') {
    markupError(`A characters property reference on "${key}" requires a span.`)
  }
  if (propertyReferences?.mainComponent !== undefined && type !== 'INSTANCE') {
    markupError(`A mainComponent property reference on "${key}" requires an instance.`)
  }
  if (
    propertyReferences?.characters &&
    (binding?.variables?.characters || binding?.figma?.text?.ranges)
  ) {
    markupError(
      `A characters property reference on "${key}" cannot be combined with a characters variable or rich-text ranges.`
    )
  }
  if (propertyReferences?.visible && binding?.variables?.visible) {
    markupError(
      `A visible property reference on "${key}" cannot be combined with a visibility variable.`
    )
  }
  if (classes.textCase && binding?.figma?.text?.case) {
    markupError(`Text case on "${key}" cannot use both a class and a Figma property.`)
  }

  const parentMode = parent?.layout?.mode ?? 'NONE'
  const horizontalMode = classes.grow && parentMode === 'HORIZONTAL' ? 'FILL' : classes.width.mode
  const verticalMode = classes.grow && parentMode === 'VERTICAL' ? 'FILL' : classes.height.mode

  if (isFrameContainerType(type)) {
    if (classes.flex && classes.grid) {
      markupError(`Container "${key}" cannot combine flex and grid layout.`)
    }
    if (!classes.flex && classes.direction !== undefined) {
      markupError(`Flex direction on "${key}" requires flex.`)
    }
    if (!classes.flex && !classes.grid && classes.layoutClass) {
      markupError(`Layout class "${classes.layoutClass}" requires flex or grid on "${key}".`)
    }
    if (classes.grid) {
      if (!classes.gridColumns) {
        markupError(`Grid container "${key}" requires grid-cols-*.`)
      }
      if (
        classes.primaryAlign ||
        classes.counterAlign ||
        classes.counterAlignContent ||
        classes.wrap
      ) {
        markupError(`Flex alignment and wrapping classes are not supported on grid "${key}".`)
      }
      if (
        classes.width.mode === 'HUG' &&
        classes.gridColumns.some((track) => track.type === 'FLEX')
      ) {
        markupError(`Hug-width grid "${key}" cannot contain flexible column tracks.`)
      }
      if (
        classes.height.mode === 'HUG' &&
        (!classes.gridRows || classes.gridRows.some((track) => track.type === 'FLEX'))
      ) {
        markupError(`Hug-height grid "${key}" cannot contain flexible or automatic row tracks.`)
      }
    } else {
      if (classes.counterAlign === 'BASELINE' && classes.direction !== 'HORIZONTAL') {
        markupError(`items-baseline requires flex-row on "${key}".`)
      }
      if (classes.counterAlignContent === 'SPACE_BETWEEN' && classes.wrap !== 'WRAP') {
        markupError(`content-between requires flex-wrap on "${key}".`)
      }
      const counterGap = classes.direction === 'HORIZONTAL' ? classes.rowGap : classes.columnGap
      if (counterGap !== undefined && classes.wrap !== 'WRAP') {
        markupError(`Cross-axis gap on "${key}" requires flex-wrap.`)
      }
    }
    if ((horizontalMode === 'HUG' || verticalMode === 'HUG') && !classes.flex && !classes.grid) {
      markupError(`Hug-sized frame "${key}" must use auto layout.`)
    }
  }

  if (type === 'LINE') {
    if (classes.width.mode === 'FIXED' && classes.width.value! < 0.01) {
      markupError(`Line "${key}" requires width of at least 0.01px.`)
    }
  } else {
    for (const [axis, size] of [
      ['width', classes.width],
      ['height', classes.height]
    ] as const) {
      if (size.mode === 'FIXED' && size.value! < 0.01) {
        markupError(`${axis} on "${key}" must be at least 0.01px.`)
      }
    }
  }

  if (type === 'TEXT' && classes.width.mode === 'HUG' && classes.height.mode !== 'HUG') {
    markupError(`Text "${key}" may use w-fit only together with h-fit.`)
  }

  const relativeTransform = binding?.figma?.relativeTransform
  if (type === 'LINE' && classes.grow && parentMode === 'VERTICAL') {
    markupError(`Line "${key}" cannot grow on a vertical axis; its height is always zero.`)
  }
  if (classes.gridChildClass && (parentMode !== 'GRID' || classes.absolute)) {
    markupError(`Grid child class "${classes.gridChildClass}" requires an in-flow grid child.`)
  }
  if (!parent) {
    const validCreateRoot =
      type === 'SECTION' ||
      isIntrinsicContainer(type) ||
      (isFrameContainerType(type) && type !== 'SLOT')
    if (state.mode === 'create' && !validCreateRoot) {
      markupError(
        'Create mode requires a frame, section, group, boolean-operation, component, or component-set canvas root.'
      )
    }
    if (
      !isIntrinsicContainer(type) &&
      (classes.width.mode !== 'FIXED' || classes.height.mode !== 'FIXED')
    ) {
      markupError('Canvas markup root requires fixed w-[Npx] and h-[Npx] classes.')
    }
    if (classes.grow) markupError('Canvas markup root cannot grow.')
    if (classes.absolute) markupError('Canvas markup root cannot use absolute positioning.')
  } else if (!classes.absolute) {
    if (classes.width.mode === 'FILL' && parentMode !== 'VERTICAL' && parentMode !== 'GRID') {
      markupError(
        parentMode === 'NONE'
          ? `w-full on "${key}" cannot resolve in a freeform parent; add flex-col or grid to the parent, or use a fixed width with absolute offsets or a relative transform.`
          : `w-full on "${key}" requires a flex-col parent; use grow on a row main axis.`
      )
    }
    if (classes.height.mode === 'FILL' && parentMode !== 'HORIZONTAL' && parentMode !== 'GRID') {
      markupError(
        parentMode === 'NONE'
          ? `h-full on "${key}" cannot resolve in a freeform parent; add flex-row or grid to the parent, or use a fixed height with absolute offsets or a relative transform.`
          : `h-full on "${key}" requires a flex-row parent; use grow on a column main axis.`
      )
    }
    if (classes.grow && parentMode === 'GRID') {
      markupError(`grow on "${key}" is not supported in grid; use w-full or h-full.`)
    }
    if (classes.grow && parentMode === 'NONE') {
      markupError(`grow on "${key}" requires a flex parent.`)
    }
  }
  if (relativeTransform && classes.rotation !== undefined) {
    markupError(`Relative transform on "${key}" cannot be combined with a rotation class.`)
  }
  if (
    relativeTransform &&
    parentMode === 'NONE' &&
    (classes.absolute || classes.left !== undefined || classes.top !== undefined)
  ) {
    markupError(`Relative transform on "${key}" cannot be combined with position classes.`)
  }
  if (
    parent &&
    relativeTransform &&
    parentMode !== 'NONE' &&
    (relativeTransform[0][2] !== 0 || relativeTransform[1][2] !== 0)
  ) {
    markupError(
      `Relative transform on "${key}" must use zero translation in Auto Layout because Figma computes its position.`
    )
  }
  if (parent && parentMode === 'NONE' && !classes.absolute && !relativeTransform) {
    markupError(
      `Child "${key}" in a freeform container requires absolute offsets or a relative transform.`
    )
  }
  if (classes.absolute) {
    if (classes.left === undefined || classes.top === undefined) {
      markupError(`Absolute node "${key}" requires left-* and top-* supported classes.`)
    }
    if (classes.grow || classes.width.mode === 'FILL' || classes.height.mode === 'FILL') {
      markupError(`Absolute node "${key}" cannot use grow, w-full, or h-full.`)
    }
  } else if (classes.left !== undefined || classes.top !== undefined) {
    markupError(`Position classes on "${key}" require absolute.`)
  }

  const hasBounds = SIZE_BOUND_FIELDS.some(
    (field) => classes[field] !== undefined || binding?.variables?.[field] != null
  )
  if (hasBounds && type !== 'TEXT' && !classes.flex && !classes.grid && parentMode === 'NONE') {
    markupError(`Min/max sizing on "${key}" requires text or auto layout.`)
  }
  validateSizeBounds(key, 'width', classes.width, classes.minWidth, classes.maxWidth)
  validateSizeBounds(key, 'height', classes.height, classes.minHeight, classes.maxHeight)
  if (state.mode === 'create' && isFrameContainerType(type) && (classes.flex || classes.grid)) {
    validateNewAutoLayoutMinimum(key, binding, classes)
  }

  validatePaints(key, type, binding, classes)
  validateVariables(key, type, binding, classes)
  validateStyles(key, type, binding, classes)
  validateEffects(key, type, binding)
  validateFigmaLayout(key, type, binding, classes)

  const autoResize = textAutoResize(horizontalMode, verticalMode)
  if (binding?.figma?.aspectRatioLocked === true && type === 'TEXT' && autoResize !== 'NONE') {
    markupError(`Aspect-ratio lock on auto-resizing text "${key}" is not supported by Figma.`)
  }
  const gridChild =
    parentMode === 'GRID' && !classes.absolute
      ? placeGridChild(key, classes, gridPlacement!)
      : undefined
  const includeDefaults = state.mode === 'create'
  const size = {
    ...(classes.width.value === undefined ? {} : { width: classes.width.value }),
    ...(classes.height.value === undefined ? {} : { height: classes.height.value }),
    ...(classes.minWidth !== undefined
      ? { minWidth: classes.minWidth }
      : includeDefaults
        ? { minWidth: null }
        : {}),
    ...(classes.maxWidth !== undefined
      ? { maxWidth: classes.maxWidth }
      : includeDefaults
        ? { maxWidth: null }
        : {}),
    ...(classes.minHeight !== undefined
      ? { minHeight: classes.minHeight }
      : includeDefaults
        ? { minHeight: null }
        : {}),
    ...(classes.maxHeight !== undefined
      ? { maxHeight: classes.maxHeight }
      : includeDefaults
        ? { maxHeight: null }
        : {}),
    horizontal: horizontalMode,
    vertical: verticalMode
  }
  const common = {
    key,
    ...(nodeId === undefined ? {} : { nodeId }),
    type,
    ...(binding?.figma?.name !== undefined || includeDefaults
      ? { displayName: binding?.figma?.name ?? key }
      : {}),
    size,
    ...(classes.grow !== undefined || includeDefaults ? { grow: classes.grow ?? false } : {}),
    ...(classes.visible === undefined ? {} : { visible: classes.visible }),
    ...(classes.blendMode === undefined ? {} : { blendMode: classes.blendMode }),
    ...(classes.rotation === undefined ? {} : { rotation: classes.rotation }),
    ...(gridChild ? { gridChild } : {}),
    ...(parent && (classes.absolute !== undefined || includeDefaults)
      ? { positioning: classes.absolute ? ('ABSOLUTE' as const) : ('AUTO' as const) }
      : {}),
    ...(classes.absolute ? { position: { x: classes.left!, y: classes.top! } } : {}),
    ...(binding?.variables ? { variables: binding.variables } : {}),
    ...(binding?.variableModes ? { variableModes: binding.variableModes } : {}),
    ...(binding?.styles ? { styles: binding.styles } : {}),
    ...(binding?.figma ? { figma: binding.figma } : {})
  }

  let node: CanvasNodeSpec
  if (type === 'TEXT') {
    const fontName = binding?.figma?.text?.fontName
    const fontFamily = fontName?.family ?? classes.fontFamily
    const fontStyle = fontName?.style ?? classes.fontStyle
    node = {
      ...common,
      type,
      appearance: {
        ...(binding?.figma?.fills === undefined && (classes.fill !== undefined || includeDefaults)
          ? { fill: classes.fill ?? '#000000' }
          : {}),
        ...(binding?.figma?.strokes === undefined && includeDefaults ? { stroke: null } : {}),
        ...strokeAppearance(binding, classes, false),
        ...(classes.opacity !== undefined || includeDefaults
          ? { opacity: classes.opacity ?? 1 }
          : {})
      },
      text: {
        characters,
        ...(fontFamily !== undefined || includeDefaults
          ? { fontFamily: fontFamily ?? 'Inter' }
          : {}),
        ...(fontStyle !== undefined || includeDefaults
          ? { fontStyle: fontStyle ?? 'Regular' }
          : {}),
        ...(classes.fontSize !== undefined || includeDefaults
          ? { fontSize: classes.fontSize ?? 16 }
          : {}),
        ...(classes.lineHeight !== undefined || includeDefaults
          ? { lineHeight: classes.lineHeight ?? { unit: 'PIXELS' as const, value: 24 } }
          : {}),
        ...(classes.letterSpacing !== undefined || includeDefaults
          ? { letterSpacing: classes.letterSpacing ?? { unit: 'PIXELS' as const, value: 0 } }
          : {}),
        ...(classes.textAlign !== undefined || includeDefaults
          ? { alignHorizontal: classes.textAlign ?? ('LEFT' as const) }
          : {}),
        ...(binding?.figma?.text?.verticalAlign !== undefined || includeDefaults
          ? { alignVertical: binding?.figma?.text?.verticalAlign ?? ('TOP' as const) }
          : {}),
        autoResize,
        ...(classes.textCase ? { textCase: classes.textCase } : {}),
        ...(classes.textDecoration ? { textDecoration: classes.textDecoration } : {}),
        ...(classes.textTruncation ? { textTruncation: classes.textTruncation } : {}),
        ...(classes.maxLines === undefined ? {} : { maxLines: classes.maxLines })
      }
    }
  } else if (type === 'INSTANCE') {
    node = {
      ...common,
      type,
      appearance: {
        ...strokeAppearance(binding, classes, false),
        ...cornerAppearance(binding, classes, false),
        ...(classes.opacity !== undefined || includeDefaults
          ? { opacity: classes.opacity ?? 1 }
          : {})
      },
      ...(binding?.component ? { component: binding.component } : {}),
      ...(binding?.componentProperties ? { componentProperties: binding.componentProperties } : {})
    }
  } else if (type === 'GROUP') {
    node = {
      ...common,
      type,
      layout: { mode: 'NONE' },
      appearance: {
        ...(classes.opacity !== undefined || includeDefaults
          ? { opacity: classes.opacity ?? 1 }
          : {})
      }
    }
  } else if (type === 'SECTION') {
    node = {
      ...common,
      type,
      appearance: fillStrokeAppearance(binding, classes)
    }
  } else if (hasShapeAppearance(type)) {
    node = {
      ...common,
      type,
      ...(type === 'BOOLEAN_OPERATION' ? { layout: { mode: 'NONE' as const } } : {}),
      appearance: {
        ...fillStrokeAppearance(binding, classes),
        ...(classes.opacity !== undefined || includeDefaults
          ? { opacity: classes.opacity ?? 1 }
          : {})
      }
    }
  } else {
    const rowGap = classes.rowGap ?? classes.gap
    const columnGap = classes.columnGap ?? classes.gap
    const padding = includeDefaults
      ? {
          top: classes.padding.top ?? 0,
          right: classes.padding.right ?? 0,
          bottom: classes.padding.bottom ?? 0,
          left: classes.padding.left ?? 0
        }
      : classes.padding
    const hasPadding = includeDefaults || Object.keys(padding).length > 0
    const layout = classes.grid
      ? {
          mode: 'GRID' as const,
          columns: classes.gridColumns!,
          ...(classes.gridRows ? { rows: classes.gridRows } : {}),
          ...(classes.gridRows !== undefined ||
          classes.gridFlow === 'ROW_AUTO_FLOW' ||
          includeDefaults
            ? { autoRows: classes.gridRows === undefined }
            : {}),
          ...(rowGap !== undefined || includeDefaults ? { rowGap: rowGap ?? 0 } : {}),
          ...(columnGap !== undefined || includeDefaults ? { columnGap: columnGap ?? 0 } : {}),
          ...(hasPadding ? { padding } : {}),
          ...(classes.gridFlow !== undefined || includeDefaults
            ? { itemsPositioning: classes.gridFlow ?? ('MANUAL' as const) }
            : {}),
          ...(classes.strokesIncluded !== undefined || includeDefaults
            ? { strokesIncluded: classes.strokesIncluded ?? true }
            : {})
        }
      : classes.flex
        ? {
            mode: classes.direction!,
            ...((classes.direction === 'HORIZONTAL' ? columnGap : rowGap) !== undefined ||
            includeDefaults
              ? { gap: (classes.direction === 'HORIZONTAL' ? columnGap : rowGap) ?? 0 }
              : {}),
            ...(classes.wrap === 'WRAP' &&
            ((classes.direction === 'HORIZONTAL' ? rowGap : columnGap) !== undefined ||
              includeDefaults)
              ? { counterGap: (classes.direction === 'HORIZONTAL' ? rowGap : columnGap) ?? 0 }
              : {}),
            ...(hasPadding ? { padding } : {}),
            ...(classes.primaryAlign !== undefined || includeDefaults
              ? { primaryAlign: classes.primaryAlign ?? ('MIN' as const) }
              : {}),
            ...(classes.counterAlign !== undefined || includeDefaults
              ? { counterAlign: classes.counterAlign ?? ('MIN' as const) }
              : {}),
            ...(classes.counterAlignContent !== undefined || includeDefaults
              ? { counterAlignContent: classes.counterAlignContent ?? ('AUTO' as const) }
              : {}),
            ...(classes.wrap !== undefined || includeDefaults
              ? { wrap: classes.wrap ?? ('NO_WRAP' as const) }
              : {}),
            ...(classes.strokesIncluded !== undefined || includeDefaults
              ? { strokesIncluded: classes.strokesIncluded ?? true }
              : {})
          }
        : ({ mode: 'NONE' } as const)
    node = {
      ...common,
      type,
      ...(includeDefaults || classes.grid || classes.flex ? { layout } : {}),
      appearance: {
        ...(binding?.figma?.fills === undefined && (classes.fill !== undefined || includeDefaults)
          ? { fill: classes.fill ?? null }
          : {}),
        ...(binding?.figma?.strokes === undefined &&
        (classes.stroke !== undefined || includeDefaults)
          ? { stroke: classes.stroke ?? null }
          : {}),
        ...strokeAppearance(binding, classes, includeDefaults),
        ...cornerAppearance(binding, classes, includeDefaults),
        ...(classes.clipsContent !== undefined || includeDefaults
          ? { clipsContent: classes.clipsContent ?? false }
          : {}),
        ...(classes.opacity !== undefined || includeDefaults
          ? { opacity: classes.opacity ?? 1 }
          : {})
      }
    }
  }

  if (element.children.length) {
    const placement =
      node.layout?.mode === 'GRID'
        ? {
            columns: node.layout.columns.length,
            rows: node.layout.rows?.length ?? MAX_GRID_TRACKS,
            manual: node.layout.itemsPositioning !== 'ROW_AUTO_FLOW',
            occupied: new Set<string>()
          }
        : undefined
    const childInsideComponent =
      insideComponent || type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'SLOT'
    node.children = element.children.map((child) =>
      compileElement(child, state, depth + 1, node, placement, childInsideComponent)
    )
  }
  if (state.mode === 'create' && type === 'GROUP' && !node.children?.length) {
    markupError(`New group "${key}" requires at least one child.`)
  }
  if (state.mode === 'create' && type === 'BOOLEAN_OPERATION' && (node.children?.length ?? 0) < 2) {
    markupError(`New boolean operation "${key}" requires at least two children.`)
  }
  if (state.mode === 'create' && type === 'COMPONENT_SET' && !node.children?.length) {
    markupError(`New component set "${key}" requires at least one component child.`)
  }
  return node
}

export function parseCanvasMarkup(
  input: CanvasResolvedApplyParameters,
  catalog?: DesignSystemCatalog,
  existingNodeTypes?: CanvasNodeTypeHints
): ParsedCanvasInput {
  if (input.markup === null) {
    return {
      mode: 'update',
      targetNodeId: input.targetNodeId!,
      root: null
    }
  }
  const state: CompileState = {
    bindings: Object.assign(Object.create(null) as Record<string, CanvasBinding>, input.bindings),
    ...(catalog ? { catalog } : {}),
    count: 0,
    ...(existingNodeTypes ? { existingNodeTypes } : {}),
    keys: new Set(),
    mode: input.mode,
    nodeIds: new Set()
  }
  const rootElement = normalizeCatalogElement(
    parseCanvasHtml(input.markup),
    state.bindings,
    catalog
  )
  const root = compileElement(rootElement, state, 1)
  validateAssetReferences(root, input.assets)
  for (const key of Object.keys(state.bindings)) {
    if (!state.keys.has(key)) markupError(`Binding "${key}" has no matching data-key.`)
  }
  for (const key of input.removeKeys ?? []) {
    if (state.keys.has(key)) {
      markupError(`Canvas key "${key}" cannot be both present and removed.`)
    }
  }
  if (input.mode === 'update' && root.nodeId !== undefined && root.nodeId !== input.targetNodeId) {
    markupError('The root data-node-id must match targetNodeId in update mode.')
  }
  return {
    mode: input.mode,
    ...(input.targetNodeId === undefined ? {} : { targetNodeId: input.targetNodeId }),
    removeKeys: input.removeKeys ?? [],
    ...(input.page === undefined ? {} : { page: input.page }),
    ...(input.variableCollections === undefined
      ? {}
      : { variableCollections: input.variableCollections }),
    ...(input.styles === undefined ? {} : { styles: input.styles }),
    ...(input.assets === undefined ? {} : { assets: input.assets }),
    root
  }
}

function validateAssetReferences(root: CanvasNodeSpec, assets: CanvasAssets | undefined): void {
  const referenced = new Set<string>()
  const requireAsset = (key: string, type: 'IMAGE' | 'SVG', owner: string): void => {
    const asset = assets?.[key]
    if (!asset) markupError(`${type} asset "${key}" referenced by "${owner}" is not declared.`)
    if (asset.type !== type) {
      markupError(`Asset "${key}" referenced by "${owner}" is ${asset.type}, expected ${type}.`)
    }
    referenced.add(key)
  }
  const visitPaints = (paints: CanvasFigmaPaint[] | undefined, owner: string): void => {
    for (const paint of paints ?? []) {
      if (paint.type === 'IMAGE' && paint.assetKey) {
        requireAsset(paint.assetKey, 'IMAGE', owner)
      }
    }
  }
  const visit = (spec: CanvasNodeSpec): void => {
    if (spec.figma?.svg) requireAsset(spec.figma.svg.assetKey, 'SVG', spec.key)
    visitPaints(spec.figma?.fills, spec.key)
    visitPaints(spec.figma?.strokes, spec.key)
    for (const range of spec.figma?.text?.ranges ?? []) {
      visitPaints(range.fills, `${spec.key} text range`)
    }
    if (spec.figma?.shape?.type === 'VECTOR') {
      for (const region of spec.figma.shape.network?.regions ?? []) {
        visitPaints(region.fills, `${spec.key} vector region`)
      }
    }
    for (const child of spec.children ?? []) visit(child)
  }
  visit(root)
  for (const key of Object.keys(assets ?? {})) {
    if (!referenced.has(key)) markupError(`Declared asset "${key}" is not referenced.`)
  }
}
