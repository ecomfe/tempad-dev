import type { RefinementCtx } from 'zod'

import { z } from 'zod'

import { MCP_HASH_PATTERN } from './constants'
import { DesignTaskParameterSchema, DesignTaskEpochSchema } from './design-task'

export const CanvasStableKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w./:-]+$/, 'Use a stable key containing letters, numbers, ., /, :, _, or -.')

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

const CANVAS_VARIABLE_SCOPES = [
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
] as const

const CanvasVariableScopeSchema = z.enum(CANVAS_VARIABLE_SCOPES, {
  error: `Invalid variable scope. Use one of: ${CANVAS_VARIABLE_SCOPES.join(', ')}.`
})

const CANVAS_VARIABLE_FILL_SCOPES = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL'] as const

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
      .superRefine((scopes, context) => {
        if (scopes.includes('ALL_SCOPES') && scopes.length > 1) {
          context.addIssue({
            code: 'custom',
            message: 'ALL_SCOPES cannot be combined with another variable scope.'
          })
        }
        if (
          scopes.includes('ALL_FILLS') &&
          CANVAS_VARIABLE_FILL_SCOPES.some((scope) => scopes.includes(scope))
        ) {
          context.addIssue({
            code: 'custom',
            message: 'ALL_FILLS cannot be combined with FRAME_FILL, SHAPE_FILL, or TEXT_FILL.'
          })
        }
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
    name: z.string().trim().min(1).max(256).optional(),
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

export const CanvasPageSnapshotSchema = z
  .object({
    id: z.string().min(1),
    pageKey: CanvasStableKeySchema.optional(),
    name: z.string().min(1),
    index: z.number().int().nonnegative(),
    active: z.boolean(),
    removed: z.literal(true).optional(),
    childCount: z.number().int().nonnegative(),
    selectionCount: z.number().int().nonnegative()
  })
  .strict()

export type CanvasPageSnapshot = z.output<typeof CanvasPageSnapshotSchema>

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
      'Native authored component or component set. Keep descriptionMarkdown and documentationLink inside this component object, beside type and properties.'
    ).optional(),
    slot: CanvasFigmaSlotSchema.describe(
      'Native slot frame. An empty object preserves an existing slot; new slots require property metadata.'
    ).optional(),
    svg: CanvasSvgPlacementSchema.describe(
      'Figma-native import of a declared SVG asset into a childless managed frame.'
    ).optional(),
    componentPropertyReferences: CanvasFigmaComponentPropertyReferencesSchema.describe(
      'Links a component sublayer field to a stable or exact component-property definition name. Null clears one link. A visible reference controls layer visibility; an Auto Layout flow child may trigger a layout-affecting warning.'
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
      !binding.componentProperties &&
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
  })

export type CanvasBinding = z.infer<typeof CanvasBindingSchema>

// Recent complete screen sections that crossed the former limit contained 102-129 elements.
// Keep a bounded margin above that observed range while the independent markup-length, depth,
// asset, and transport limits continue to cap request and transaction complexity.
export const MAX_CANVAS_NODES = 160
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
        'Strict desired state for the selected Figma-native capability. Use the matching progressive reference from the canvas-authoring skill for its exact shape.'
      )
      .optional()
  })
  .strict()

export const CanvasThemeSchema = z
  .object({
    variables: z
      .record(
        z.string().regex(/^--[a-zA-Z0-9_-]+$/),
        z.union([
          z.object({ ref: z.string().min(1) }).strict(),
          z.object({ variableKey: CanvasStableKeySchema }).strict()
        ])
      )
      .optional(),
    textStyles: z
      .record(
        z.string().regex(/^type-[a-zA-Z0-9_-]+$/),
        z.union([
          z.object({ ref: z.string().min(1) }).strict(),
          z.object({ styleKey: CanvasStableKeySchema }).strict()
        ])
      )
      .optional()
  })
  .strict()

export type CanvasTheme = z.output<typeof CanvasThemeSchema>

type CanvasApplyScope = {
  mode: 'activate' | 'create' | 'remove' | 'update'
  targetNodeId?: string
  markup?: string
  bindings?: unknown
  native?: unknown
  catalogId?: string
  theme?: unknown
  variableCollections?: unknown
  styles?: unknown
  assets?: unknown
  removeKeys?: string[]
  page?: CanvasPageProperties
  selection?: string[]
}

function validateCanvasApplyScope<Value extends CanvasApplyScope>(
  value: Value,
  context: RefinementCtx<Value>
): void {
  const issue = (message: string, path: keyof CanvasApplyScope): void =>
    context.addIssue({ code: 'custom', message, path: [path] })
  const resources = [
    'bindings',
    'native',
    'catalogId',
    'theme',
    'variableCollections',
    'styles',
    'assets',
    'removeKeys'
  ] as const
  const hasResources = resources.some((field) => value[field] !== undefined)
  const pageIdentity = value.page?.id !== undefined || value.page?.pageKey !== undefined
  if (value.theme !== undefined && value.markup === undefined) {
    issue('theme requires markup.', 'theme')
  }

  if (value.mode === 'create') {
    if (value.targetNodeId !== undefined) {
      issue('targetNodeId is not valid in create mode.', 'targetNodeId')
    }
    if (value.removeKeys !== undefined) {
      issue('removeKeys is only valid in update mode.', 'removeKeys')
    }
    if (value.selection !== undefined) {
      issue('selection is only valid in activate mode.', 'selection')
    }
    if (value.markup === undefined && value.page === undefined) {
      issue('Create mode requires markup or page.', 'markup')
    }
    if (value.markup === undefined) {
      if (hasResources) issue('Page-only create cannot include node or resource fields.', 'markup')
      if (!value.page?.pageKey) issue('Page-only create requires page.pageKey.', 'page')
      if (!value.page?.name) issue('Page-only create requires page.name.', 'page')
      if (value.page?.id) issue('Page-only create cannot include page.id.', 'page')
    }
    return
  }

  if (value.mode === 'update') {
    if (value.selection !== undefined) {
      issue('selection is only valid in activate mode.', 'selection')
    }
    if (value.markup !== undefined && value.targetNodeId === undefined) {
      issue('A markup update requires targetNodeId.', 'targetNodeId')
    }
    if (value.markup === undefined) {
      if (value.targetNodeId !== undefined) {
        if (value.page !== undefined) {
          issue('Native-only update cannot include page.', 'page')
        }
        if (value.removeKeys !== undefined) {
          issue('Native-only update cannot remove nodes.', 'removeKeys')
        }
        const bindings = value.native ?? value.bindings
        if (
          !bindings ||
          typeof bindings !== 'object' ||
          Array.isArray(bindings) ||
          Object.keys(bindings).length === 0
        ) {
          issue('Native-only update requires native node state.', 'native')
        }
        return
      }
      if (hasResources) issue('Page-only update cannot include node or resource fields.', 'markup')
      if (!value.page) issue('Update mode requires markup or page.', 'markup')
      if (value.page && !pageIdentity) {
        issue('Page-only update requires page.id or page.pageKey.', 'page')
      }
    }
    return
  }

  if (value.mode === 'remove') {
    if (value.markup !== undefined) issue('Remove mode cannot include markup.', 'markup')
    if (hasResources) issue('Remove mode cannot include node or resource fields.', 'markup')
    if (value.selection !== undefined) {
      issue('selection is only valid in activate mode.', 'selection')
    }
    if ((value.targetNodeId === undefined) === (value.page === undefined)) {
      issue('Remove mode requires exactly one of targetNodeId or page.', 'targetNodeId')
    }
    if (value.page) {
      if (!value.page.pageKey) issue('Page removal requires page.pageKey.', 'page')
      const pageFields = Object.keys(value.page)
      if (pageFields.some((field) => field !== 'id' && field !== 'pageKey')) {
        issue('Page removal accepts only page.id and page.pageKey.', 'page')
      }
    }
    return
  }

  if (value.targetNodeId !== undefined) {
    issue('targetNodeId is not valid in activate mode.', 'targetNodeId')
  }
  if (value.markup !== undefined) issue('Activate mode cannot include markup.', 'markup')
  if (hasResources) issue('Activate mode cannot include node or resource fields.', 'markup')
  if (!value.page || !pageIdentity) {
    issue('Activate mode requires page.id or page.pageKey.', 'page')
  }
  if (value.page) {
    const pageFields = Object.keys(value.page)
    if (pageFields.some((field) => field !== 'id' && field !== 'pageKey')) {
      issue('Activate mode accepts only page.id and page.pageKey.', 'page')
    }
  }
}

export const ApplyCanvasParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    mode: z.enum(['create', 'update', 'remove', 'activate']),
    targetNodeId: z.string().min(1).optional(),
    catalogId: z.string().min(1).optional(),
    theme: CanvasThemeSchema.describe(
      'Call-scoped aliases: CSS custom property names to catalog variable refs or local variableKey; type-* classes to catalog text-style refs or local styleKey. Catalog cssName/className aliases work automatically.'
    ).optional(),
    markup: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CANVAS_MARKUP_LENGTH)
      .describe(
        `Canvas HTML serialization of the desired managed Figma layer tree, with at most ${MAX_CANVAS_NODES} elements and ${MAX_CANVAS_DEPTH} levels. Conflicting classes are rejected, not resolved by order: replace default font sizes, colors, or line heights instead of appending overrides. When catalogId is supplied, use its component tags and bind its variable or style refs with data-var-<field>="vN" or data-style-<field>="sN"; use "none" to unlink.`
      )
      .optional(),
    native: z
      .record(CanvasStableKeySchema, CanvasNativeBindingSchema)
      .describe(
        'Desired native Figma state and bindings for selected capabilities. With markup, every native key must match a data-key in that supplied tree, even for existing nodes. Without markup, update may bind existing stable keys inside targetNodeId. For a mixed structural/native edit, include the bound nodes in the supplied structure or use a separate native-only update.'
      )
      .optional(),
    variableCollections: z
      .record(CanvasStableKeySchema, z.unknown())
      .describe(
        'Optional local variable collections, modes, and variables keyed by file-wide authoring identities. This does not require catalogId; use the canvas-authoring variables reference for the exact shape.'
      )
      .optional(),
    styles: z
      .record(CanvasStableKeySchema, z.unknown())
      .describe(
        'Optional local Paint, Text, Effect, and Grid styles keyed by file-wide authoring identities. This does not require catalogId; use the canvas-authoring local-styles reference for the exact shape.'
      )
      .optional(),
    assets: z
      .record(CanvasStableKeySchema, z.unknown())
      .describe(
        'Optional call-scoped inline SVG or content-addressed Hub assets referenced by native desired state.'
      )
      .optional(),
    removeKeys: CanvasRemoveKeysSchema.optional(),
    page: z
      .record(z.string(), z.unknown())
      .describe(
        'Optional local page identity and desired state. Use the canvas-authoring document-geometry reference for the exact shape.'
      )
      .optional(),
    selection: z
      .array(z.string().min(1))
      .max(100)
      .describe(
        'Exact scene-node ids to select after activate; an empty array clears selection and omission preserves it.'
      )
      .optional()
  })
  .strict()
  .superRefine(validateCanvasApplyScope)

export type ApplyCanvasParametersInput = z.input<typeof ApplyCanvasParametersSchema>
export type ApplyCanvasParameters = z.output<typeof ApplyCanvasParametersSchema>

export const CanvasResolvedApplyParametersSchema = z
  .object({
    theme: CanvasThemeSchema.optional(),
    mode: z
      .enum(['create', 'update', 'remove', 'activate'])
      .describe(
        'Create a page or managed root, update exact page or root state, remove an exact managed page or root, or activate an exact page.'
      ),
    targetNodeId: z
      .string()
      .min(1)
      .describe('Exact managed root identity for markup/native update or root removal.')
      .optional(),
    markup: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CANVAS_MARKUP_LENGTH)
      .describe(
        `One well-formed div/span tree using the documented Tailwind utility subset, with at most ${MAX_CANVAS_NODES} elements and ${MAX_CANVAS_DEPTH} levels.`
      )
      .optional(),
    bindings: CanvasBindingsSchema.describe(
      'Optional Figma component, variable, style, and typed native data keyed by a markup data-key or an existing stable key inside a markup-less update target.'
    ).optional(),
    variableCollections: CanvasVariableCollectionsSchema.describe(
      'Optional local base or extended variable collections, modes, variables, and inherited-value overrides keyed by file-wide stable authoring identities. Omission preserves resources; null explicitly removes an unconsumed managed resource. Verification warns when a new variable is unreferenced or a same-call binding silently overrides a literal fallback that matches none of its direct mode values.'
    ).optional(),
    styles: CanvasStylesSchema.describe(
      'Optional local Paint, Text, Effect, and Grid styles keyed by file-wide stable authoring identities. Omission preserves resources; null explicitly removes an unconsumed managed style. A newly created style without a reference in the same desired result produces a verification warning.'
    ).optional(),
    assets: CanvasAssetsSchema.describe(
      'Call-scoped inline SVG or content-addressed SVG/image assets referenced by native desired state.'
    ).optional(),
    removeKeys: CanvasRemoveKeysSchema.describe(
      'Optional stable keys that must be absent after a scoped update. Omitted live nodes remain untouched.'
    ).optional(),
    page: CanvasPagePropertiesSchema.describe(
      'Optional exact local page identity and desired state. In create mode, an unknown pageKey with a name creates a page; omission targets the page containing the result.'
    ).optional(),
    selection: z.array(z.string().min(1)).max(100).optional()
  })
  .strict()
  .superRefine(validateCanvasApplyScope)

export type CanvasResolvedApplyParameters = z.output<typeof CanvasResolvedApplyParametersSchema>

export const AuthoringRuntimeEvidenceSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    // Legacy global checkout lock; current Hubs report false. Evaluators compare observed fingerprints.
    locked: z.boolean(),
    valid: z.boolean(),
    issues: z.array(z.string()),
    hub: z
      .object({
        packageVersion: z.string().min(1),
        runtimeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        startedAt: z.string().min(1)
      })
      .strict(),
    extension: z
      .object({
        version: z.string().min(1),
        runtimeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        connectedAt: z.string().min(1)
      })
      .strict()
  })
  .strict()

export type AuthoringRuntimeEvidence = z.infer<typeof AuthoringRuntimeEvidenceSchema>

export const ApplyCanvasResultSchema = z
  .object({
    rootNodeId: z.string().min(1).optional(),
    rootRemoved: z.literal(true).optional(),
    nodeIdsByKey: z.record(z.string(), z.string().min(1)),
    createdNodeIds: z.array(z.string().min(1)),
    updatedNodeIds: z.array(z.string().min(1)),
    removedNodeIds: z.array(z.string().min(1)),
    page: CanvasPageSnapshotSchema.optional(),
    mutationCount: z.number().int().nonnegative(),
    runtime: AuthoringRuntimeEvidenceSchema.optional(),
    verification: z
      .object({
        status: z.enum(['passed', 'warning']),
        nodesChecked: z.number().int().nonnegative(),
        referencesChecked: z.number().int().nonnegative(),
        nativeFieldsChecked: z.number().int().nonnegative().optional(),
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
  .superRefine((value, context) => {
    if (value.rootNodeId === undefined && value.page === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'An apply_canvas result requires rootNodeId or page.'
      })
    }
    if (value.rootRemoved && value.rootNodeId === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'rootRemoved requires rootNodeId.',
        path: ['rootRemoved']
      })
    }
  })

export type ApplyCanvasResult = z.output<typeof ApplyCanvasResultSchema>
