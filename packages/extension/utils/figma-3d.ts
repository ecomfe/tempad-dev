import type {
  CanvasReadTransform3d,
  CanvasTransformOrigin,
  CanvasScene3d
} from '@tempad-dev/shared'

// The beta API is not yet included in @figma/plugin-typings 1.142.0.
// Keep the compatibility surface local and check availability before writes.
export type Figma3dProperties = {
  transform3d?: CanvasReadTransform3d
  transformOrigin?: CanvasTransformOrigin
  scene3d?: CanvasScene3d | null
}

export function readFigma3d(node: SceneNode): Figma3dProperties {
  const native = node as SceneNode & Figma3dProperties
  return {
    ...('transform3d' in node ? { transform3d: native.transform3d } : {}),
    ...('transformOrigin' in node ? { transformOrigin: native.transformOrigin } : {}),
    ...('scene3d' in node ? { scene3d: native.scene3d } : {})
  }
}

export function hasFigma3d(properties: Figma3dProperties): boolean {
  return (
    (!!properties.transform3d && properties.transform3d.type !== 'NONE') || !!properties.scene3d
  )
}

export function hasCss3dTransform(style: Record<string, string>): boolean {
  return /\b(?:matrix3d|translateZ|translate3d|rotate[XYZ]|rotate3d|scaleZ|scale3d|perspective)\(/i.test(
    style.transform ?? ''
  )
}

export function applyFigma3dStyles(
  style: Record<string, string>,
  properties: Figma3dProperties,
  relativeTransform?: Transform | null
): Record<string, string> {
  const { transform3d, transformOrigin, scene3d } = properties
  const next = { ...style }
  if (
    transform3d &&
    (transform3d.type === 'NONE' || transform3d.visible === false) &&
    hasCss3dTransform(next)
  ) {
    // getCSSAsync retains disabled 3D settings. Restore only the native 2D axes;
    // layout positioning already owns the matrix's translation.
    delete next.transform
    delete next['transform-origin']
    delete next['backface-visibility']
    if (relativeTransform) {
      const [[a, c], [b, d]] = relativeTransform
      if (a !== 1 || b !== 0 || c !== 0 || d !== 1) {
        next.transform = `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`
        next['transform-origin'] = '0 0'
      }
    }
  }
  if (transform3d && transform3d.type !== 'NONE' && transform3d.visible !== false) {
    if (transform3d.type === 'FIXED_ORDER' && !hasCss3dTransform(next)) {
      const transform = `translateZ(${transform3d.translateZ}px) rotateX(${transform3d.rotateX}deg) rotateY(${transform3d.rotateY}deg) rotateZ(${transform3d.rotateZ}deg)`
      next.transform =
        next.transform && next.transform !== 'none' ? `${next.transform} ${transform}` : transform
    }
    next['backface-visibility'] = transform3d.backfaceVisible === false ? 'hidden' : 'visible'
    if (transformOrigin) {
      const axis = ({ value, unit }: CanvasTransformOrigin['x']) =>
        `${value}${unit === 'PERCENT' ? '%' : 'px'}`
      next['transform-origin'] = `${axis(transformOrigin.x)} ${axis(transformOrigin.y)}`
    }
  }
  if (scene3d) {
    next.perspective =
      scene3d.visible === false || scene3d.perspective < 0
        ? 'none'
        : `${Math.max(1, scene3d.perspective)}px`
    next['transform-style'] = scene3d.preserve3d ? 'preserve-3d' : 'flat'
    if (scene3d.preserve3d) {
      // Figma retains these values but ignores them on a Preserve 3D container.
      // In CSS they would flatten the scene instead.
      for (const property of [
        'opacity',
        'mix-blend-mode',
        'isolation',
        'box-shadow',
        'filter',
        'backdrop-filter',
        'overflow',
        'overflow-x',
        'overflow-y'
      ]) {
        delete next[property]
      }
    }
  }
  return next
}
