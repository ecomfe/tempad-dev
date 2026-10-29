import { raw } from '@tempad-dev/plugins'
import { describe, expect, it, vi } from 'vitest'

import type { DevComponent } from '@/types/plugin'
import type { CssValueSyntax } from '@/utils/css'

import { mapTokenValues } from '@/mcp/tools/code/tokens/markup'
import { rewriteTokenNamesInCode } from '@/mcp/tools/code/tokens/rewrite'
import { stripFallback } from '@/utils/css'

const source = 'var(--brand, #fff)'
const expected = 'var(--renamed)'
const transform = (value: string, syntax?: CssValueSyntax) =>
  rewriteTokenNamesInCode(stripFallback(value, syntax), new Map([['--brand', '--renamed']]))

describe('typed markup token values', () => {
  it('strips every Tailwind fallback without treating encoded spaces as CSS name characters', () => {
    const gradient = 'bg-[linear-gradient(var(--brand,_red),_var(--end,_blue))]'
    const component = {
      name: 'div',
      props: { className: [gradient, { [`hover:${gradient}`]: true }] },
      children: []
    }
    const expected = 'bg-[linear-gradient(var(--renamed),_var(--end))]'
    expect(mapTokenValues(component, transform).props.className).toEqual([
      expected,
      { [`hover:${expected}`]: true }
    ])
  })

  it('keeps Tailwind literal and custom-name boundaries distinct from ordinary CSS', () => {
    const className = String.raw`bg-[var(--brand,_red),_url(/var(--literal,_red)_image.svg)] content-['var(--literal,_red)'] [color:foo\_var(--brand,_red)]`
    const component = {
      name: 'div',
      props: {
        className,
        style: { color: '_var(--brand, red)', background: 'foo_var(--brand, red)' }
      },
      children: []
    }
    const observed: string[] = []
    const mapped = mapTokenValues(component, (value, syntax) => {
      observed.push(value)
      return stripFallback(value, syntax)
    })
    expect(mapped.props).toEqual({
      ...component.props,
      className: String.raw`bg-[var(--brand),_url(/var(--literal,_red)_image.svg)] content-['var(--literal,_red)'] [color:foo\_var(--brand,_red)]`
    })
    expect(observed.join('')).not.toContain('--literal')
  })

  it('rewrites styling in nested components without changing literal props, text, or input objects', () => {
    const component: DevComponent = {
      name: 'Card',
      props: {
        title: source,
        content: source,
        settings: { style: source, label: source },
        className: ['text-(--brand)', { 'bg-(--brand)': true, plain: false }],
        style: [{ color: source, opacity: 0.5 }, { background: source }]
      },
      children: [
        source,
        {
          name: 'span',
          props: { style: `color: ${source}`, 'data-hint-name': source },
          children: []
        }
      ]
    }
    const original = structuredClone(component)
    expect(mapTokenValues(component, transform)).toEqual({
      ...component,
      props: {
        ...component.props,
        className: ['text-(--renamed)', { 'bg-(--renamed)': true, plain: false }],
        style: [{ color: expected, opacity: 0.5 }, { background: expected }]
      },
      children: [
        source,
        {
          name: 'span',
          props: { style: `color: ${expected}`, 'data-hint-name': source },
          children: []
        }
      ]
    })
    expect(component).toEqual(original)
  })

  it('rewrites SVG presentation attributes while preserving labels and foreignObject text', () => {
    const component: DevComponent = {
      name: 'svg',
      props: { fill: source, 'aria-label': source },
      children: [
        { name: 'path', props: { stroke: source, strokeWidth: source }, children: [] },
        {
          name: 'foreignObject',
          props: {},
          children: [{ name: 'Card', props: { fill: source }, children: [source] }]
        }
      ]
    }
    const result = mapTokenValues(component, transform)
    expect(result.props).toEqual({ fill: expected, 'aria-label': source })
    expect(result.children[0]).toMatchObject({ props: { stroke: expected, strokeWidth: expected } })
    expect(result.children[1]).toEqual(component.children[1])
  })

  it('keeps explicit raw code processing and transforms injected styling separately', () => {
    const component = raw(`<Icon color="${source}" />`, {
      className: 'text-(--brand)',
      title: source
    })
    expect(mapTokenValues(component, transform)).toMatchObject({
      props: {
        content: `<Icon color="${expected}" />`,
        injectedProps: { className: 'text-(--renamed)', title: source }
      }
    })
  })

  it('preserves nonstring styling inputs', () => {
    const component = { name: 'Card', props: { class: null, style: 0 }, children: [] }
    expect(mapTokenValues(component, transform)).toEqual(component)
  })

  it('preserves quoted CSS literals while transforming adjacent references and outer fallbacks', () => {
    const component = {
      name: 'span',
      props: {
        class: `content-['var(--brand,_#fff)'] text-(--brand)`,
        style: {
          content: `"Use ${source}"`,
          fontFamily: `'${source}', var(--brand, "default")`,
          background: `url("/${source}.svg") ${source}`,
          mask: `url(/--brand.svg)`,
          filter: String.raw`u\72l(#--brand) ${source}`,
          border: `/* Use "${source} */ ${source}`,
          '--brand': source
        }
      },
      children: []
    }
    expect(mapTokenValues(component, transform).props).toEqual({
      class: `content-['var(--brand,_#fff)'] text-(--renamed)`,
      style: {
        content: `"Use ${source}"`,
        fontFamily: `'${source}', var(--renamed)`,
        background: `url("/${source}.svg") ${expected}`,
        mask: `url(/--brand.svg)`,
        filter: String.raw`u\72l(#--brand) ${expected}`,
        border: `/* Use "${source} */ ${expected}`,
        '--renamed': expected
      }
    })
  })

  it('keeps escaped quotes and marker-looking text intact without false token detection', () => {
    const visit = vi.fn((value: string) => value)
    const content = `'\\'${source}\\'\0'`
    const component = { name: 'span', props: { style: { content } }, children: [] }
    expect(mapTokenValues(component, visit).props).toEqual(component.props)
    expect(visit.mock.calls.flat().join('')).not.toContain('--brand')
  })

  it('consumes long names and repeated CSS escapes without changing literal data', () => {
    const className = `${'a'.repeat(30_000)} ${String.raw`\61`.repeat(10_000)}`
    const component = { name: 'div', props: { className }, children: [] }
    expect(mapTokenValues(component, transform).props.className).toBe(className)
  })
})
