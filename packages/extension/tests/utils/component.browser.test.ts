import { expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileTemplate } from 'vue/compiler-sfc'

import { stringifyComponent } from '@/utils/component'

it.each([false, true])(
  'keeps native HTML properties functional in compiled Vue markup (editable: %s)',
  (editable) => {
    const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw== 1x'
    const source = stringifyComponent(
      {
        name: 'div',
        props: { contentEditable: editable, spellCheck: editable, draggable: editable },
        children: [
          {
            name: 'input',
            props: {
              autoComplete: 'off',
              minLength: 4,
              maxLength: 12,
              readOnly: true,
              inputMode: 'email',
              enterKeyHint: 'send'
            },
            children: []
          },
          {
            name: 'table',
            props: {},
            children: [
              {
                name: 'tbody',
                props: {},
                children: [
                  {
                    name: 'tr',
                    props: {},
                    children: [{ name: 'td', props: { colSpan: 2, rowSpan: 3 }, children: [] }]
                  }
                ]
              }
            ]
          },
          {
            name: 'img',
            props: { srcSet: image, crossOrigin: 'anonymous', referrerPolicy: 'no-referrer' },
            children: []
          }
        ]
      },
      'vue'
    )
    const compiled = compileTemplate({
      source,
      filename: 'NativeAttributes.vue',
      id: 'native-attributes',
      compilerOptions: { mode: 'function' }
    })
    expect(compiled.errors).toEqual([])
    const app = Vue.createApp({ render: new Function('Vue', compiled.code)(Vue) })
    const host = document.createElement('div')
    document.body.append(host)
    try {
      app.mount(host)
      const wrapper = host.firstElementChild as HTMLElement
      expect(wrapper.contentEditable).toBe(String(editable))
      expect(wrapper.spellcheck).toBe(editable)
      expect(wrapper.draggable).toBe(editable)
      const input = host.querySelector('input')!
      expect(input.autocomplete).toBe('off')
      expect(input.minLength).toBe(4)
      expect(input.maxLength).toBe(12)
      expect(input.readOnly).toBe(true)
      expect(input.inputMode).toBe('email')
      expect(input.enterKeyHint).toBe('send')
      const cell = host.querySelector('td')!
      expect(cell.colSpan).toBe(2)
      expect(cell.rowSpan).toBe(3)
      const img = host.querySelector('img')!
      expect(img.srcset).toBe(image)
      expect(img.crossOrigin).toBe('anonymous')
      expect(img.referrerPolicy).toBe('no-referrer')
    } finally {
      app.unmount()
      host.remove()
    }
  }
)

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
