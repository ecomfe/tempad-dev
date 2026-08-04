import type { RefinementCtx, ZodType } from 'zod'

import { z } from 'zod'

import { MCP_HASH_PATTERN } from './constants'

export const AssetDescriptorSchema = z.object({
  hash: z.string().regex(MCP_HASH_PATTERN),
  url: z.string().url(),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  themeable: z.boolean().optional(),
  figmaImageHash: z.string().min(1).optional(),
  figmaImageHashes: z.array(z.string().min(1)).min(1).optional(),
  figmaVideoHashes: z.array(z.string().min(1)).min(1).optional()
})

// get_code
export const GetCodeParametersSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'Optional target node id; omit to use the current single selection when pulling the baseline snapshot.'
    )
    .optional(),
  preferredLang: z
    .enum(['jsx', 'vue'])
    .describe(
      'Preferred output language to bias the snapshot; otherwise uses the design’s hint/detected language, then falls back to JSX.'
    )
    .optional(),
  resolveTokens: z
    .boolean()
    .describe(
      'Inline token values instead of references for quick renders; default false returns token metadata so you can map into your theming system. When true, values are resolved per-node (mode-aware).'
    )
    .optional(),
  vectorMode: z
    .enum(['smart', 'snapshot'])
    .describe(
      'Vector output mode. `smart` (default) emits `<svg data-src="...">` placeholders in code and preserves themeable instance color on the emitted SVG root markup for downstream adaptation; if asset upload fails after export, the tool may inline the SVG as a fallback to preserve source of truth. `snapshot` preserves vector assets for fidelity. Final vector delivery may still be adapted to the Host app’s SVG policy.'
    )
    .optional()
})

export type GetCodeParametersInput = z.input<typeof GetCodeParametersSchema>
export type GetCodeWarning = {
  type: 'auto-layout' | 'shell' | 'depth-cap'
  message: string
}
export type GetCodeResult = {
  code: string
  lang: 'vue' | 'jsx'
  assets?: AssetDescriptor[]
  tokens?: GetTokenDefsResult
  codegen: {
    plugin: string
    config: {
      cssUnit: 'px' | 'rem'
      rootFontSize: number
      scale: number
    }
  }
  warnings?: GetCodeWarning[]
}

// get_token_defs
export const GetTokenDefsParametersSchema = z.object({
  names: z
    .array(z.string().regex(/^--[a-zA-Z0-9-_]+$/))
    .min(1)
    .describe(
      'Canonical token names (CSS variable form) from Object.keys(get_code.tokens) or your own list to resolve, e.g., --color-primary.'
    ),
  includeAllModes: z
    .boolean()
    .describe(
      'Include all token modes (light/dark/etc.) instead of just the active one to mirror responsive tokens; default false.'
    )
    .optional()
})

export type GetTokenDefsParametersInput = z.input<typeof GetTokenDefsParametersSchema>
export type TokenEntry = {
  kind: 'color' | 'number' | 'string' | 'boolean'
  value: string | Record<string, string> // single mode -> string; multi-mode -> map (mode name -> literal or alias)
}

export type GetTokenDefsResult = {
  [canonicalName: string]: TokenEntry
}

// get_screenshot
export const GetScreenshotParametersSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'Optional exact node id to render; defaults to the current single selection. Use only when pixels affect the next decision.'
    )
    .optional()
})

export type GetScreenshotParametersInput = z.input<typeof GetScreenshotParametersSchema>
export type GetScreenshotResult = {
  format: 'png'
  width: number
  height: number
  scale: number
  bytes: number
  asset: AssetDescriptor
}

// get_structure
export const GetStructureParametersSchema = z.object({
  nodeId: z
    .string()
    .describe(
      'Optional node id to outline; defaults to the current single selection. Useful for explicit hierarchy/geometry and for recovering stable authoring keys on TemPad-managed nodes.'
    )
    .optional(),
  options: z
    .object({
      depth: z
        .number()
        .int()
        .positive()
        .describe('Limit traversal depth; defaults to full tree (subject to safety caps).')
        .optional()
    })
    .optional()
})

export type GetStructureParametersInput = z.input<typeof GetStructureParametersSchema>
export type OutlineNode = {
  id: string
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  authoringKey?: string
  children?: OutlineNode[]
}
export type GetStructureResult = {
  roots: OutlineNode[]
}

// get_design_system
export const GetDesignSystemParametersSchema = z
  .object({
    catalogId: z
      .string()
      .min(1)
      .describe('Catalog returned by an earlier discovery call.')
      .optional(),
    cursor: z
      .number()
      .int()
      .nonnegative()
      .describe('Continuation cursor returned by the same catalog.')
      .optional(),
    ref: z.string().min(1).describe('Exact resource ref from the same catalog.').optional()
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (message: string, path: 'catalogId' | 'cursor' | 'ref'): void =>
      context.addIssue({ code: 'custom', message, path: [path] })
    if (!value.catalogId) {
      if (value.cursor !== undefined) issue('cursor requires catalogId.', 'cursor')
      if (value.ref !== undefined) issue('ref requires catalogId.', 'ref')
      return
    }
    if ((value.cursor === undefined) === (value.ref === undefined)) {
      issue('Catalog reuse requires exactly one of cursor or ref.', 'catalogId')
    }
  })

export type GetDesignSystemParametersInput = z.input<typeof GetDesignSystemParametersSchema>

export type DesignSystemCatalogProperty = {
  type: 'boolean' | 'instance' | 'text' | 'variant'
  label?: string
  default?: string | boolean
  options?: string[]
  omittedOptions?: number
}

export type DesignSystemCatalogComponent = {
  ref: string
  tag: string
  name: string
  summary?: string
  page?: string
  variantCount?: number
  nativeSize?: {
    width: number
    height: number
  }
  props: Record<string, DesignSystemCatalogProperty>
  omittedProps?: number
}

export type DesignSystemCatalogVariable = {
  ref: string
  name: string
  collection: string
  type: 'boolean' | 'color' | 'number' | 'string'
  scopes?: string[]
  defaultValue?: string | number | boolean
}

export type DesignSystemCatalogCollection = {
  ref: string
  name: string
  modes: Array<{
    ref: string
    name: string
  }>
  defaultModeRef: string
}

export type DesignSystemCatalogStyle = {
  ref: string
  name: string
  type: 'effect' | 'grid' | 'paint' | 'text'
  signature: string
  summary?: string
}

export type DesignSystemCatalogShader = {
  ref: string
  name: string
  type: 'effect' | 'fill'
  summary?: string
}

const DesignSystemCatalogPropertySchema = z
  .object({
    type: z.enum(['boolean', 'instance', 'text', 'variant']),
    label: z.string().optional(),
    default: z.union([z.string(), z.boolean()]).optional(),
    options: z.array(z.string()).optional(),
    omittedOptions: z.number().int().nonnegative().optional()
  })
  .strict()

const DesignSystemCatalogComponentSchema = z
  .object({
    ref: z.string().min(1),
    tag: z.string().min(1),
    name: z.string(),
    summary: z.string().optional(),
    page: z.string().optional(),
    variantCount: z.number().int().nonnegative().optional(),
    nativeSize: z
      .object({
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative()
      })
      .strict()
      .optional(),
    props: z.record(z.string(), DesignSystemCatalogPropertySchema),
    omittedProps: z.number().int().nonnegative().optional()
  })
  .strict()

const DesignSystemCatalogVariableSchema = z
  .object({
    ref: z.string().min(1),
    name: z.string(),
    collection: z.string(),
    type: z.enum(['boolean', 'color', 'number', 'string']),
    scopes: z.array(z.string()).optional(),
    defaultValue: z.union([z.string(), z.number().finite(), z.boolean()]).optional()
  })
  .strict()

const DesignSystemCatalogCollectionSchema = z
  .object({
    ref: z.string().min(1),
    name: z.string(),
    modes: z.array(
      z
        .object({
          ref: z.string().min(1),
          name: z.string()
        })
        .strict()
    ),
    defaultModeRef: z.string().min(1)
  })
  .strict()

const DesignSystemCatalogStyleSchema = z
  .object({
    ref: z.string().min(1),
    name: z.string(),
    type: z.enum(['effect', 'grid', 'paint', 'text']),
    signature: z.string(),
    summary: z.string().optional()
  })
  .strict()

const DesignSystemCatalogShaderSchema = z
  .object({
    ref: z.string().min(1),
    name: z.string(),
    type: z.enum(['effect', 'fill']),
    summary: z.string().optional()
  })
  .strict()

export const GetDesignSystemResultSchema = z
  .object({
    catalogId: z.string().min(1),
    components: z.array(DesignSystemCatalogComponentSchema),
    variables: z.array(DesignSystemCatalogVariableSchema),
    collections: z.array(DesignSystemCatalogCollectionSchema),
    styles: z.array(DesignSystemCatalogStyleSchema),
    shaders: z.array(DesignSystemCatalogShaderSchema).optional(),
    details: z
      .object({
        ref: z.string().min(1),
        kind: z.enum(['collection', 'component', 'mode', 'shader', 'style', 'variable']),
        definition: z.unknown()
      })
      .strict()
      .optional(),
    nextCursor: z.number().int().nonnegative().optional(),
    omitted: z.record(z.string(), z.number().int().nonnegative()).optional(),
    warnings: z.array(z.string()).optional()
  })
  .strict()

export type GetDesignSystemResult = z.output<typeof GetDesignSystemResultSchema>

// apply_canvas
export type CanvasDesignReference = { id: string; key?: string } | { id?: never; key: string }

export const CanvasDesignReferenceSchema = z
  .object({
    id: z.string().min(1).describe('Live Figma node, variable, or style id.').optional(),
    key: z.string().min(1).describe('Importable Figma library key.').optional()
  })
  .strict()
  .refine(
    (reference): reference is CanvasDesignReference =>
      reference.id !== undefined || reference.key !== undefined,
    {
      message: 'A design-system reference requires id or key.'
    }
  )

export const CanvasStableKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w./:-]+$/, 'Use a stable key containing letters, numbers, ., /, :, _, or -.')

export type CanvasVariableReference = CanvasDesignReference | { variableKey: string }

export const CanvasVariableReferenceSchema = z.union([
  CanvasDesignReferenceSchema,
  z
    .object({
      variableKey: CanvasStableKeySchema.describe(
        'Stable key of a local variable authored through apply_canvas.'
      )
    })
    .strict()
])

export type CanvasVariableCollectionReference = CanvasDesignReference | { collectionKey: string }

export const CanvasVariableCollectionReferenceSchema = z.union([
  CanvasDesignReferenceSchema,
  z
    .object({
      collectionKey: CanvasStableKeySchema.describe(
        'Stable key of a local variable collection authored through apply_canvas.'
      )
    })
    .strict()
])

export type CanvasStyleReference = CanvasDesignReference | { styleKey: string }

export const CanvasStyleReferenceSchema = z.union([
  CanvasDesignReferenceSchema,
  z
    .object({
      styleKey: CanvasStableKeySchema.describe(
        'Stable key of a local style authored through apply_canvas.'
      )
    })
    .strict()
])

function hasFields(value: object): boolean {
  return Object.keys(value).length > 0
}

const CanvasNonnegativeNumberSchema = z.number().finite().min(0)
const CanvasUnitNumberSchema = z.number().finite().min(0).max(1)
const CanvasFiniteNumberSchema = z.number().finite()
const CanvasRgbSchema = z
  .object({
    r: CanvasUnitNumberSchema,
    g: CanvasUnitNumberSchema,
    b: CanvasUnitNumberSchema
  })
  .strict()
const CanvasRgbaSchema = CanvasRgbSchema.extend({
  a: CanvasUnitNumberSchema
}).strict()
const CanvasVectorSchema = z
  .object({
    x: CanvasFiniteNumberSchema,
    y: CanvasFiniteNumberSchema
  })
  .strict()

const CanvasVariableAliasSchema = z
  .object({
    variable: CanvasVariableReferenceSchema
  })
  .strict()
const CanvasFigmaShaderColorSchema = z.union([
  CanvasRgbSchema,
  CanvasRgbaSchema,
  CanvasVariableAliasSchema
])
const CanvasFigmaShaderPropertyValueSchema = z.union([
  z.boolean(),
  z.string(),
  CanvasFiniteNumberSchema,
  CanvasRgbSchema,
  CanvasRgbaSchema,
  CanvasVectorSchema,
  CanvasVectorSchema.extend({
    x2: CanvasFiniteNumberSchema,
    y2: CanvasFiniteNumberSchema
  }).strict(),
  CanvasVectorSchema.extend({
    radius: CanvasFiniteNumberSchema
  }).strict(),
  CanvasVectorSchema.extend({
    radius: CanvasFiniteNumberSchema,
    angle: CanvasFiniteNumberSchema
  }).strict(),
  CanvasVectorSchema.extend({
    color: CanvasFigmaShaderColorSchema
  }).strict(),
  z
    .object({
      stops: z.array(
        z
          .object({
            position: CanvasFiniteNumberSchema,
            color: CanvasFigmaShaderColorSchema
          })
          .strict()
      )
    })
    .strict(),
  CanvasVariableAliasSchema
])

export type CanvasFigmaShaderPropertyValue = z.infer<typeof CanvasFigmaShaderPropertyValueSchema>

const CanvasBlendModeSchema = z.enum([
  'PASS_THROUGH',
  'NORMAL',
  'DARKEN',
  'MULTIPLY',
  'LINEAR_BURN',
  'COLOR_BURN',
  'LIGHTEN',
  'SCREEN',
  'LINEAR_DODGE',
  'COLOR_DODGE',
  'OVERLAY',
  'SOFT_LIGHT',
  'HARD_LIGHT',
  'DIFFERENCE',
  'EXCLUSION',
  'HUE',
  'SATURATION',
  'COLOR',
  'LUMINOSITY'
])

const CanvasTransformSchema = z.tuple([
  z.tuple([CanvasFiniteNumberSchema, CanvasFiniteNumberSchema, CanvasFiniteNumberSchema]),
  z.tuple([CanvasFiniteNumberSchema, CanvasFiniteNumberSchema, CanvasFiniteNumberSchema])
])
const CanvasRelativeTransformSchema = CanvasTransformSchema.refine(
  ([[m00, m01], [m10, m11]]) =>
    Math.abs(Math.hypot(m00, m10) - 1) <= 1e-6 && Math.abs(Math.hypot(m01, m11) - 1) <= 1e-6,
  {
    message: 'Relative transform axes must each have unit length.'
  }
)
const CanvasFigmaPaintVariablesSchema = z
  .object({
    color: CanvasVariableReferenceSchema
  })
  .strict()
const CanvasFigmaPaintFields = {
  visible: z.boolean().optional(),
  opacity: CanvasUnitNumberSchema.optional(),
  blendMode: CanvasBlendModeSchema.optional()
}
const CanvasFigmaImageFiltersSchema = z
  .object({
    exposure: CanvasFiniteNumberSchema.min(-1).max(1).optional(),
    contrast: CanvasFiniteNumberSchema.min(-1).max(1).optional(),
    saturation: CanvasFiniteNumberSchema.min(-1).max(1).optional(),
    temperature: CanvasFiniteNumberSchema.min(-1).max(1).optional(),
    tint: CanvasFiniteNumberSchema.min(-1).max(1).optional(),
    highlights: CanvasFiniteNumberSchema.min(-1).max(1).optional(),
    shadows: CanvasFiniteNumberSchema.min(-1).max(1).optional()
  })
  .strict()
  .refine(hasFields, 'Image filters cannot be empty.')
const CanvasFigmaMediaFields = {
  filters: CanvasFigmaImageFiltersSchema.optional(),
  rotation: CanvasFiniteNumberSchema.refine((rotation) => Number.isInteger(rotation / 90), {
    message: 'Media rotation must be a multiple of 90 degrees.'
  }).optional(),
  ...CanvasFigmaPaintFields
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const CanvasFigmaImageSourceFields = {
  imageHash: z.string().min(1).nullable().optional(),
  imageUrl: z
    .string()
    .refine(isHttpUrl, {
      message: 'Image URL must use HTTP or HTTPS.'
    })
    .optional(),
  assetKey: CanvasStableKeySchema.optional()
}

function hasOneImageSource(paint: {
  imageHash?: string | null
  imageUrl?: string
  assetKey?: string
}): boolean {
  return (
    [paint.imageHash, paint.imageUrl, paint.assetKey].filter((source) => source !== undefined)
      .length === 1
  )
}

const CanvasFigmaVideoSourceFields = {
  videoHash: z.string().min(1).nullable().optional(),
  videoUrl: z
    .string()
    .refine(isHttpUrl, {
      message: 'Video URL must use HTTP or HTTPS.'
    })
    .optional()
}

function hasOneVideoSource(paint: { videoHash?: string | null; videoUrl?: string }): boolean {
  return (paint.videoHash === undefined) !== (paint.videoUrl === undefined)
}

// Scale-mode-specific schemas reject paint fields that Figma ignores or disallows in that mode.
const CanvasFigmaImagePaintSchemas = [
  z
    .object({
      type: z.literal('IMAGE'),
      ...CanvasFigmaImageSourceFields,
      scaleMode: z.enum(['FILL', 'FIT']),
      ...CanvasFigmaMediaFields
    })
    .strict()
    .refine(hasOneImageSource, {
      message: 'Image paint requires exactly one of imageHash, imageUrl, or assetKey.'
    }),
  z
    .object({
      type: z.literal('IMAGE'),
      ...CanvasFigmaImageSourceFields,
      scaleMode: z.literal('CROP'),
      imageTransform: CanvasTransformSchema.optional(),
      filters: CanvasFigmaImageFiltersSchema.optional(),
      ...CanvasFigmaPaintFields
    })
    .strict()
    .refine(hasOneImageSource, {
      message: 'Image paint requires exactly one of imageHash, imageUrl, or assetKey.'
    }),
  z
    .object({
      type: z.literal('IMAGE'),
      ...CanvasFigmaImageSourceFields,
      scaleMode: z.literal('TILE'),
      scalingFactor: CanvasFiniteNumberSchema.optional(),
      ...CanvasFigmaMediaFields
    })
    .strict()
    .refine(hasOneImageSource, {
      message: 'Image paint requires exactly one of imageHash, imageUrl, or assetKey.'
    })
] as const
const CanvasFigmaVideoPaintSchemas = [
  z
    .object({
      type: z.literal('VIDEO'),
      ...CanvasFigmaVideoSourceFields,
      scaleMode: z.enum(['FILL', 'FIT']),
      ...CanvasFigmaMediaFields
    })
    .strict()
    .refine(hasOneVideoSource, {
      message: 'Video paint requires exactly one of videoHash or videoUrl.'
    }),
  z
    .object({
      type: z.literal('VIDEO'),
      ...CanvasFigmaVideoSourceFields,
      scaleMode: z.literal('CROP'),
      videoTransform: CanvasTransformSchema.optional(),
      filters: CanvasFigmaImageFiltersSchema.optional(),
      ...CanvasFigmaPaintFields
    })
    .strict()
    .refine(hasOneVideoSource, {
      message: 'Video paint requires exactly one of videoHash or videoUrl.'
    }),
  z
    .object({
      type: z.literal('VIDEO'),
      ...CanvasFigmaVideoSourceFields,
      scaleMode: z.literal('TILE'),
      scalingFactor: CanvasFiniteNumberSchema.optional(),
      ...CanvasFigmaMediaFields
    })
    .strict()
    .refine(hasOneVideoSource, {
      message: 'Video paint requires exactly one of videoHash or videoUrl.'
    })
] as const

const CanvasFigmaGradientStopSchema = z
  .object({
    position: CanvasUnitNumberSchema,
    color: CanvasRgbaSchema,
    variables: CanvasFigmaPaintVariablesSchema.optional()
  })
  .strict()

const CanvasFigmaSolidPaintSchema = z
  .object({
    type: z.literal('SOLID'),
    color: CanvasRgbSchema,
    variables: CanvasFigmaPaintVariablesSchema.optional(),
    ...CanvasFigmaPaintFields
  })
  .strict()

export const CanvasFigmaPaintSchema = z.union([
  CanvasFigmaSolidPaintSchema,
  z
    .object({
      type: z.enum(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']),
      gradientTransform: CanvasTransformSchema,
      gradientStops: z.array(CanvasFigmaGradientStopSchema),
      ...CanvasFigmaPaintFields
    })
    .strict(),
  ...CanvasFigmaImagePaintSchemas,
  ...CanvasFigmaVideoPaintSchemas,
  z
    .object({
      type: z.literal('PATTERN'),
      sourceNodeId: z.string().min(1).optional(),
      sourceCanvasKey: CanvasStableKeySchema.optional(),
      tileType: z.enum(['RECTANGULAR', 'HORIZONTAL_HEXAGONAL', 'VERTICAL_HEXAGONAL']),
      scalingFactor: CanvasFiniteNumberSchema,
      spacing: CanvasVectorSchema,
      horizontalAlignment: z.enum(['START', 'CENTER', 'END']),
      ...CanvasFigmaPaintFields
    })
    .strict()
    .refine(
      (paint) => (paint.sourceNodeId === undefined) !== (paint.sourceCanvasKey === undefined),
      {
        message: 'Pattern paint requires exactly one of sourceNodeId or sourceCanvasKey.'
      }
    ),
  z
    .object({
      type: z.literal('SHADER'),
      id: z.string().min(1),
      properties: z.record(z.string().min(1), CanvasFigmaShaderPropertyValueSchema).optional(),
      ...CanvasFigmaPaintFields
    })
    .strict()
])

export type CanvasFigmaPaint = z.infer<typeof CanvasFigmaPaintSchema>

const CanvasFigmaShadowVariablesSchema = z
  .object({
    color: CanvasVariableReferenceSchema.optional(),
    radius: CanvasVariableReferenceSchema.optional(),
    spread: CanvasVariableReferenceSchema.optional(),
    offsetX: CanvasVariableReferenceSchema.optional(),
    offsetY: CanvasVariableReferenceSchema.optional()
  })
  .strict()
  .refine(hasFields, 'Shadow variable bindings cannot be empty.')
const CanvasFigmaBlurVariablesSchema = z
  .object({
    radius: CanvasVariableReferenceSchema
  })
  .strict()

const CanvasFigmaShadowFields = {
  color: CanvasRgbaSchema,
  offset: CanvasVectorSchema,
  radius: CanvasNonnegativeNumberSchema,
  spread: CanvasFiniteNumberSchema.optional(),
  visible: z.boolean().optional(),
  blendMode: CanvasBlendModeSchema.optional(),
  variables: CanvasFigmaShadowVariablesSchema.optional()
}
const CanvasFigmaBlurFields = {
  radius: CanvasNonnegativeNumberSchema,
  visible: z.boolean().optional(),
  variables: CanvasFigmaBlurVariablesSchema.optional()
}
const CanvasFigmaNoiseFields = {
  type: z.literal('NOISE'),
  color: CanvasRgbaSchema,
  visible: z.boolean().optional(),
  blendMode: CanvasBlendModeSchema.optional(),
  noiseSize: CanvasFiniteNumberSchema,
  noiseSizeVector: CanvasVectorSchema.optional(),
  density: CanvasFiniteNumberSchema
}

function noiseSizeMatches(effect: {
  noiseSize: number
  noiseSizeVector?: { x: number; y: number }
}): boolean {
  return (
    effect.noiseSizeVector === undefined ||
    (effect.noiseSizeVector.x === effect.noiseSize && effect.noiseSizeVector.y === effect.noiseSize)
  )
}

const CanvasFigmaNoiseEffectSchema = z
  .discriminatedUnion('noiseType', [
    z
      .object({
        ...CanvasFigmaNoiseFields,
        noiseType: z.literal('MONOTONE')
      })
      .strict(),
    z
      .object({
        ...CanvasFigmaNoiseFields,
        noiseType: z.literal('DUOTONE'),
        secondaryColor: CanvasRgbaSchema
      })
      .strict(),
    z
      .object({
        ...CanvasFigmaNoiseFields,
        noiseType: z.literal('MULTITONE'),
        opacity: CanvasFiniteNumberSchema
      })
      .strict()
  ])
  .refine(noiseSizeMatches, {
    message: 'noiseSizeVector.x and noiseSizeVector.y must equal noiseSize.',
    path: ['noiseSizeVector']
  })

export const CanvasFigmaEffectSchema = z.union([
  z
    .object({
      type: z.literal('DROP_SHADOW'),
      ...CanvasFigmaShadowFields,
      showShadowBehindNode: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('INNER_SHADOW'),
      ...CanvasFigmaShadowFields
    })
    .strict(),
  z
    .object({
      type: z.enum(['LAYER_BLUR', 'BACKGROUND_BLUR']),
      ...CanvasFigmaBlurFields,
      blurType: z.literal('NORMAL')
    })
    .strict(),
  z
    .object({
      type: z.enum(['LAYER_BLUR', 'BACKGROUND_BLUR']),
      ...CanvasFigmaBlurFields,
      blurType: z.literal('PROGRESSIVE'),
      startRadius: CanvasFiniteNumberSchema,
      startOffset: CanvasVectorSchema,
      endOffset: CanvasVectorSchema
    })
    .strict(),
  CanvasFigmaNoiseEffectSchema,
  z
    .object({
      type: z.literal('TEXTURE'),
      visible: z.boolean().optional(),
      noiseSize: CanvasFiniteNumberSchema,
      noiseSizeVector: CanvasVectorSchema.optional(),
      radius: CanvasFiniteNumberSchema,
      clipToShape: z.boolean()
    })
    .strict()
    .refine(noiseSizeMatches, {
      message: 'noiseSizeVector.x and noiseSizeVector.y must equal noiseSize.',
      path: ['noiseSizeVector']
    }),
  z
    .object({
      type: z.literal('GLASS'),
      visible: z.boolean().optional(),
      lightIntensity: CanvasUnitNumberSchema,
      lightAngle: CanvasFiniteNumberSchema,
      refraction: CanvasUnitNumberSchema,
      depth: CanvasFiniteNumberSchema.min(1),
      dispersion: CanvasUnitNumberSchema,
      radius: CanvasFiniteNumberSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('SHADER'),
      id: z.string().min(1),
      visible: z.boolean().optional(),
      properties: z.record(z.string().min(1), CanvasFigmaShaderPropertyValueSchema).optional()
    })
    .strict()
])

export type CanvasFigmaEffect = z.infer<typeof CanvasFigmaEffectSchema>

const CanvasNullableVariableReferenceSchema = CanvasVariableReferenceSchema.nullable()

export const CanvasVariableBindingsSchema = z
  .object({
    fill: CanvasNullableVariableReferenceSchema.optional(),
    stroke: CanvasNullableVariableReferenceSchema.optional(),
    characters: CanvasNullableVariableReferenceSchema.optional(),
    visible: CanvasNullableVariableReferenceSchema.optional(),
    width: CanvasNullableVariableReferenceSchema.optional(),
    height: CanvasNullableVariableReferenceSchema.optional(),
    minWidth: CanvasNullableVariableReferenceSchema.optional(),
    maxWidth: CanvasNullableVariableReferenceSchema.optional(),
    minHeight: CanvasNullableVariableReferenceSchema.optional(),
    maxHeight: CanvasNullableVariableReferenceSchema.optional(),
    gap: CanvasNullableVariableReferenceSchema.optional(),
    counterAxisSpacing: CanvasNullableVariableReferenceSchema.optional(),
    gridRowGap: CanvasNullableVariableReferenceSchema.optional(),
    gridColumnGap: CanvasNullableVariableReferenceSchema.optional(),
    paddingTop: CanvasNullableVariableReferenceSchema.optional(),
    paddingRight: CanvasNullableVariableReferenceSchema.optional(),
    paddingBottom: CanvasNullableVariableReferenceSchema.optional(),
    paddingLeft: CanvasNullableVariableReferenceSchema.optional(),
    cornerRadius: CanvasNullableVariableReferenceSchema.optional(),
    topLeftRadius: CanvasNullableVariableReferenceSchema.optional(),
    topRightRadius: CanvasNullableVariableReferenceSchema.optional(),
    bottomRightRadius: CanvasNullableVariableReferenceSchema.optional(),
    bottomLeftRadius: CanvasNullableVariableReferenceSchema.optional(),
    strokeWeight: CanvasNullableVariableReferenceSchema.optional(),
    strokeTopWeight: CanvasNullableVariableReferenceSchema.optional(),
    strokeRightWeight: CanvasNullableVariableReferenceSchema.optional(),
    strokeBottomWeight: CanvasNullableVariableReferenceSchema.optional(),
    strokeLeftWeight: CanvasNullableVariableReferenceSchema.optional(),
    opacity: CanvasNullableVariableReferenceSchema.optional(),
    fontFamily: CanvasNullableVariableReferenceSchema.optional(),
    fontStyle: CanvasNullableVariableReferenceSchema.optional(),
    fontWeight: CanvasNullableVariableReferenceSchema.optional(),
    fontSize: CanvasNullableVariableReferenceSchema.optional(),
    lineHeight: CanvasNullableVariableReferenceSchema.optional(),
    letterSpacing: CanvasNullableVariableReferenceSchema.optional(),
    paragraphIndent: CanvasNullableVariableReferenceSchema.optional(),
    paragraphSpacing: CanvasNullableVariableReferenceSchema.optional()
  })
  .strict()
  .refine(hasFields, 'Variable bindings cannot be empty.')

export type CanvasVariableBindings = z.infer<typeof CanvasVariableBindingsSchema>

export const CanvasVariableModesSchema = z
  .record(z.string().min(1), z.string().min(1).nullable())
  .refine(hasFields, 'Variable mode overrides cannot be empty.')

export type CanvasVariableModes = z.infer<typeof CanvasVariableModesSchema>

const CanvasVariableScopeSchema = z.enum([
  'ALL_SCOPES',
  'TEXT_CONTENT',
  'CORNER_RADIUS',
  'WIDTH_HEIGHT',
  'GAP',
  'ALL_FILLS',
  'FRAME_FILL',
  'SHAPE_FILL',
  'TEXT_FILL',
  'STROKE_COLOR',
  'STROKE_FLOAT',
  'EFFECT_FLOAT',
  'EFFECT_COLOR',
  'OPACITY',
  'FONT_FAMILY',
  'FONT_STYLE',
  'FONT_WEIGHT',
  'FONT_SIZE',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT'
])

const CanvasVariableValueSchema = z.union([
  z.boolean(),
  z.string(),
  CanvasFiniteNumberSchema,
  CanvasRgbSchema,
  CanvasRgbaSchema,
  CanvasVariableAliasSchema
])

const CanvasVariableModeResourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional()
  })
  .strict()
  .refine(hasFields, 'A variable mode requires an id or desired name.')

const CanvasVariableCodeSyntaxSchema = z
  .object({
    WEB: z.string().min(1).nullable().optional(),
    ANDROID: z.string().min(1).nullable().optional(),
    iOS: z.string().min(1).nullable().optional()
  })
  .strict()
  .refine(hasFields, 'Variable code syntax cannot be empty.')

const CanvasVariableResourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    type: z.enum(['BOOLEAN', 'COLOR', 'FLOAT', 'STRING']).optional(),
    description: z.string().optional(),
    hiddenFromPublishing: z.boolean().optional(),
    scopes: z
      .array(CanvasVariableScopeSchema)
      .refine((scopes) => new Set(scopes).size === scopes.length, {
        message: 'Variable scopes cannot contain duplicates.'
      })
      .optional(),
    codeSyntax: CanvasVariableCodeSyntaxSchema.optional(),
    values: z
      .record(z.string().min(1), CanvasVariableValueSchema)
      .refine(hasFields, 'Variable values cannot be empty.')
      .optional()
  })
  .strict()
  .refine(hasFields, 'A variable resource cannot be empty.')

const CanvasExtendedVariableOverrideSchema = z
  .object({
    variable: CanvasVariableReferenceSchema.describe(
      'Inherited variable to override in this extended collection.'
    ),
    values: z
      .record(z.string().min(1), CanvasVariableValueSchema.nullable())
      .refine(hasFields, 'Extended variable override values cannot be empty.')
      .describe(
        'Extended-mode IDs, inherited parent-mode IDs, or parent authoring keys to override values; null removes an existing override.'
      )
  })
  .strict()

const CanvasVariableCollectionResourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    hiddenFromPublishing: z.boolean().optional(),
    extends: CanvasVariableCollectionReferenceSchema.describe(
      'Existing local or published parent collection for a new extended collection.'
    ).optional(),
    modes: z
      .record(CanvasStableKeySchema, CanvasVariableModeResourceSchema.nullable())
      .refine(hasFields, 'Variable collection modes cannot be empty.')
      .optional(),
    overrides: z
      .array(CanvasExtendedVariableOverrideSchema)
      .min(1)
      .describe('Explicit inherited-variable overrides for an extended collection.')
      .optional(),
    variables: z
      .record(CanvasStableKeySchema, CanvasVariableResourceSchema.nullable())
      .refine(hasFields, 'Variable collection variables cannot be empty.')
      .optional()
  })
  .strict()
  .refine(hasFields, 'A variable collection resource cannot be empty.')

export const MAX_CANVAS_VARIABLE_RESOURCES = 100

export const CanvasVariableCollectionsSchema = z
  .record(CanvasStableKeySchema, CanvasVariableCollectionResourceSchema.nullable())
  .refine(hasFields, 'Variable collections cannot be empty.')
  .superRefine((collections, context) => {
    const variableKeys = new Set<string>()
    let count = 0
    for (const [collectionKey, collection] of Object.entries(collections)) {
      if (collection === null) {
        count += 1
        continue
      }
      count += 1 + Object.keys(collection.modes ?? {}).length + (collection.overrides?.length ?? 0)
      for (const variableKey of Object.keys(collection.variables ?? {})) {
        if (variableKeys.has(variableKey)) {
          context.addIssue({
            code: 'custom',
            message: `Variable key "${variableKey}" is duplicated.`,
            path: [collectionKey, 'variables', variableKey]
          })
        }
        variableKeys.add(variableKey)
        count += 1
      }
    }
    if (count > MAX_CANVAS_VARIABLE_RESOURCES) {
      context.addIssue({
        code: 'custom',
        message: `Variable collections may describe at most ${MAX_CANVAS_VARIABLE_RESOURCES} resources.`
      })
    }
  })

export type CanvasVariableCollections = z.infer<typeof CanvasVariableCollectionsSchema>
export type CanvasVariableValue = z.infer<typeof CanvasVariableValueSchema>

export const CanvasStyleBindingsSchema = z
  .object({
    fill: CanvasStyleReferenceSchema.nullable().optional(),
    stroke: CanvasStyleReferenceSchema.nullable().optional(),
    text: CanvasStyleReferenceSchema.nullable().optional(),
    effect: CanvasStyleReferenceSchema.nullable().optional(),
    grid: CanvasStyleReferenceSchema.nullable().optional()
  })
  .strict()
  .refine(hasFields, 'Style bindings cannot be empty.')

export type CanvasStyleBindings = z.infer<typeof CanvasStyleBindingsSchema>

const CanvasTextCaseSchema = z.enum([
  'ORIGINAL',
  'UPPER',
  'LOWER',
  'TITLE',
  'SMALL_CAPS',
  'SMALL_CAPS_FORCED'
])
const CanvasHyperlinkSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('URL'), value: z.string().min(1) }).strict(),
    z
      .object({
        type: z.literal('NODE'),
        value: z.union([z.string().min(1), z.object({ canvasKey: CanvasStableKeySchema }).strict()])
      })
      .strict()
  ])
  .nullable()

export type CanvasHyperlink = z.infer<typeof CanvasHyperlinkSchema>
const CanvasAutoOrTextMeasureSchema = z.union([
  z.object({ unit: z.literal('AUTO') }).strict(),
  z
    .object({
      unit: z.enum(['PIXELS', 'PERCENT']),
      value: z.number().finite()
    })
    .strict()
])
const CanvasLetterSpacingSchema = z
  .object({
    unit: z.enum(['PIXELS', 'PERCENT']),
    value: z.number().finite()
  })
  .strict()
const CanvasFontNameSchema = z
  .object({
    family: z.string().min(1),
    style: z.string().min(1)
  })
  .strict()

function textVariableBindings(kind: 'range' | 'style') {
  return z
    .object({
      fontFamily: CanvasNullableVariableReferenceSchema.optional(),
      fontSize: CanvasNullableVariableReferenceSchema.optional(),
      fontStyle: CanvasNullableVariableReferenceSchema.optional(),
      fontWeight: CanvasNullableVariableReferenceSchema.optional(),
      letterSpacing: CanvasNullableVariableReferenceSchema.optional(),
      lineHeight: CanvasNullableVariableReferenceSchema.optional(),
      paragraphSpacing: CanvasNullableVariableReferenceSchema.optional(),
      paragraphIndent: CanvasNullableVariableReferenceSchema.optional()
    })
    .strict()
    .refine(hasFields, `Text-${kind} variable bindings cannot be empty.`)
}

const CanvasFigmaTextRangeVariablesSchema = textVariableBindings('range')

export const CanvasFigmaTextRangeSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    fontName: CanvasFontNameSchema.optional(),
    fontSize: z.number().finite().min(1).optional(),
    textCase: CanvasTextCaseSchema.optional(),
    letterSpacing: CanvasLetterSpacingSchema.optional(),
    lineHeight: CanvasAutoOrTextMeasureSchema.optional(),
    textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
    textDecorationStyle: z.enum(['SOLID', 'WAVY', 'DOTTED']).optional(),
    textDecorationOffset: CanvasAutoOrTextMeasureSchema.optional(),
    textDecorationThickness: CanvasAutoOrTextMeasureSchema.optional(),
    textDecorationColor: z
      .union([
        z.object({ value: z.literal('AUTO') }).strict(),
        z.object({ value: CanvasFigmaSolidPaintSchema }).strict()
      ])
      .optional(),
    textDecorationSkipInk: z.boolean().optional(),
    fills: z.array(CanvasFigmaPaintSchema).optional(),
    textStyle: CanvasStyleReferenceSchema.nullable().optional(),
    fillStyle: CanvasStyleReferenceSchema.nullable().optional(),
    listOptions: z
      .object({
        type: z.enum(['ORDERED', 'UNORDERED', 'NONE'])
      })
      .strict()
      .optional(),
    listSpacing: z.number().finite().optional(),
    indentation: z.number().finite().optional(),
    paragraphIndent: z.number().finite().optional(),
    paragraphSpacing: z.number().finite().optional(),
    hyperlink: CanvasHyperlinkSchema.optional(),
    variables: CanvasFigmaTextRangeVariablesSchema.optional()
  })
  .strict()
  .superRefine((range, context) => {
    if (range.end <= range.start) {
      context.addIssue({
        code: 'custom',
        message: 'Text-range end must be greater than start.',
        path: ['end']
      })
    }
    if (Object.keys(range).every((field) => field === 'start' || field === 'end')) {
      context.addIssue({
        code: 'custom',
        message: 'A text range requires at least one desired field.'
      })
    }
    if (range.fills !== undefined && range.fillStyle !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A text range cannot combine direct fills and a fill style.',
        path: ['fills']
      })
    }
  })

export type CanvasFigmaTextRange = z.infer<typeof CanvasFigmaTextRangeSchema>

export const CanvasFigmaTextPropertiesSchema = z
  .object({
    autoRename: z.boolean().optional(),
    fontName: CanvasFontNameSchema.optional(),
    verticalAlign: z.enum(['TOP', 'CENTER', 'BOTTOM']).optional(),
    case: CanvasTextCaseSchema.optional(),
    paragraphIndent: z.number().finite().optional(),
    paragraphSpacing: z.number().finite().optional(),
    listSpacing: z.number().finite().optional(),
    hangingPunctuation: z.boolean().optional(),
    hangingList: z.boolean().optional(),
    leadingTrim: z.enum(['CAP_HEIGHT', 'NONE']).optional(),
    hyperlink: CanvasHyperlinkSchema.optional(),
    ranges: z
      .array(CanvasFigmaTextRangeSchema)
      .min(1)
      .superRefine((ranges, context) => {
        for (let index = 1; index < ranges.length; index += 1) {
          if (ranges[index]!.start < ranges[index - 1]!.end) {
            context.addIssue({
              code: 'custom',
              message: 'Text ranges must be ordered and non-overlapping.',
              path: [index, 'start']
            })
          }
        }
      })
      .optional()
  })
  .strict()
  .refine(hasFields, 'Figma text properties cannot be empty.')

export type CanvasFigmaTextProperties = z.infer<typeof CanvasFigmaTextPropertiesSchema>

const CanvasFigmaArcSchema = z
  .object({
    startAngle: z.number().finite().describe('Clockwise degrees from the positive x-axis.'),
    endAngle: z.number().finite().describe('Clockwise degrees from the positive x-axis.'),
    innerRadius: CanvasUnitNumberSchema
  })
  .strict()

const CanvasStrokeCapSchema = z.enum([
  'NONE',
  'ROUND',
  'SQUARE',
  'ARROW_LINES',
  'ARROW_EQUILATERAL',
  'DIAMOND_FILLED',
  'TRIANGLE_FILLED',
  'CIRCLE_FILLED'
])
const CanvasStrokeJoinSchema = z.enum(['MITER', 'BEVEL', 'ROUND'])
const CanvasHandleMirroringSchema = z.enum(['NONE', 'ANGLE', 'ANGLE_AND_LENGTH'])
const CanvasFigmaVectorVertexSchema = CanvasVectorSchema.extend({
  strokeCap: CanvasStrokeCapSchema.optional(),
  strokeJoin: CanvasStrokeJoinSchema.optional(),
  cornerRadius: CanvasNonnegativeNumberSchema.optional(),
  handleMirroring: CanvasHandleMirroringSchema.optional()
}).strict()
const CanvasFigmaVectorSegmentSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    tangentStart: CanvasVectorSchema.optional(),
    tangentEnd: CanvasVectorSchema.optional()
  })
  .strict()
const CanvasFigmaVectorRegionSchema = z
  .object({
    windingRule: z.enum(['NONZERO', 'EVENODD']),
    loops: z.array(z.array(z.number().int().nonnegative()).min(1)).min(1),
    fills: z.array(CanvasFigmaPaintSchema).optional(),
    fillStyle: CanvasStyleReferenceSchema.optional()
  })
  .strict()
  .refine((region) => !(region.fills && region.fillStyle), {
    message: 'A vector region cannot combine direct fills with a fill style.'
  })

type CanvasFigmaVectorSegment = z.infer<typeof CanvasFigmaVectorSegmentSchema>

function vectorLoopCloses(loop: number[], segments: CanvasFigmaVectorSegment[]) {
  const first = segments[loop[0]!]
  if (!first) return true
  const walk = (start: number, next: number): boolean => {
    let vertex = next
    for (const segmentIndex of loop.slice(1)) {
      const segment = segments[segmentIndex]
      if (!segment) return true
      if (segment.start === vertex) vertex = segment.end
      else if (segment.end === vertex) vertex = segment.start
      else return false
    }
    return vertex === start
  }
  return walk(first.start, first.end) || walk(first.end, first.start)
}

export const CanvasFigmaVectorNetworkSchema = z
  .object({
    vertices: z.array(CanvasFigmaVectorVertexSchema),
    segments: z.array(CanvasFigmaVectorSegmentSchema),
    regions: z.array(CanvasFigmaVectorRegionSchema).optional()
  })
  .strict()
  .superRefine((network, context) => {
    network.segments.forEach((segment, index) => {
      for (const field of ['start', 'end'] as const) {
        if (segment[field] >= network.vertices.length) {
          context.addIssue({
            code: 'custom',
            message: `Vector segment ${field} must reference an existing vertex.`,
            path: ['segments', index, field]
          })
        }
      }
    })
    network.regions?.forEach((region, regionIndex) => {
      region.loops.forEach((loop, loopIndex) => {
        for (const [index, segment] of loop.entries()) {
          if (segment >= network.segments.length) {
            context.addIssue({
              code: 'custom',
              message: 'Vector region loops must reference existing segments.',
              path: ['regions', regionIndex, 'loops', loopIndex, index]
            })
          }
        }
        if (
          loop.every((segment) => segment < network.segments.length) &&
          !vectorLoopCloses(loop, network.segments)
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Vector region loops must form a closed continuous chain.',
            path: ['regions', regionIndex, 'loops', loopIndex]
          })
        }
      })
    })
  })

export type CanvasFigmaVectorNetwork = z.infer<typeof CanvasFigmaVectorNetworkSchema>

export const CanvasFigmaVectorPathSchema = z
  .object({
    windingRule: z.enum(['NONE', 'NONZERO', 'EVENODD']),
    data: z.string().trim().min(1)
  })
  .strict()

export type CanvasFigmaVectorPath = z.infer<typeof CanvasFigmaVectorPathSchema>

export const CanvasFigmaShapeSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('RECTANGLE') }).strict(),
    z.object({ type: z.literal('LINE') }).strict(),
    z
      .object({
        type: z.literal('ELLIPSE'),
        arc: CanvasFigmaArcSchema.optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('POLYGON'),
        pointCount: z.number().int().min(3).optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('STAR'),
        pointCount: z.number().int().min(3).optional(),
        innerRadius: CanvasUnitNumberSchema.optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('VECTOR'),
        paths: z.array(CanvasFigmaVectorPathSchema).optional(),
        network: CanvasFigmaVectorNetworkSchema.optional(),
        handleMirroring: CanvasHandleMirroringSchema.optional()
      })
      .strict()
  ])
  .superRefine((shape, context) => {
    if (shape.type === 'VECTOR' && shape.paths !== undefined && shape.network !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A vector shape cannot combine paths with a vector network.'
      })
    }
  })

export type CanvasFigmaShape = z.infer<typeof CanvasFigmaShapeSchema>

const CanvasSideValuesSchema = z
  .object({
    top: CanvasNonnegativeNumberSchema,
    right: CanvasNonnegativeNumberSchema,
    bottom: CanvasNonnegativeNumberSchema,
    left: CanvasNonnegativeNumberSchema
  })
  .strict()

export const CanvasFigmaStrokePropertiesSchema = z
  .object({
    weight: CanvasNonnegativeNumberSchema.optional(),
    weights: CanvasSideValuesSchema.optional(),
    align: z.enum(['CENTER', 'INSIDE', 'OUTSIDE']).optional(),
    cap: CanvasStrokeCapSchema.optional(),
    join: CanvasStrokeJoinSchema.optional(),
    miterLimit: z.number().finite().min(1).optional(),
    dashPattern: z.array(CanvasNonnegativeNumberSchema).optional()
  })
  .strict()
  .refine(hasFields, 'Figma stroke properties cannot be empty.')
  .refine((stroke) => !(stroke.weight !== undefined && stroke.weights), {
    message: 'Uniform and individual stroke weights cannot be combined.'
  })

export type CanvasFigmaStrokeProperties = z.infer<typeof CanvasFigmaStrokePropertiesSchema>

const CanvasCornerRadiiSchema = z
  .object({
    topLeft: CanvasNonnegativeNumberSchema,
    topRight: CanvasNonnegativeNumberSchema,
    bottomRight: CanvasNonnegativeNumberSchema,
    bottomLeft: CanvasNonnegativeNumberSchema
  })
  .strict()

export const CanvasFigmaCornerPropertiesSchema = z
  .object({
    radius: CanvasNonnegativeNumberSchema.optional(),
    radii: CanvasCornerRadiiSchema.optional(),
    smoothing: CanvasUnitNumberSchema.optional()
  })
  .strict()
  .refine(hasFields, 'Figma corner properties cannot be empty.')
  .refine((corners) => !(corners.radius !== undefined && corners.radii), {
    message: 'Uniform and individual corner radii cannot be combined.'
  })

export type CanvasFigmaCornerProperties = z.infer<typeof CanvasFigmaCornerPropertiesSchema>

export const CanvasFigmaAutoLayoutPropertiesSchema = z
  .object({
    itemSpacing: CanvasFiniteNumberSchema.optional(),
    counterAxisSpacing: CanvasFiniteNumberSchema.positive().nullable().optional(),
    itemReverseZIndex: z.boolean().optional()
  })
  .strict()
  .refine(hasFields, 'Figma Auto Layout properties cannot be empty.')

export type CanvasFigmaAutoLayoutProperties = z.infer<typeof CanvasFigmaAutoLayoutPropertiesSchema>

const CanvasFigmaLayoutGridVariablesSchema = z
  .object({
    sectionSize: CanvasVariableReferenceSchema.optional(),
    count: CanvasVariableReferenceSchema.optional(),
    offset: CanvasVariableReferenceSchema.optional(),
    gutterSize: CanvasVariableReferenceSchema.optional()
  })
  .strict()
  .refine(hasFields, 'Layout-grid variable bindings cannot be empty.')

export const CanvasFigmaLayoutGridSchema = z
  .discriminatedUnion('pattern', [
    z
      .object({
        pattern: z.enum(['ROWS', 'COLUMNS']),
        alignment: z.enum(['MIN', 'MAX', 'STRETCH', 'CENTER']),
        gutterSize: CanvasFiniteNumberSchema,
        count: z.union([z.number().int().positive(), z.literal('AUTO')]),
        sectionSize: CanvasFiniteNumberSchema.optional(),
        offset: CanvasFiniteNumberSchema.optional(),
        visible: z.boolean().optional(),
        color: CanvasRgbaSchema.optional(),
        variables: CanvasFigmaLayoutGridVariablesSchema.optional()
      })
      .strict(),
    z
      .object({
        pattern: z.literal('GRID'),
        sectionSize: CanvasFiniteNumberSchema,
        visible: z.boolean().optional(),
        color: CanvasRgbaSchema.optional(),
        variables: z
          .object({
            sectionSize: CanvasVariableReferenceSchema
          })
          .strict()
          .optional()
      })
      .strict()
  ])
  .superRefine((grid, context) => {
    if (grid.pattern === 'GRID') return
    if (
      grid.alignment === 'STRETCH' &&
      (grid.sectionSize !== undefined || grid.variables?.sectionSize)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'STRETCH layout grids cannot set or bind ignored sectionSize.',
        path: ['sectionSize']
      })
    }
    if (grid.alignment === 'CENTER' && (grid.offset !== undefined || grid.variables?.offset)) {
      context.addIssue({
        code: 'custom',
        message: 'CENTER layout grids cannot set or bind ignored offset.',
        path: ['offset']
      })
    }
  })

export type CanvasFigmaLayoutGrid = z.infer<typeof CanvasFigmaLayoutGridSchema>

const CanvasTextStyleVariablesSchema = textVariableBindings('style')

const CanvasStyleResourceFields = {
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  descriptionMarkdown: z.string().optional(),
  documentationLink: z.string().url().nullable().optional()
}

const CanvasStyleResourceSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...CanvasStyleResourceFields,
      type: z.literal('PAINT'),
      paints: z.array(CanvasFigmaPaintSchema).optional()
    })
    .strict(),
  z
    .object({
      ...CanvasStyleResourceFields,
      type: z.literal('TEXT'),
      fontName: CanvasFontNameSchema.optional(),
      fontSize: z.number().finite().min(1).optional(),
      textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).optional(),
      letterSpacing: CanvasLetterSpacingSchema.optional(),
      lineHeight: CanvasAutoOrTextMeasureSchema.optional(),
      leadingTrim: z.enum(['CAP_HEIGHT', 'NONE']).optional(),
      paragraphIndent: z.number().finite().optional(),
      paragraphSpacing: z.number().finite().optional(),
      listSpacing: z.number().finite().optional(),
      hangingPunctuation: z.boolean().optional(),
      hangingList: z.boolean().optional(),
      textCase: CanvasTextCaseSchema.optional(),
      variables: CanvasTextStyleVariablesSchema.optional()
    })
    .strict(),
  z
    .object({
      ...CanvasStyleResourceFields,
      type: z.literal('EFFECT'),
      effects: z.array(CanvasFigmaEffectSchema).optional()
    })
    .strict(),
  z
    .object({
      ...CanvasStyleResourceFields,
      type: z.literal('GRID'),
      layoutGrids: z.array(CanvasFigmaLayoutGridSchema).optional()
    })
    .strict()
])

export const MAX_CANVAS_STYLE_RESOURCES = 100

export const CanvasStylesSchema = z
  .record(CanvasStableKeySchema, CanvasStyleResourceSchema.nullable())
  .refine(hasFields, 'Styles cannot be empty.')
  .refine((styles) => Object.keys(styles).length <= MAX_CANVAS_STYLE_RESOURCES, {
    message: `Styles may describe at most ${MAX_CANVAS_STYLE_RESOURCES} resources.`
  })

export type CanvasStyles = z.infer<typeof CanvasStylesSchema>
export type CanvasStyleResource = z.infer<typeof CanvasStyleResourceSchema>

export const CanvasFigmaGuideSchema = z
  .object({
    axis: z.enum(['X', 'Y']),
    offset: CanvasFiniteNumberSchema
  })
  .strict()

export type CanvasFigmaGuide = z.infer<typeof CanvasFigmaGuideSchema>

export const CanvasPagePropertiesSchema = z
  .object({
    id: z.string().min(1).describe('Existing local page id to target or adopt.').optional(),
    pageKey: CanvasStableKeySchema.describe(
      'Stable key of a local page authored through apply_canvas.'
    ).optional(),
    name: z.string().optional(),
    index: z
      .number()
      .int()
      .nonnegative()
      .describe('Zero-based position of the page in the Figma document.')
      .optional(),
    background: CanvasRgbaSchema.describe(
      'The page canvas background as its single supported solid RGBA color.'
    ).optional(),
    guides: z
      .array(CanvasFigmaGuideSchema)
      .describe('Ordered guides on the page containing the applied result.')
      .optional(),
    variableModes: CanvasVariableModesSchema.describe(
      'Explicit collection modes inherited by nodes on the result page.'
    ).optional()
  })
  .strict()
  .refine(hasFields, 'Page properties cannot be empty.')

export type CanvasPageProperties = z.infer<typeof CanvasPagePropertiesSchema>

const CanvasFigmaInstancePropertiesSchema = z
  .object({
    scaleFactor: CanvasFiniteNumberSchema.min(0.01).optional(),
    exposed: z.boolean().optional(),
    preserveOverrides: z
      .boolean()
      .describe(
        'Whether a changed component binding preserves existing instance overrides. Omission preserves them.'
      )
      .optional()
  })
  .strict()
  .refine(hasFields, 'Figma instance properties cannot be empty.')

const CanvasFigmaSectionPropertiesSchema = z
  .object({
    contentsHidden: z.boolean().optional()
  })
  .strict()

const CanvasFigmaBooleanOperationSchema = z.enum(['UNION', 'SUBTRACT', 'INTERSECT', 'EXCLUDE'])

const CanvasFigmaComponentPreferredValueSchema = z
  .object({
    type: z.enum(['COMPONENT', 'COMPONENT_SET']),
    key: z.string().min(1)
  })
  .strict()

const CanvasFigmaComponentPropertyDefinitionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('BOOLEAN'),
      name: z.string().min(1),
      defaultValue: z.union([z.boolean(), CanvasVariableAliasSchema])
    })
    .strict(),
  z
    .object({
      type: z.literal('TEXT'),
      name: z.string().min(1),
      defaultValue: z.union([z.string(), CanvasVariableAliasSchema])
    })
    .strict(),
  z
    .object({
      type: z.literal('INSTANCE_SWAP'),
      name: z.string().min(1),
      defaultValue: z.union([CanvasDesignReferenceSchema, CanvasVariableAliasSchema]),
      preferredValues: z.array(CanvasFigmaComponentPreferredValueSchema).optional()
    })
    .strict()
])

const CanvasFigmaComponentPropertiesSchema = z
  .record(z.string().min(1).max(256), CanvasFigmaComponentPropertyDefinitionSchema.nullable())
  .refine(hasFields, 'Component property patches cannot be empty.')

const CanvasFigmaAuthoredComponentSchema = z
  .object({
    type: z.enum(['COMPONENT', 'COMPONENT_SET']),
    descriptionMarkdown: z.string().optional(),
    documentationLink: z.string().url().nullable().optional(),
    properties: CanvasFigmaComponentPropertiesSchema.describe(
      'Component-property definitions keyed by a stable logical name or an existing exact Figma property name. A definition creates or updates it; null explicitly deletes it.'
    ).optional()
  })
  .strict()

const CanvasFigmaSlotSettingsSchema = z
  .object({
    stretchChildOnInsert: z.boolean().optional(),
    displayEmptyByDefault: z.boolean().optional(),
    minChildren: z.number().int().nonnegative().nullable().optional(),
    maxChildren: z.number().int().nonnegative().nullable().optional(),
    allowPreferredValuesOnly: z.boolean().optional()
  })
  .strict()
  .refine(hasFields, 'Slot settings cannot be empty.')
  .superRefine((settings, context) => {
    if (
      settings.minChildren != null &&
      settings.maxChildren != null &&
      settings.minChildren > settings.maxChildren
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Slot minChildren cannot exceed maxChildren.'
      })
    }
  })

const CanvasFigmaSlotSchema = z
  .object({
    property: z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        preferredValues: z.array(CanvasFigmaComponentPreferredValueSchema).optional(),
        settings: CanvasFigmaSlotSettingsSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict()

const CanvasFigmaComponentPropertyReferencesSchema = z
  .object({
    visible: z.string().min(1).max(256).nullable().optional(),
    characters: z.string().min(1).max(256).nullable().optional(),
    mainComponent: z.string().min(1).max(256).nullable().optional()
  })
  .strict()
  .refine(hasFields, 'Component property references cannot be empty.')

export type CanvasFigmaComponentPropertyDefinition = z.infer<
  typeof CanvasFigmaComponentPropertyDefinitionSchema
>
export type CanvasFigmaSlotProperty = NonNullable<z.infer<typeof CanvasFigmaSlotSchema>['property']>

const CanvasSvgPlacementSchema = z
  .object({
    assetKey: CanvasStableKeySchema,
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/)
      .optional()
  })
  .strict()

export const CanvasFigmaPropertiesSchema = z
  .object({
    name: z.string().optional(),
    locked: z.boolean().optional(),
    aspectRatioLocked: z.boolean().optional(),
    relativeTransform: CanvasRelativeTransformSchema.describe(
      'Native translation, rotation, and skew matrix. Auto Layout computes child translation. Create roots preserve the axes but use automatic placement. Width and height remain separate.'
    ).optional(),
    mask: z
      .enum(['ALPHA', 'VECTOR', 'LUMINANCE'])
      .nullable()
      .describe(
        'Native sibling mask. A type enables it, null disables it, and omission preserves it.'
      )
      .optional(),
    autoLayout: CanvasFigmaAutoLayoutPropertiesSchema.describe(
      'Native linear Auto Layout spacing and stacking with no honest CSS equivalent.'
    ).optional(),
    layoutGrids: z
      .array(CanvasFigmaLayoutGridSchema)
      .describe('Ordered frame layout grids. Omit to preserve live grids; use [] to clear them.')
      .optional(),
    guides: z
      .array(CanvasFigmaGuideSchema)
      .describe('Ordered frame guides. Omit to preserve live guides; use [] to clear them.')
      .optional(),
    instance: CanvasFigmaInstancePropertiesSchema.describe(
      'Native instance-only scale-tool factor, component-swap override policy, and existing primary nested-instance exposure state.'
    ).optional(),
    section: CanvasFigmaSectionPropertiesSchema.describe(
      'Native section container for organizing screens. An empty object selects the node type; contentsHidden controls whether its contents are collapsed on the canvas.'
    ).optional(),
    group: z
      .literal(true)
      .describe(
        'Native intrinsic group fitted to its children. Repeat true on updates to preserve the node kind.'
      )
      .optional(),
    booleanOperation: CanvasFigmaBooleanOperationSchema.describe(
      'Native non-destructive boolean operation fitted to its shape or text children.'
    ).optional(),
    component: CanvasFigmaAuthoredComponentSchema.describe(
      'Native authored component or component set, including optional publishable metadata and component-property definition patches.'
    ).optional(),
    slot: CanvasFigmaSlotSchema.describe(
      'Native slot frame. An empty object preserves an existing slot; new slots require property metadata.'
    ).optional(),
    svg: CanvasSvgPlacementSchema.describe(
      'Figma-native import of a declared SVG asset into a childless managed frame.'
    ).optional(),
    componentPropertyReferences: CanvasFigmaComponentPropertyReferencesSchema.describe(
      'Links a component sublayer field to a stable or exact component-property definition name. Null clears one link.'
    ).optional(),
    text: CanvasFigmaTextPropertiesSchema.optional(),
    shape: CanvasFigmaShapeSchema.describe(
      'Native editable shape for a childless div. Repeat it on updates to preserve the node kind; omitted geometry preserves live update values.'
    ).optional(),
    stroke: CanvasFigmaStrokePropertiesSchema.describe(
      'Figma stroke geometry. It does not create a stroke paint.'
    ).optional(),
    corners: CanvasFigmaCornerPropertiesSchema.describe(
      'Figma corner geometry for nodes that expose corner properties.'
    ).optional(),
    effects: z
      .array(CanvasFigmaEffectSchema)
      .describe(
        'Ordered native Figma effect stack. Omit to preserve live effects; use [] to clear them.'
      )
      .optional(),
    fills: z
      .array(CanvasFigmaPaintSchema)
      .describe(
        'Ordered native Figma fill stack. Omit to preserve live fills; use [] to clear them.'
      )
      .optional(),
    strokes: z
      .array(CanvasFigmaPaintSchema)
      .describe(
        'Ordered native Figma stroke-paint stack. Omit to preserve live strokes; use [] to clear them.'
      )
      .optional()
  })
  .strict()
  .refine(hasFields, 'Figma properties cannot be empty.')
  .refine(
    (properties) =>
      [
        properties.text,
        properties.shape,
        properties.section,
        properties.group,
        properties.booleanOperation,
        properties.component,
        properties.slot,
        properties.svg
      ].filter(Boolean).length < 2,
    {
      message:
        'Figma text, shape, section, group, boolean-operation, authored-component, slot, and SVG properties are mutually exclusive.'
    }
  )
  .refine((properties) => !(properties.name !== undefined && properties.text?.autoRename), {
    message: 'An auto-renamed text node cannot also declare a fixed layer name.',
    path: ['name']
  })

export type CanvasFigmaProperties = z.infer<typeof CanvasFigmaPropertiesSchema>

const CanvasComponentPropertyValueSchema = z.union([
  z.string(),
  z.boolean(),
  CanvasVariableAliasSchema
])

export type CanvasComponentPropertyValue = z.infer<typeof CanvasComponentPropertyValueSchema>

export const CanvasBindingSchema = z
  .object({
    component: CanvasDesignReferenceSchema.describe(
      'Design-system component used by the childless div with this data-key.'
    ).optional(),
    componentProperties: z
      .record(z.string().min(1), CanvasComponentPropertyValueSchema)
      .describe(
        'Exposed component values. Direct values remove a variable alias, variable references bind one, and omission preserves the property.'
      )
      .optional(),
    variables: CanvasVariableBindingsSchema.describe(
      'Figma variable bindings for the markup node. References bind and null clears; bindings win over literal classes.'
    ).optional(),
    variableModes: CanvasVariableModesSchema.describe(
      'Explicit mode by variable collection id. A mode id sets the override and null clears it.'
    ).optional(),
    styles: CanvasStyleBindingsSchema.describe(
      'Figma style bindings for the markup node. References apply, null unlinks, and non-null styles win over literal classes.'
    ).optional(),
    figma: CanvasFigmaPropertiesSchema.describe(
      'Typed Figma-only node state that has no honest HTML or Tailwind equivalent.'
    ).optional()
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      !binding.component &&
      !binding.variables &&
      !binding.variableModes &&
      !binding.styles &&
      !binding.figma
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A canvas binding requires a component, variables, variable modes, styles, or Figma properties.'
      })
    }
    if (binding.componentProperties && !binding.component) {
      context.addIssue({
        code: 'custom',
        message: 'componentProperties require a component reference.',
        path: ['componentProperties']
      })
    }
    if (
      binding.component &&
      (binding.figma?.shape ||
        binding.figma?.section ||
        binding.figma?.group ||
        binding.figma?.booleanOperation ||
        binding.figma?.component ||
        binding.figma?.slot ||
        binding.figma?.svg)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A component binding cannot also create a native shape, section, group, boolean operation, authored component, slot, or SVG.',
        path: ['figma']
      })
    }
    if (binding.figma?.instance && !binding.component) {
      context.addIssue({
        code: 'custom',
        message: 'Figma instance properties require a component reference.',
        path: ['figma', 'instance']
      })
    }
  })

export type CanvasBinding = z.infer<typeof CanvasBindingSchema>

export const MAX_CANVAS_NODES = 100
export const MAX_CANVAS_DEPTH = 12
export const MAX_CANVAS_MARKUP_LENGTH = 200_000

const CanvasBindingsSchema = z
  .record(CanvasStableKeySchema, CanvasBindingSchema)
  .refine((bindings) => Object.keys(bindings).length <= MAX_CANVAS_NODES, {
    message: `Canvas bindings may contain at most ${MAX_CANVAS_NODES} entries.`
  })

const CanvasRemoveKeysSchema = z
  .array(CanvasStableKeySchema)
  .max(MAX_CANVAS_NODES)
  .refine((keys) => new Set(keys).size === keys.length, {
    message: 'removeKeys cannot contain duplicate stable keys.'
  })

const CanvasAssetHashSchema = z.string().regex(MCP_HASH_PATTERN)
const CanvasAssetSchema = z.union([
  z
    .object({
      type: z.literal('SVG'),
      svg: z
        .string()
        .min(1)
        .max(32 * 1024)
    })
    .strict(),
  z.object({ type: z.literal('SVG'), assetHash: CanvasAssetHashSchema }).strict(),
  z.object({ type: z.literal('IMAGE'), assetHash: CanvasAssetHashSchema }).strict()
])
export const CanvasAssetsSchema = z
  .record(CanvasStableKeySchema, CanvasAssetSchema)
  .refine((assets) => Object.keys(assets).length <= 32, {
    message: 'Canvas assets may contain at most 32 entries.'
  })
  .refine(
    (assets) =>
      Object.values(assets).reduce(
        (bytes, asset) =>
          bytes + ('svg' in asset ? new TextEncoder().encode(asset.svg).byteLength : 0),
        0
      ) <=
      64 * 1024,
    {
      message: 'Inline SVG assets may contain at most 64 KiB in total.'
    }
  )

export type CanvasAssets = z.infer<typeof CanvasAssetsSchema>

const CanvasNativeBindingSchema = z
  .object({
    component: z
      .object({
        id: z.string().min(1)
      })
      .strict()
      .describe('Exact live component or component-set id from prior canvas work.')
      .optional(),
    componentProperties: z
      .record(z.string().min(1), CanvasComponentPropertyValueSchema)
      .describe('Values keyed by an exact Figma property name or a TemPad-authored stable key.')
      .optional(),
    variables: z
      .record(z.string(), z.object({ variableKey: CanvasStableKeySchema }).strict().nullable())
      .describe('Local authored-variable bindings and explicit null removals.')
      .optional(),
    variableModes: z
      .record(z.string(), z.string().nullable())
      .describe('Explicit collection modes; catalog kN/mN_M refs require catalogId.')
      .optional(),
    styles: z
      .object({
        fill: z.object({ styleKey: CanvasStableKeySchema }).strict().nullable().optional(),
        stroke: z.object({ styleKey: CanvasStableKeySchema }).strict().nullable().optional(),
        text: z.object({ styleKey: CanvasStableKeySchema }).strict().nullable().optional(),
        effect: z.object({ styleKey: CanvasStableKeySchema }).strict().nullable().optional(),
        grid: z.object({ styleKey: CanvasStableKeySchema }).strict().nullable().optional()
      })
      .strict()
      .describe('Local authored-style bindings and explicit null removals.')
      .optional(),
    figma: z
      .record(z.string(), z.unknown())
      .describe(
        'Strict Figma-only desired state. Before using it, load the matching progressive capability reference from the canvas-authoring skill and follow a complete example.'
      )
      .optional()
  })
  .strict()
  .refine((binding) => !binding.componentProperties || binding.component, {
    message: 'componentProperties require a component reference.',
    path: ['componentProperties']
  })

type CanvasApplyScope = {
  mode: 'create' | 'update'
  targetNodeId?: string
  markup: string | null
  bindings?: unknown
  native?: unknown
  catalogId?: string
  variableCollections?: unknown
  styles?: unknown
  assets?: unknown
  removeKeys?: string[]
  page?: unknown
}

function validateCanvasApplyScope<Value extends CanvasApplyScope>(
  value: Value,
  context: RefinementCtx<Value>
): void {
  const issue = (message: string, path: keyof CanvasApplyScope): void =>
    context.addIssue({ code: 'custom', message, path: [path] })
  if (value.mode === 'create' && value.targetNodeId !== undefined) {
    issue('targetNodeId is only valid in update mode.', 'targetNodeId')
  }
  if (value.mode === 'create' && value.removeKeys !== undefined) {
    issue('removeKeys is only valid in update mode.', 'removeKeys')
  }
  if (value.mode === 'create' && value.markup === null) {
    issue('Create mode requires markup.', 'markup')
  }
  if (value.mode === 'update' && value.targetNodeId === undefined) {
    issue('Update mode requires targetNodeId.', 'targetNodeId')
  }
  if (value.markup !== null) return
  for (const field of [
    'bindings',
    'native',
    'catalogId',
    'variableCollections',
    'styles',
    'assets',
    'removeKeys',
    'page'
  ] as const) {
    if (value[field] !== undefined) issue(`Root removal cannot include ${field}.`, field)
  }
}

export const ApplyCanvasParametersSchema = z
  .object({
    mode: z.enum(['create', 'update']),
    targetNodeId: z.string().min(1).optional(),
    catalogId: z.string().min(1).optional(),
    markup: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CANVAS_MARKUP_LENGTH)
      .nullable()
      .describe(
        'Desired div/span tree. Use catalog component tags directly; bind catalog variables and styles with data-var-<field>="vN" and data-style-<field>="sN". Use "none" to unlink.'
      ),
    native: z
      .record(CanvasStableKeySchema, CanvasNativeBindingSchema)
      .describe('Only Figma state without an honest markup expression, keyed by markup data-key.')
      .optional(),
    variableCollections: z
      .record(CanvasStableKeySchema, z.unknown())
      .describe(
        'Optional local variable collections, modes, and variables. This does not require catalogId; load the skill variables/styles reference and follow its complete example.'
      )
      .optional(),
    styles: z
      .record(CanvasStableKeySchema, z.unknown())
      .describe(
        'Optional local Paint, Text, Effect, and Grid styles. This does not require catalogId; load the skill variables/styles reference and follow its complete example.'
      )
      .optional(),
    assets: z
      .record(CanvasStableKeySchema, z.unknown())
      .describe(
        'Optional call-scoped SVG or content-addressed media assets. Load the skill visual-assets reference before using it.'
      )
      .optional(),
    removeKeys: CanvasRemoveKeysSchema.optional(),
    page: z
      .record(z.string(), z.unknown())
      .describe(
        'Optional local page identity and desired state. Load the skill document-geometry reference before using it.'
      )
      .optional()
  })
  .strict()
  .superRefine(validateCanvasApplyScope)

export type ApplyCanvasParametersInput = z.input<typeof ApplyCanvasParametersSchema>
export type ApplyCanvasParameters = z.output<typeof ApplyCanvasParametersSchema>

export const CanvasResolvedApplyParametersSchema = z
  .object({
    mode: z
      .enum(['create', 'update'])
      .describe('Create one new markup tree, or update one explicitly scoped live subtree.'),
    targetNodeId: z
      .string()
      .min(1)
      .describe('Required update-scope root node id; invalid in create mode.')
      .optional(),
    markup: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CANVAS_MARKUP_LENGTH)
      .nullable()
      .describe(
        'One well-formed div/span tree using the documented Tailwind utility subset. In update mode, null asserts that the managed target itself must be absent.'
      ),
    bindings: CanvasBindingsSchema.describe(
      'Optional Figma component, variable, style, and typed native data keyed by markup data-key.'
    ).optional(),
    variableCollections: CanvasVariableCollectionsSchema.describe(
      'Optional local base or extended variable collections, modes, variables, and inherited-value overrides keyed by stable authoring identities. Omission preserves resources; null explicitly removes an unconsumed managed resource.'
    ).optional(),
    styles: CanvasStylesSchema.describe(
      'Optional local Paint, Text, Effect, and Grid styles keyed by stable authoring identities. Omission preserves resources; null explicitly removes an unconsumed managed style.'
    ).optional(),
    assets: CanvasAssetsSchema.describe(
      'Call-scoped inline SVG or content-addressed SVG/image assets referenced by native desired state.'
    ).optional(),
    removeKeys: CanvasRemoveKeysSchema.describe(
      'Optional stable keys that must be absent after a scoped update. Omitted live nodes remain untouched.'
    ).optional(),
    page: CanvasPagePropertiesSchema.describe(
      'Optional local page identity and desired state, including its exact document position. A missing pageKey creates a named page in create mode; omission targets the page containing the result.'
    ).optional()
  })
  .strict()
  .superRefine(validateCanvasApplyScope)

export type CanvasResolvedApplyParameters = z.output<typeof CanvasResolvedApplyParametersSchema>

export const ApplyCanvasResultSchema = z
  .object({
    rootNodeId: z.string().min(1),
    rootRemoved: z.literal(true).optional(),
    nodeIdsByKey: z.record(z.string(), z.string().min(1)),
    createdNodeIds: z.array(z.string().min(1)),
    updatedNodeIds: z.array(z.string().min(1)),
    removedNodeIds: z.array(z.string().min(1)),
    mutationCount: z.number().int().nonnegative(),
    verification: z
      .object({
        status: z.enum(['passed', 'warning']),
        nodesChecked: z.number().int().nonnegative(),
        referencesChecked: z.number().int().nonnegative(),
        warnings: z.array(
          z
            .object({
              code: z.string().min(1),
              message: z.string(),
              key: z.string().optional()
            })
            .strict()
        )
      })
      .strict()
  })
  .strict()

export type ApplyCanvasResult = z.output<typeof ApplyCanvasResultSchema>

// get_assets (hub only)
export const GetAssetsParametersSchema = z.object({
  hashes: z
    .array(z.string().regex(MCP_HASH_PATTERN))
    .min(1)
    .describe(
      'Asset hashes returned from get_code (or other tools) to download/resolve exact bytes for rasterized images or SVGs before routing through your asset pipeline.'
    )
})

export const GetAssetsResultSchema = z.object({
  assets: z.array(AssetDescriptorSchema),
  missing: z.array(z.string().regex(MCP_HASH_PATTERN))
})

export type GetAssetsParametersInput = z.input<typeof GetAssetsParametersSchema>
export type GetAssetsResult = z.infer<typeof GetAssetsResultSchema>

export type AssetDescriptor = z.infer<typeof AssetDescriptorSchema>

export type ToolResultMap = {
  get_code: GetCodeResult
  get_design_system: GetDesignSystemResult
  apply_canvas: ApplyCanvasResult
  get_token_defs: GetTokenDefsResult
  get_screenshot: GetScreenshotResult
  get_structure: GetStructureResult
  get_assets: GetAssetsResult
}

export type ToolName = keyof ToolResultMap

export type ToolSchema<Name extends ToolName> = {
  name: Name
  description: string
  parameters: ZodType
  target: 'extension' | 'hub'
  outputSchema?: ZodType
  exposed?: boolean
}
