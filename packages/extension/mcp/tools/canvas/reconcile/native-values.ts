import type {
  CanvasFigmaShaderPropertyValue,
  CanvasFigmaPaint,
  CanvasFigmaEffect,
  CanvasFigmaLayoutGrid,
  CanvasVariableReference
} from '@tempad-dev/shared'

import type { ApplyState } from './state'

import { applyError } from '../errors'
import { resolvedVariable } from '../variables'
import { isRecord, isVariableBinding, nativeValueEqual, FIGMA_NATIVE_TOLERANCE } from './comparison'
import { resolveCanvasKey } from './nodes'

function nativeShaderValue(
  value: CanvasFigmaShaderPropertyValue,
  state: ApplyState
): ShaderPropertyValue {
  if (!isRecord(value)) return value
  if (isVariableBinding(value)) {
    return figma.variables.createVariableAlias(resolvedVariable(value.variable, state.variables))
  }
  if ('color' in value) {
    return {
      ...value,
      color: nativeShaderValue(value.color as CanvasFigmaShaderPropertyValue, state) as
        | RGB
        | RGBA
        | VariableAlias
    }
  }
  if ('stops' in value) {
    return {
      stops: (
        value.stops as Array<{
          position: number
          color: CanvasFigmaShaderPropertyValue
        }>
      ).map((stop) => ({
        position: stop.position,
        color: nativeShaderValue(stop.color, state) as RGB | RGBA | VariableAlias
      }))
    }
  }
  return value
}

function nativeShaderProperties(
  id: string,
  values: Record<string, CanvasFigmaShaderPropertyValue> | undefined,
  state: ApplyState
): Record<string, ShaderPropertyValue> | undefined {
  const shader = state.shaderCache.get(id)
  if (!shader) applyError(`Shader "${id}" was not preflighted.`)
  const properties = Object.fromEntries(
    Object.entries(shader.propertyDefinitions ?? {})
      .filter(([, definition]) => definition.defaultValue !== undefined)
      .map(([propertyId, definition]) => [propertyId, definition.defaultValue!])
  ) as Record<string, ShaderPropertyValue>
  for (const [propertyId, value] of Object.entries(values ?? {})) {
    properties[propertyId] = nativeShaderValue(value, state)
  }
  return Object.keys(properties).length ? properties : undefined
}

function paintDefaults(paint: { visible?: boolean; opacity?: number; blendMode?: BlendMode }) {
  return {
    visible: paint.visible ?? true,
    opacity: paint.opacity ?? 1,
    blendMode: paint.blendMode ?? 'NORMAL'
  } as const
}

function requiredMediaHash(hashes: ReadonlyMap<string, string>, key: string): string {
  const hash = hashes.get(key)
  if (!hash)
    applyError(
      'A preflighted media import is missing. This is an internal apply failure; do not retry the same payload.'
    )
  return hash
}

export function nativePaint(paint: CanvasFigmaPaint, state: ApplyState): Paint {
  switch (paint.type) {
    case 'SOLID': {
      const { variables, ...fields } = paint
      const value: SolidPaint = {
        ...fields,
        ...paintDefaults(fields)
      }
      return variables
        ? figma.variables.setBoundVariableForPaint(
            value,
            'color',
            resolvedVariable(variables.color, state.variables)
          )
        : value
    }
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      return {
        ...paint,
        gradientStops: paint.gradientStops.map(({ variables, ...stop }) => ({
          ...stop,
          ...(variables
            ? {
                boundVariables: {
                  color: figma.variables.createVariableAlias(
                    resolvedVariable(variables.color, state.variables)
                  )
                }
              }
            : {})
        })),
        ...paintDefaults(paint)
      }
    case 'IMAGE': {
      const { assetKey, imageUrl, ...fields } = paint
      return {
        ...fields,
        imageHash:
          assetKey !== undefined
            ? requiredMediaHash(state.media.imageHashes, `asset:${assetKey}`)
            : imageUrl === undefined
              ? (fields.imageHash ?? null)
              : requiredMediaHash(state.media.imageHashes, imageUrl),
        ...paintDefaults(paint)
      }
    }
    case 'VIDEO': {
      const { videoUrl, ...fields } = paint
      return {
        ...fields,
        videoHash:
          videoUrl === undefined
            ? (fields.videoHash ?? null)
            : requiredMediaHash(state.media.videoHashes, videoUrl),
        ...paintDefaults(paint)
      }
    }
    case 'PATTERN': {
      const { sourceCanvasKey, ...fields } = paint
      return {
        ...fields,
        sourceNodeId:
          sourceCanvasKey === undefined
            ? fields.sourceNodeId!
            : resolveCanvasKey(sourceCanvasKey, state).id,
        ...paintDefaults(paint)
      }
    }
    case 'SHADER': {
      const { properties: values, ...fields } = paint
      const properties = nativeShaderProperties(paint.id, values, state)
      return {
        ...fields,
        ...paintDefaults(paint),
        ...(properties ? { properties } : {})
      }
    }
  }
}

function bindEffectVariables(
  effect: Effect,
  bindings:
    | NonNullable<Extract<CanvasFigmaEffect, { type: 'DROP_SHADOW' }>['variables']>
    | undefined,
  state: ApplyState
): Effect {
  let bound = effect
  for (const [field, reference] of Object.entries(bindings ?? {})) {
    bound = figma.variables.setBoundVariableForEffect(
      bound,
      field as VariableBindableEffectField,
      resolvedVariable(reference, state.variables)
    )
  }
  return bound
}

export function nativeEffect(effect: CanvasFigmaEffect, state: ApplyState): Effect {
  switch (effect.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW': {
      const { variables, ...fields } = effect
      return bindEffectVariables(
        {
          ...fields,
          ...(variables?.spread !== undefined && fields.spread === undefined ? { spread: 0 } : {}),
          visible: fields.visible ?? true,
          blendMode: fields.blendMode ?? 'NORMAL'
        },
        variables,
        state
      )
    }
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR': {
      const { variables, ...fields } = effect
      return bindEffectVariables({ ...fields, visible: fields.visible ?? true }, variables, state)
    }
    case 'NOISE':
      return {
        ...effect,
        visible: effect.visible ?? true,
        blendMode: effect.blendMode ?? 'NORMAL'
      }
    case 'TEXTURE':
    case 'GLASS':
      return { ...effect, visible: effect.visible ?? true }
    case 'SHADER': {
      const properties = nativeShaderProperties(effect.id, effect.properties, state)
      return {
        type: 'SHADER',
        id: effect.id,
        visible: effect.visible ?? true,
        ...(properties ? { properties } : {})
      }
    }
  }
}

export function nativeLayoutGrid(grid: CanvasFigmaLayoutGrid, state: ApplyState): LayoutGrid {
  const { variables, ...fields } = grid
  let native: LayoutGrid =
    fields.pattern === 'GRID'
      ? fields
      : {
          ...fields,
          count: fields.count === 'AUTO' ? Infinity : fields.count
        }
  for (const [field, reference] of Object.entries(variables ?? {}) as Array<
    [VariableBindableLayoutGridField, CanvasVariableReference]
  >) {
    native = figma.variables.setBoundVariableForLayoutGrid(
      native,
      field,
      resolvedVariable(reference, state.variables)
    )
  }
  return native
}

function comparableLayoutGrid(grid: LayoutGrid, expected: LayoutGrid): Record<string, unknown> {
  const comparable = Object.fromEntries(
    Object.keys(expected)
      .filter((field) => !['boundVariables', 'color', 'visible'].includes(field))
      .map((field) => [field, grid[field as keyof LayoutGrid]])
  )
  return {
    ...comparable,
    visible: grid.visible ?? true,
    ...(expected.color === undefined ? {} : { color: grid.color }),
    boundVariables: grid.boundVariables ?? {}
  }
}

export function layoutGridsEqual(
  current: readonly LayoutGrid[],
  desired: readonly LayoutGrid[]
): boolean {
  return (
    current.length === desired.length &&
    current.every((grid, index) =>
      nativeValueEqual(
        comparableLayoutGrid(grid, desired[index]!),
        comparableLayoutGrid(desired[index]!, desired[index]!),
        FIGMA_NATIVE_TOLERANCE
      )
    )
  )
}

const IMAGE_FILTER_FIELDS = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows'
] as const satisfies ReadonlyArray<keyof ImageFilters>

export function comparablePaint(paint: Paint, expected: Paint): unknown {
  if (paint.type === 'IMAGE' && expected.type === 'IMAGE') {
    return {
      type: paint.type,
      imageHash: paint.imageHash,
      scaleMode: paint.scaleMode,
      ...paintDefaults(paint),
      filters: Object.fromEntries(
        IMAGE_FILTER_FIELDS.map((field) => [field, paint.filters?.[field] ?? 0])
      ),
      ...(paint.scaleMode === 'CROP' && expected.imageTransform !== undefined
        ? { imageTransform: paint.imageTransform }
        : {}),
      ...(paint.scaleMode === 'TILE' && expected.scalingFactor !== undefined
        ? { scalingFactor: paint.scalingFactor }
        : {}),
      ...(paint.scaleMode === 'CROP' ? {} : { rotation: paint.rotation ?? 0 })
    }
  }
  if (paint.type === 'VIDEO' && expected.type === 'VIDEO') {
    return {
      type: paint.type,
      videoHash: paint.videoHash,
      scaleMode: paint.scaleMode,
      ...paintDefaults(paint),
      filters: Object.fromEntries(
        IMAGE_FILTER_FIELDS.map((field) => [field, paint.filters?.[field] ?? 0])
      ),
      ...(paint.scaleMode === 'CROP' && expected.videoTransform !== undefined
        ? { videoTransform: paint.videoTransform }
        : {}),
      ...(paint.scaleMode === 'TILE' && expected.scalingFactor !== undefined
        ? { scalingFactor: paint.scalingFactor }
        : {}),
      ...(paint.scaleMode === 'CROP' ? {} : { rotation: paint.rotation ?? 0 })
    }
  }
  return {
    ...paint,
    ...paintDefaults(paint)
  }
}

export function paintStacksEqual(current: readonly Paint[], desired: readonly Paint[]): boolean {
  return (
    current.length === desired.length &&
    current.every((paint, index) => {
      const expected = desired[index]!
      return (
        paint.type === expected.type &&
        nativeValueEqual(
          comparablePaint(paint, expected),
          comparablePaint(expected, expected),
          FIGMA_NATIVE_TOLERANCE
        )
      )
    })
  )
}

function isShadowEffect(effect: Effect): effect is DropShadowEffect | InnerShadowEffect {
  return effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
}

function comparableShadow(
  effect: DropShadowEffect | InnerShadowEffect,
  expected: DropShadowEffect | InnerShadowEffect
): Effect {
  if (effect.type !== 'DROP_SHADOW' || expected.type !== 'DROP_SHADOW') {
    return { ...effect, spread: effect.spread ?? 0 }
  }
  if (expected.showShadowBehindNode !== undefined) {
    return {
      ...effect,
      spread: effect.spread ?? 0,
      showShadowBehindNode: effect.showShadowBehindNode ?? false
    }
  }
  const { showShadowBehindNode: _showShadowBehindNode, ...withoutBehindNode } = effect
  return { ...withoutBehindNode, spread: effect.spread ?? 0 }
}

function comparableEffect(effect: Effect, expected: Effect): unknown {
  return isShadowEffect(effect) && isShadowEffect(expected)
    ? comparableShadow(effect, expected)
    : effect
}

function effectEqual(current: Effect, desired: Effect): boolean {
  return (
    current.type === desired.type &&
    nativeValueEqual(
      comparableEffect(current, desired),
      comparableEffect(desired, desired),
      FIGMA_NATIVE_TOLERANCE
    )
  )
}

export function effectsEqual(current: readonly Effect[], desired: readonly Effect[]): boolean {
  return (
    current.length === desired.length &&
    current.every((effect, index) => effectEqual(effect, desired[index]!))
  )
}

function summarizeNativeValue(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return String(value)
  return serialized.length <= 400 ? serialized : `${serialized.slice(0, 397)}...`
}

export function describeEffectMismatch(
  current: readonly Effect[],
  desired: readonly Effect[]
): string {
  if (current.length !== desired.length) {
    return `expected ${desired.length} effect${desired.length === 1 ? '' : 's'}, found ${current.length}.`
  }
  const index = current.findIndex(
    (effect, effectIndex) => !effectEqual(effect, desired[effectIndex]!)
  )
  if (index < 0) return 'effect stack changed before verification completed.'
  const expected = desired[index]!
  const found = current[index]!
  return `effect ${index} does not match; expected ${summarizeNativeValue(comparableEffect(expected, expected))}, found ${summarizeNativeValue(comparableEffect(found, expected))}.`
}
