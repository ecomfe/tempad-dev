import { expect, it } from 'vitest'

import { stringifyComponent } from '@/utils/component'

it('keeps native readonly, maxlength and SVG link attributes functional in Vue markup', () => {
  const host = document.createElement('div')
  document.body.append(host)
  try {
    host.innerHTML = stringifyComponent(
      {
        name: 'div',
        props: {},
        children: [
          { name: 'input', props: { readOnly: true, maxLength: '12' }, children: [] },
          {
            name: 'svg',
            props: {},
            children: [{ name: 'use', props: { xlinkHref: '#icon' }, children: [] }]
          }
        ]
      },
      'vue'
    )
    const input = host.querySelector('input')!
    expect(input.readOnly).toBe(true)
    expect(input.maxLength).toBe(12)
    expect(host.querySelector('use')!.href.baseVal).toBe('#icon')
  } finally {
    host.remove()
  }
})

it('keeps native SVG geometry and gradient attributes functional in Vue markup', () => {
  const host = document.createElement('div')
  document.body.append(host)
  try {
    host.innerHTML = stringifyComponent(
      {
        name: 'svg',
        props: {
          width: '320',
          height: '160',
          viewBox: '0 0 160 80',
          preserveAspectRatio: 'xMinYMin meet'
        },
        children: [
          {
            name: 'defs',
            props: {},
            children: [
              {
                name: 'linearGradient',
                props: {
                  id: 'gradient',
                  gradientUnits: 'userSpaceOnUse',
                  gradientTransform: 'translate(10 20)'
                },
                children: []
              }
            ]
          },
          {
            name: 'path',
            props: { d: 'M0 0h160v80H0Z', fill: 'url(#gradient)' },
            children: []
          }
        ]
      },
      'vue'
    )
    const svg = host.querySelector('svg')!
    const gradient = host.querySelector('linearGradient')!
    expect(svg.viewBox.baseVal.width).toBe(160)
    expect(svg.viewBox.baseVal.height).toBe(80)
    expect(svg.getCTM()?.a).toBe(2)
    expect(svg.getCTM()?.d).toBe(2)
    expect(gradient.gradientUnits.baseVal).toBe(SVGUnitTypes.SVG_UNIT_TYPE_USERSPACEONUSE)
    expect(gradient.gradientTransform.baseVal.getItem(0).matrix.e).toBe(10)
    expect(gradient.gradientTransform.baseVal.getItem(0).matrix.f).toBe(20)
  } finally {
    host.remove()
  }
})
