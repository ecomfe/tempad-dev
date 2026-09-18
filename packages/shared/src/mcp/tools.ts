import type { ZodType } from 'zod'

import { z } from 'zod'

import {
  type ApplyCanvasResult,
  type CanvasFigmaGuide,
  type CanvasFigmaLayoutGrid,
  type CanvasPageSnapshot,
  CanvasStableKeySchema
} from './canvas'

export * from './canvas'

import { MCP_HASH_PATTERN, MCP_MAX_ASSET_BYTES } from './constants'
import {
  DesignTaskParameterSchema,
  DesignTaskEpochSchema,
  type DesignAnchor,
  type DesignTask,
  type FigmaSession
} from './design-task'

export const AssetDescriptorSchema = z.object({
  hash: z.string().regex(MCP_HASH_PATTERN),
  url: z.string().url(),
  localPath: z.string().min(1).optional(),
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
  taskId: DesignTaskParameterSchema,
  taskEpoch: DesignTaskEpochSchema,
  nodeId: z
    .string()
    .describe('Optional exact target node id; omit to use the current single selection.')
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
      'Inline token values instead of references for quick renders; default false returns token metadata plus bounded repeated-unbound-color diagnostics so you can reconcile the theming system. When true, values are resolved per-node (mode-aware) and literal diagnostics are omitted.'
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
export type GetCodeLiteralConsumer = {
  nodeId: string
  nodeName: string
  properties: string[]
}
export type GetCodeLiteralCluster = {
  kind: 'color'
  value: string
  occurrences: number
  consumers: GetCodeLiteralConsumer[]
  omittedConsumers?: number
}
export type GetCodeWarning = {
  type: 'auto-layout' | 'shell' | 'depth-cap' | 'literal-cluster'
  message: string
}
export type GetCodeResult = {
  code: string
  lang: 'vue' | 'jsx'
  assets?: AssetDescriptor[]
  tokens?: GetTokenDefsResult
  literalClusters?: GetCodeLiteralCluster[]
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
  taskId: DesignTaskParameterSchema,
  taskEpoch: DesignTaskEpochSchema,
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
  taskId: DesignTaskParameterSchema,
  taskEpoch: DesignTaskEpochSchema,
  nodeId: z
    .string()
    .describe('Optional exact node id to render; omit to use the current single selection.')
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
export const GetStructureParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    nodeId: z
      .string()
      .describe(
        'Optional node id to outline; defaults to the current single selection when no page identity is supplied.'
      )
      .optional(),
    pageId: z.string().min(1).describe('Exact local page id to outline.').optional(),
    pageKey: CanvasStableKeySchema.describe(
      'Exact stable key of a local page authored through apply_canvas.'
    ).optional(),
    options: z
      .object({
        depth: z
          .number()
          .int()
          .positive()
          .describe(
            'Positive integer; 1 is the shallowest traversal (root plus direct children). Omit for the full tree, subject to safety caps.'
          )
          .optional(),
        native: z
          .boolean()
          .describe(
            'Include compact native read-back for masks, IMAGE paint hashes, layout grids, and frame guides.'
          )
          .optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    const identities = [value.nodeId, value.pageId, value.pageKey].filter(
      (identity) => identity !== undefined
    )
    if (identities.length <= 1) return
    context.addIssue({
      code: 'custom',
      message: 'Use only one of nodeId, pageId, or pageKey.'
    })
  })

export type GetStructureParametersInput = z.input<typeof GetStructureParametersSchema>
export type OutlineNativeImageFill = {
  imageHash: string | null
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'
  visible: boolean
  opacity: number
}
export type OutlineNativeProperties = {
  mask?: 'ALPHA' | 'VECTOR' | 'LUMINANCE'
  imageFills?: OutlineNativeImageFill[]
  layoutGrids?: CanvasFigmaLayoutGrid[]
  guides?: CanvasFigmaGuide[]
}
export type OutlineNode = {
  id: string
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  authoringKey?: string
  native?: OutlineNativeProperties
  children?: OutlineNode[]
}
export type GetStructureResult = {
  roots: OutlineNode[]
  page?: CanvasPageSnapshot
  truncated?: true
}

// get_design_system
export const GetDesignSystemParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    scope: z.enum(['resources', 'fonts']).optional(),
    query: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('Case-insensitive font-family search.')
      .optional(),
    families: z
      .array(z.string().min(1))
      .min(1)
      .max(8)
      .describe('Exact font families to inspect for available native style names.')
      .optional(),
    catalogId: z
      .string()
      .min(1)
      .describe('Catalog returned by an earlier discovery call.')
      .optional(),
    cursor: z
      .number()
      .int()
      .nonnegative()
      .describe('Continuation cursor from the same catalog, or font query with the same filters.')
      .optional(),
    ref: z.string().min(1).describe('Exact resource ref from the same catalog.').optional()
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (
      message: string,
      path: 'catalogId' | 'cursor' | 'ref' | 'query' | 'families'
    ): void => context.addIssue({ code: 'custom', message, path: [path] })
    if (value.scope === 'fonts') {
      if (value.catalogId || value.ref)
        issue('Font queries cannot use resource catalog refs.', 'catalogId')
      if (value.query && value.families) issue('Use query or families, not both.', 'query')
      return
    }
    if (value.query || value.families) issue('Font filters require scope: fonts.', 'query')
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
    cssName: z.string().optional(),
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
    className: z.string().optional(),
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

export type DesignSystemCatalogProperty = z.infer<typeof DesignSystemCatalogPropertySchema>
export type DesignSystemCatalogComponent = z.infer<typeof DesignSystemCatalogComponentSchema>
export type DesignSystemCatalogVariable = z.infer<typeof DesignSystemCatalogVariableSchema>
export type DesignSystemCatalogCollection = z.infer<typeof DesignSystemCatalogCollectionSchema>
export type DesignSystemCatalogStyle = z.infer<typeof DesignSystemCatalogStyleSchema>
export type DesignSystemCatalogShader = z.infer<typeof DesignSystemCatalogShaderSchema>

export const DesignSystemResourcesResultSchema = z
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

export const DesignSystemFontsResultSchema = z
  .object({
    scope: z.literal('fonts'),
    families: z.array(z.string()).optional(),
    fonts: z.array(z.object({ family: z.string(), style: z.string() }).strict()).optional(),
    missingFamilies: z.array(z.string()).optional(),
    nextCursor: z.number().int().nonnegative().optional()
  })
  .strict()
  .refine(
    (value) => (value.families === undefined) !== (value.fonts === undefined),
    'A font result requires either families or fonts.'
  )

export const GetDesignSystemResultSchema = z.union([
  DesignSystemResourcesResultSchema,
  DesignSystemFontsResultSchema
])
export type DesignSystemResourcesResult = z.output<typeof DesignSystemResourcesResultSchema>
export type DesignSystemFontsResult = z.output<typeof DesignSystemFontsResultSchema>
export type GetDesignSystemResult = z.output<typeof GetDesignSystemResultSchema>

// get_assets (hub only)
export const GetAssetsParametersSchema = z.object({
  taskId: DesignTaskParameterSchema,
  taskEpoch: DesignTaskEpochSchema,
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

// upload_asset (hub only)
const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil((MCP_MAX_ASSET_BYTES * 4) / 3) + 256

export const UploadAssetParametersSchema = z
  .object({
    taskId: DesignTaskParameterSchema,
    taskEpoch: DesignTaskEpochSchema,
    dataUrl: z
      .string()
      .min(1)
      .max(MAX_IMAGE_DATA_URL_LENGTH)
      .regex(/^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/)
      .describe(
        'A PNG, JPEG, or GIF data URL from an image-generation tool. Compose the tool calls programmatically; never print or copy the encoded bytes into prose.'
      )
  })
  .strict()

export const UploadAssetResultSchema = z
  .object({
    assetHash: z.string().regex(MCP_HASH_PATTERN),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif']),
    size: z.number().int().positive()
  })
  .strict()

export type UploadAssetParametersInput = z.input<typeof UploadAssetParametersSchema>
export type UploadAssetResult = z.infer<typeof UploadAssetResultSchema>

export type ToolResultMap = {
  set_design_anchor: DesignAnchor
  get_design_task: DesignTask
  list_design_sessions: { sessions: FigmaSession[] }
  resume_design: DesignTask
  begin_design: DesignTask
  end_design: DesignTask
  get_code: GetCodeResult
  get_design_system: GetDesignSystemResult
  apply_canvas: ApplyCanvasResult
  get_token_defs: GetTokenDefsResult
  get_screenshot: GetScreenshotResult
  get_structure: GetStructureResult
  get_assets: GetAssetsResult
  upload_asset: UploadAssetResult
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
