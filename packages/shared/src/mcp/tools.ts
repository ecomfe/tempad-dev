import type { ZodType } from 'zod'

import { z } from 'zod'

import { MCP_HASH_PATTERN } from './constants'

export const AssetDescriptorSchema = z.object({
  hash: z.string().regex(MCP_HASH_PATTERN),
  url: z.string().url(),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  themeable: z.boolean().optional()
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
      'Optional node id to screenshot; defaults to the current single selection. Useful when layout/overlap is uncertain (auto-layout none/inferred).'
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
      'Optional node id to outline; defaults to the current single selection. Useful when auto-layout hints are none/inferred or you need explicit geometry for refactors.'
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
  children?: OutlineNode[]
}
export type GetStructureResult = {
  roots: OutlineNode[]
}

// get_design_system
export const GetDesignSystemParametersSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        'Optional task or design-system query used to rank matching components and variables.'
      )
      .optional()
  })
  .strict()

export type GetDesignSystemParametersInput = z.input<typeof GetDesignSystemParametersSchema>

export type DesignSystemComponentProperty = {
  type: 'BOOLEAN' | 'INSTANCE_SWAP' | 'SLOT' | 'TEXT' | 'VARIANT'
  defaultValue: string | boolean
  options?: string[]
}

export type DesignSystemComponent = {
  id: string
  key: string
  name: string
  description?: string
  componentSetName?: string
  properties?: Record<string, DesignSystemComponentProperty>
  remote: boolean
}

export type DesignSystemVariable = {
  id: string
  key: string
  name: string
  collectionName: string
  description?: string
  remote: boolean
  resolvedType: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING'
  scopes?: string[]
}

export type GetDesignSystemResult = {
  page: {
    id: string
    name: string
  }
  components: DesignSystemComponent[]
  variables: DesignSystemVariable[]
  warnings?: string[]
}

// apply_canvas
export type CanvasDesignReference = { id: string; key?: string } | { id?: never; key: string }

const CanvasDesignReferenceSchema = z
  .object({
    id: z.string().min(1).describe('Live Figma node or variable id.').optional(),
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

const CanvasNodeTypeSchema = z.enum(['ELLIPSE', 'FRAME', 'INSTANCE', 'LINE', 'RECTANGLE', 'TEXT'])
type CanvasNodeType = z.infer<typeof CanvasNodeTypeSchema>

const CanvasColorSchema = z
  .string()
  .regex(/^#[\dA-Fa-f]{6}(?:[\dA-Fa-f]{2})?$/, 'Use #RRGGBB or #RRGGBBAA.')

const CanvasFiniteNumberSchema = z.number().finite()
const CanvasNonnegativeNumberSchema = z.number().nonnegative().finite()
const CanvasPositiveNumberSchema = z.number().positive().finite()

const CanvasPositionSchema = z
  .object({
    x: CanvasFiniteNumberSchema.optional(),
    y: CanvasFiniteNumberSchema.optional()
  })
  .strict()

const CanvasSizeSchema = z
  .object({
    width: CanvasPositiveNumberSchema.optional(),
    height: CanvasPositiveNumberSchema.optional(),
    horizontal: z.enum(['FILL', 'FIXED', 'HUG']).optional(),
    vertical: z.enum(['FILL', 'FIXED', 'HUG']).optional()
  })
  .strict()

const CanvasPaddingSchema = z
  .object({
    top: CanvasNonnegativeNumberSchema.optional(),
    right: CanvasNonnegativeNumberSchema.optional(),
    bottom: CanvasNonnegativeNumberSchema.optional(),
    left: CanvasNonnegativeNumberSchema.optional()
  })
  .strict()

const CanvasLayoutSchema = z
  .object({
    mode: z.enum(['HORIZONTAL', 'NONE', 'VERTICAL']).optional(),
    gap: CanvasFiniteNumberSchema.optional(),
    padding: z.union([CanvasNonnegativeNumberSchema, CanvasPaddingSchema]).optional(),
    primaryAlign: z.enum(['CENTER', 'MAX', 'MIN', 'SPACE_BETWEEN']).optional(),
    counterAlign: z.enum(['BASELINE', 'CENTER', 'MAX', 'MIN']).optional()
  })
  .strict()

const CanvasAppearanceSchema = z
  .object({
    fill: CanvasColorSchema.nullable().optional(),
    stroke: CanvasColorSchema.nullable().optional(),
    strokeWeight: CanvasNonnegativeNumberSchema.optional(),
    cornerRadius: CanvasNonnegativeNumberSchema.optional(),
    opacity: z.number().min(0).max(1).finite().optional()
  })
  .strict()

const CanvasTextSchema = z
  .object({
    characters: z.string().max(100_000).optional(),
    fontFamily: z.string().min(1).max(200).optional(),
    fontStyle: z.string().min(1).max(200).optional(),
    fontSize: CanvasPositiveNumberSchema.optional(),
    lineHeight: CanvasPositiveNumberSchema.optional(),
    letterSpacing: CanvasFiniteNumberSchema.optional(),
    alignHorizontal: z.enum(['CENTER', 'JUSTIFIED', 'LEFT', 'RIGHT']).optional(),
    alignVertical: z.enum(['BOTTOM', 'CENTER', 'TOP']).optional()
  })
  .strict()

export const CanvasVariableBindingsSchema = z
  .object({
    fill: CanvasDesignReferenceSchema.optional(),
    stroke: CanvasDesignReferenceSchema.optional(),
    width: CanvasDesignReferenceSchema.optional(),
    height: CanvasDesignReferenceSchema.optional(),
    gap: CanvasDesignReferenceSchema.optional(),
    paddingTop: CanvasDesignReferenceSchema.optional(),
    paddingRight: CanvasDesignReferenceSchema.optional(),
    paddingBottom: CanvasDesignReferenceSchema.optional(),
    paddingLeft: CanvasDesignReferenceSchema.optional(),
    cornerRadius: CanvasDesignReferenceSchema.optional(),
    opacity: CanvasDesignReferenceSchema.optional(),
    fontFamily: CanvasDesignReferenceSchema.optional(),
    fontStyle: CanvasDesignReferenceSchema.optional(),
    fontSize: CanvasDesignReferenceSchema.optional(),
    lineHeight: CanvasDesignReferenceSchema.optional(),
    letterSpacing: CanvasDesignReferenceSchema.optional()
  })
  .strict()

export type CanvasVariableBindings = z.infer<typeof CanvasVariableBindingsSchema>

const MAX_CANVAS_NODES = 100
const MAX_CANVAS_DEPTH = 12

export type CanvasNodeSpec = {
  key: string
  nodeId?: string
  type: CanvasNodeType
  name?: string
  visible?: boolean
  position?: z.infer<typeof CanvasPositionSchema>
  size?: z.infer<typeof CanvasSizeSchema>
  layout?: z.infer<typeof CanvasLayoutSchema>
  appearance?: z.infer<typeof CanvasAppearanceSchema>
  text?: z.infer<typeof CanvasTextSchema>
  component?: CanvasDesignReference
  componentProperties?: Record<string, string | boolean>
  variables?: CanvasVariableBindings
  children?: CanvasNodeSpec[]
}

export const CanvasNodeSpecSchema: z.ZodType<CanvasNodeSpec> = z.lazy(() =>
  z
    .object({
      key: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\w./:-]+$/, 'Use a stable key containing letters, numbers, ., /, :, _, or -.')
        .describe('Agent-stable identity reused across later apply_canvas results.'),
      nodeId: z
        .string()
        .min(1)
        .describe('Optional exact live node identity; update mode only.')
        .optional(),
      type: CanvasNodeTypeSchema.describe('Native Figma node type.'),
      name: z.string().max(500).optional(),
      visible: z.boolean().optional(),
      position: CanvasPositionSchema.optional(),
      size: CanvasSizeSchema.optional(),
      layout: CanvasLayoutSchema.optional(),
      appearance: CanvasAppearanceSchema.optional(),
      text: CanvasTextSchema.optional(),
      component: CanvasDesignReferenceSchema.describe(
        'Required design-system component reference for INSTANCE nodes.'
      ).optional(),
      componentProperties: z
        .record(z.string().min(1), z.union([z.string(), z.boolean()]))
        .describe('Exposed component property values for an INSTANCE.')
        .optional(),
      variables: CanvasVariableBindingsSchema.describe(
        'Figma variable bindings. A binding wins over a literal for the same field.'
      ).optional(),
      children: z
        .array(CanvasNodeSpecSchema)
        .max(MAX_CANVAS_NODES)
        .describe('Desired FRAME children in order; omitted live children are preserved.')
        .optional()
    })
    .strict()
)

export const ApplyCanvasParametersSchema = z
  .object({
    mode: z
      .enum(['create', 'update'])
      .describe('Create one new FRAME tree, or update one explicitly scoped live subtree.'),
    targetNodeId: z
      .string()
      .min(1)
      .describe('Required update-scope root node id; invalid in create mode.')
      .optional(),
    root: CanvasNodeSpecSchema.describe(
      'Declarative desired result. Omitted fields and live children are preserved.'
    )
  })
  .strict()
  .superRefine((value, context) => {
    function addIssue(message: string, path: Array<number | string>): void {
      context.addIssue({
        code: 'custom',
        message,
        path
      })
    }

    if (value.mode === 'create') {
      if (value.targetNodeId !== undefined) {
        addIssue('targetNodeId is only valid in update mode.', ['targetNodeId'])
      }
      if (value.root.type !== 'FRAME') {
        addIssue('Create mode requires a FRAME root.', ['root', 'type'])
      }
    } else {
      if (value.targetNodeId === undefined) {
        addIssue('Update mode requires targetNodeId.', ['targetNodeId'])
      }
      if (value.root.nodeId !== undefined && value.root.nodeId !== value.targetNodeId) {
        addIssue('The root nodeId must match targetNodeId in update mode.', ['root', 'nodeId'])
      }
    }

    const keys = new Set<string>()
    const nodeIds = new Set<string>()
    const stack: Array<{ depth: number; node: CanvasNodeSpec; path: Array<number | string> }> = [
      { depth: 1, node: value.root, path: ['root'] }
    ]
    let count = 0

    while (stack.length) {
      const { depth, node, path } = stack.pop()!
      count += 1
      if (count > MAX_CANVAS_NODES) {
        addIssue(`Canvas specs may contain at most ${MAX_CANVAS_NODES} nodes.`, ['root'])
        break
      }
      if (depth > MAX_CANVAS_DEPTH) {
        addIssue(`Canvas specs may be at most ${MAX_CANVAS_DEPTH} levels deep.`, path)
      }
      if (keys.has(node.key)) {
        addIssue(`Duplicate canvas key "${node.key}".`, [...path, 'key'])
      }
      keys.add(node.key)
      if (node.nodeId) {
        if (value.mode === 'create') {
          addIssue('Create mode cannot reference existing nodeIds.', [...path, 'nodeId'])
        }
        if (nodeIds.has(node.nodeId)) {
          addIssue(`Duplicate nodeId "${node.nodeId}".`, [...path, 'nodeId'])
        }
        nodeIds.add(node.nodeId)
      }
      if (node.type === 'INSTANCE' && !node.component) {
        addIssue('INSTANCE nodes require a component reference.', [...path, 'component'])
      }
      if (node.type !== 'INSTANCE' && node.component) {
        addIssue('Only INSTANCE nodes accept a component reference.', [...path, 'component'])
      }
      if (node.type !== 'INSTANCE' && node.componentProperties) {
        addIssue('Only INSTANCE nodes accept componentProperties.', [
          ...path,
          'componentProperties'
        ])
      }
      if (node.type !== 'TEXT' && node.text) {
        addIssue('Only TEXT nodes accept text properties.', [...path, 'text'])
      }
      if (node.type !== 'FRAME' && node.layout) {
        addIssue('Only FRAME nodes accept layout properties.', [...path, 'layout'])
      }
      if (node.type !== 'FRAME' && node.children !== undefined) {
        addIssue('Only FRAME nodes may declare children.', [...path, 'children'])
      }
      node.children?.forEach((child, index) => {
        stack.push({
          depth: depth + 1,
          node: child,
          path: [...path, 'children', index]
        })
      })
    }
  })

export type ApplyCanvasParametersInput = z.input<typeof ApplyCanvasParametersSchema>
export type ApplyCanvasParameters = z.output<typeof ApplyCanvasParametersSchema>

export type ApplyCanvasResult = {
  rootNodeId: string
  nodeIdsByKey: Record<string, string>
  createdNodeIds: string[]
  updatedNodeIds: string[]
  mutationCount: number
  warnings?: string[]
}

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
