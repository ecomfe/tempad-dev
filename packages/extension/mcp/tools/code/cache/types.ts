import type { FigmaLookupReaders } from '@tempad-dev/shared'

import type { VectorColorModel } from '../assets/vector-semantics'

export type PaintArrayState =
  | { kind: 'missing' }
  | { kind: 'unsupported'; value: unknown }
  | { kind: 'array'; paints: readonly Paint[] }

type CachedAutoLayoutLike = {
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'GRID' | 'NONE'
  itemSpacing?: number
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
}

export type NodeSemanticSnapshot = {
  id: string
  type: SceneNode['type']
  paint: {
    fillsState: PaintArrayState
    strokesState: PaintArrayState
    fillStyleId: string | null
    strokeStyleId: string | null
    hasVisibleFill: boolean
    hasVisibleStroke: boolean
    hasRenderableStroke: boolean
    hasImageFill: boolean
    hasVisibleEffect: boolean
  }
  layout: {
    layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'GRID' | 'NONE' | null
    inferredAutoLayout: CachedAutoLayoutLike | null
    itemSpacing: number | null
    primaryAxisAlignItems: string | null
    counterAxisAlignItems: string | null
    paddingTop: number | null
    paddingRight: number | null
    paddingBottom: number | null
    paddingLeft: number | null
    layoutSizingHorizontal: 'FIXED' | 'HUG' | 'FILL' | null
    layoutSizingVertical: 'FIXED' | 'HUG' | 'FILL' | null
    layoutAlign: string | null
    layoutPositioning: 'AUTO' | 'ABSOLUTE' | null
    clipsContent: boolean
    isMask: boolean
  }
  geometry: {
    relativeTransform: Transform | null
    constraints: Constraints | null
  }
}

export type PaintStyleSummary = {
  id: string
  paints: readonly Paint[] | null
  visiblePaintCount: number
  singleVisiblePaint: Paint | null
  singleVisibleSolidPaint: SolidPaint | null
}

export type CacheMetrics = {
  nodeSemanticHits: number
  nodeSemanticMisses: number
  styleHits: number
  styleMisses: number
  paintStyleHits: number
  paintStyleMisses: number
  variableHits: number
  variableMisses: number
  vectorAnalysisHits: number
  vectorAnalysisMisses: number
  vectorExportCandidates: number
  vectorExportSkippedMissing: number
  vectorExportSkippedZeroBounds: number
  vectorExportNull: number
  vectorExportUploaded: number
  vectorExportThemeableInline: number
  vectorExportRawInline: number
}

export type GetCodeCacheContext = {
  readers: FigmaLookupReaders
  variables: Map<string, Variable | null>
  styles: Map<string, BaseStyle | null>
  paintStyles: Map<string, PaintStyleSummary | null>
  nodeSemantics: Map<string, NodeSemanticSnapshot>
  vectorAnalysis: Map<string, VectorColorModel>
  metrics?: CacheMetrics
}
