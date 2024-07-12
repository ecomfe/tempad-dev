import { QuirksNode } from '..'
import { toDecimalPlace } from '../../utils'
import type { QuirksNodeProps, StyleRecord } from '../types'

export function getStackCSS(props: QuirksNodeProps, parent: QuirksNode | null): StyleRecord {
  return {
    ...getFlexCSS(props),
    ...getFlexItemCSS(props, parent)
  }
}

function getFlexCSS(props: QuirksNodeProps): StyleRecord {
  const mode = props['stack-mode']
  if (!mode || mode === 'none') {
    return {}
  }

  const widthSizing = props[mode === 'column' ? 'stack-counter-sizing' : 'stack-primary-sizing']

  const result: StyleRecord = {
    display: widthSizing === 'hug' ? 'inline-flex' : 'flex'
  }

  if (mode === 'column') {
    result['flex-direction'] = 'column'
  }

  const wrap = props['stack-wrap']
  if (wrap === 'wrap') {
    result['flex-wrap'] = 'wrap'
  }

  const justify = props['stack-primary-align-items']
  if (justify && justify !== 'flex-start') {
    result['justify-content'] = justify
  }

  if (justify !== 'space-between') {
    const gapMain = toDecimalPlace(props['stack-spacing'] || 0)
    const gapAxis = toDecimalPlace(props['stack-counter-spacing'] || 0)
    if (gapMain !== 0 && gapAxis !== 0) {
      result.gap = gapMain === gapAxis ? `${gapMain}px` : `${gapMain}px ${gapAxis}px`
    }
  }

  const align = props['stack-counter-align-items']
  result['align-items'] = align || 'flex-start'
  if (wrap === 'wrap') {
    result['align-content'] = result['align-items']
  }

  const paddingTop = toDecimalPlace(props['stack-padding-top'] || 0)
  const paddingRight = toDecimalPlace(props['stack-padding-right'] || 0)
  const paddingBottom = toDecimalPlace(props['stack-padding-bottom'] || 0)
  const paddingLeft = toDecimalPlace(props['stack-padding-left'] || 0)

  if (paddingTop === paddingBottom && paddingTop === paddingRight && paddingTop === paddingLeft) {
    if (paddingTop !== 0) {
      result.padding = `${paddingTop}px`
    }
  } else if (paddingTop === paddingBottom && paddingRight === paddingLeft) {
    result.padding = `${paddingTop}px ${paddingRight}px`
  } else {
    result.padding = `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`
  }

  return result
}

function getFlexItemCSS(props: QuirksNodeProps, parent: QuirksNode | null): StyleRecord {
  const result: StyleRecord = {}

  const parentFlex = parent ? getFlexCSS(parent.props) : null
  const position = props['stack-positioning']

  if (parent?.props.size && (position === 'absolute' || !parentFlex)) {
    const hConstraint = props['horizontal-constraint']
    const vConstraint = props['vertical-constraint']

    const matrix = props['relative-transform']
    const { e: left, f: top } = matrix

    const [width, height] = props.size!
    const [parentWidth, parentHeight] = parent.props.size

    const right = parentWidth - width - left
    const bottom = parentHeight - height - top

    const [l, t, r, b] = [left, top, right, bottom].map((v) => toDecimalPlace(v))

    result.position = 'absolute'

    switch (hConstraint) {
      case 'min':
        result.left = `${l}px`
        break
      case 'max':
        result.right = `${r}px`
        break
      case 'center':
        result.left = `calc(50% - ${toDecimalPlace(width / 2 + (parentWidth / 2 - width / 2 - left))}px)`
        break
      case 'stretch':
        result.left = `${l}px`
        result.right = `${r}px`
        break
      case 'scale':
        result.left = `${toDecimalPlace((left / parentWidth) * 100)}%`
        result.right = `${toDecimalPlace((right / parentWidth) * 100)}%`
        break
    }

    switch (vConstraint) {
      case 'min':
        result.top = `${t}px`
        break
      case 'max':
        result.bottom = `${b}px`
        break
      case 'center':
        result.top = `calc(50% - ${toDecimalPlace(height / 2 + (parentHeight / 2 - height / 2 - top))}px)`
        break
      case 'stretch':
        result.top = `${t}px`
        result.bottom = `${b}px`
        break
      case 'scale':
        result.top = `${toDecimalPlace((t / parentHeight) * 100)}%`
        result.bottom = `${toDecimalPlace((b / parentHeight) * 100)}%`
        break
    }
  }

  if (!parentFlex) {
    return result
  }

  const grow = props['stack-child-primary-grow'] || 0
  const align = props['stack-child-align-self'] || 'auto'
  const direction = parentFlex['flex-direction'] || 'row'

  if (grow === 1) {
    result.flex = '1 0 0'
  } else if (align === 'auto') {
    result['flex-shrink'] = '0'
  }

  if (align === 'stretch') {
    result['align-self'] = 'stretch'
  }

  if (direction === 'row') {
    if (grow === 1) {
      result.width = ''
    }
    if (align === 'stretch') {
      result.height = ''
    }
  } else {
    if (grow === 1) {
      result.height = ''
    }
    if (align === 'stretch') {
      result.width = ''
    }
  }

  return result
}
