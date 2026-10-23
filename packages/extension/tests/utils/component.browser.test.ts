import { expect, it } from 'vitest'
import * as Vue from 'vue'
import { compileTemplate } from 'vue/compiler-sfc'

import { mergeAttributes, stringifyComponent } from '@/utils/component'

it('leaves a malformed opening tag unchanged without blocking raw component output', async () => {
  // Run the scanner in an isolated Worker so a non-advancing parser cannot hang the suite.
  const source = '<div / foo></div>'
  const url = URL.createObjectURL(
    new Blob([
      `postMessage((${mergeAttributes.toString()})(${JSON.stringify(source)}, {class: 'one'}))`
    ])
  )
  const worker = new Worker(url)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Attribute merge did not finish')), 10000)
      worker.onmessage = (event) => resolve(event.data)
      worker.onerror = (event) => reject(new Error(event.message))
    })
    expect(result).toBe(source)
  } finally {
    clearTimeout(timer)
    worker.terminate()
    URL.revokeObjectURL(url)
  }
}, 15000)

function mountVueMarkup(source: string) {
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
  app.mount(host)
  return {
    host,
    unmount() {
      app.unmount()
      host.remove()
    }
  }
}

it.each([false, true])('preserves video Boolean and ARIA tokens in Vue (%s)', (value) => {
  const mounted = mountVueMarkup(
    stringifyComponent(
      {
        name: 'video',
        props: {
          playsInline: value,
          disablePictureInPicture: value,
          disableRemotePlayback: value,
          'aria-hidden': value,
          'aria-expanded': value,
          'aria-checked': value
        },
        children: []
      },
      'vue'
    )
  )
  try {
    const video = mounted.host.firstElementChild as HTMLVideoElement
    expect(video.playsInline).toBe(value)
    expect(video.disablePictureInPicture).toBe(value)
    expect(video.disableRemotePlayback).toBe(value)
    for (const name of ['aria-hidden', 'aria-expanded', 'aria-checked']) {
      expect(video.getAttribute(name)).toBe(String(value))
    }
  } finally {
    mounted.unmount()
  }
})

it.each([
  ['button', 'popoverTarget', 'panel'],
  ['button', 'popoverTargetAction', 'show'],
  ['link', 'imageSrcSet', 'image.png 1x'],
  ['link', 'imageSizes', '100vw'],
  ['template', 'shadowRootMode', 'open']
] as const)('preserves the native %s attribute %s in Vue', (name, prop, value) => {
  const mounted = mountVueMarkup(
    stringifyComponent({ name, props: { [prop]: value }, children: [] }, 'vue')
  )
  try {
    expect(mounted.host.firstElementChild!.getAttribute(prop.toLowerCase())).toBe(value)
  } finally {
    mounted.unmount()
  }
})

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
    const mounted = mountVueMarkup(source)
    const { host } = mounted
    try {
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
      mounted.unmount()
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
