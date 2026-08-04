import type { ApplyCanvasParameters } from '@tempad-dev/shared'

import { ApplyCanvasParametersSchema } from '@tempad-dev/shared'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { formatSchemaError } from '@/mcp/tools/canvas/errors'
import { parseCanvasMarkup } from '@/mcp/tools/canvas/markup'
import { resolveCanvasInput } from '@/mcp/tools/canvas/resolve'
import { registerDesignSystemCatalog } from '@/mcp/tools/design-system-catalog'

const AUTHORING_REFERENCE_DIR = new URL(
  '../../../../../agent-plugins/tempad-dev/skills/figma-canvas-authoring/references/',
  import.meta.url
)

function referenceExamples(file: string): unknown[] {
  const markdown = readFileSync(new URL(file, AUTHORING_REFERENCE_DIR), 'utf8')
  return [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!))
}

function catalog() {
  return registerDesignSystemCatalog([
    {
      kind: 'component',
      ref: 'c1',
      tag: 'Button',
      name: 'Button',
      reference: { id: 'component:button', key: 'component-key' },
      nativeSize: { width: 120, height: 40 },
      pageName: 'Components',
      variantCount: 1,
      properties: {
        label: { name: 'Label#1:2', type: 'text', default: 'Continue' },
        disabled: { name: 'Disabled', type: 'boolean', default: false },
        tone: {
          name: 'Tone',
          type: 'variant',
          default: 'Primary',
          options: ['Primary', 'Secondary']
        }
      },
      definition: {}
    },
    {
      kind: 'variable',
      ref: 'v1',
      name: 'Text size',
      reference: { id: 'variable:size', key: 'variable-key' },
      resolvedType: 'FLOAT',
      defaultValue: 16,
      definition: {}
    },
    {
      kind: 'collection',
      ref: 'k1',
      name: 'Theme',
      reference: { id: 'collection:theme', key: 'collection-key' },
      modes: [{ ref: 'm1_1', id: 'mode:dark', name: 'Dark' }],
      defaultModeId: 'mode:dark',
      definition: {}
    },
    {
      kind: 'mode',
      ref: 'm1_1',
      name: 'Dark',
      id: 'mode:dark',
      collectionRef: 'k1',
      definition: {}
    },
    {
      kind: 'style',
      ref: 's1',
      name: 'Body',
      reference: { id: 'style:body', key: 'style-key' },
      styleType: 'TEXT',
      definition: {}
    },
    {
      kind: 'shader',
      ref: 'h1',
      name: 'Aurora',
      id: 'shader:aurora',
      shaderType: 'effect',
      definition: {}
    }
  ])
}

describe('mcp/tools/canvas catalog resolution', () => {
  it.each(['canvas-html.md', 'variables.md', 'styles.md', 'component-authoring.md'])(
    'keeps every complete %s recipe executable',
    (file) => {
      const examples = referenceExamples(file)
      expect(examples.length).toBeGreaterThan(0)
      for (const example of examples) {
        const input = ApplyCanvasParametersSchema.parse(example)
        const resolved = resolveCanvasInput(input)
        expect(() => parseCanvasMarkup(resolved.input, resolved.catalog)).not.toThrow()
      }
    }
  )

  it('keeps the complete design-system reuse recipe executable', () => {
    const designSystem = catalog()
    const examples = referenceExamples('design-system-reuse.md')
    expect(examples.length).toBeGreaterThan(0)

    for (const example of examples) {
      const input = ApplyCanvasParametersSchema.parse({
        ...(example as Record<string, unknown>),
        catalogId: designSystem.id
      })
      const resolved = resolveCanvasInput(input)
      expect(() => parseCanvasMarkup(resolved.input, resolved.catalog)).not.toThrow()
    }
  })

  it('returns bounded validation feedback with actionable paths', () => {
    const parsed = z
      .object({ root: z.object({ items: z.array(z.string()) }) })
      .safeParse({ root: { items: [1, 2, 3, 4, 5] } })
    if (parsed.success) throw new Error('Expected validation to fail.')

    const message = formatSchemaError(parsed.error)

    expect(message).toContain('root.items[0]:')
    expect(message).toContain('root.items[3]:')
    expect(message).not.toContain('root.items[4]:')
    expect(message).toContain('1 more validation issue omitted.')
  })

  it('resolves short refs and compiles catalog tags into native instances', () => {
    const designSystem = catalog()
    const input = ApplyCanvasParametersSchema.parse({
      mode: 'create',
      catalogId: designSystem.id,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><Button data-key="save" data-ref="c1" data-var-opacity="v1" label="Save" disabled="false" tone="Primary" /><span data-key="copy" data-var-font-size="v1" data-style-text="s1" class="w-fit h-fit">Copy</span></div>',
      native: {
        root: { variableModes: { k1: 'm1_1' } }
      }
    })

    const resolved = resolveCanvasInput(input)
    expect(resolved.input.bindings).toMatchObject({
      root: { variableModes: { 'collection:theme': 'mode:dark' } }
    })

    const parsed = parseCanvasMarkup(resolved.input, resolved.catalog)
    if (parsed.root === null) throw new Error('Expected a canvas tree.')
    expect(parsed.root.children?.[0]).toMatchObject({
      key: 'save',
      type: 'INSTANCE',
      size: { width: 120, height: 40 },
      component: { id: 'component:button', key: 'component-key' },
      variables: { opacity: { id: 'variable:size', key: 'variable-key' } },
      componentProperties: {
        'Label#1:2': 'Save',
        Disabled: false,
        Tone: 'Primary'
      }
    })
    expect(parsed.root.children?.[1]).toMatchObject({
      key: 'copy',
      variables: { fontSize: { id: 'variable:size', key: 'variable-key' } },
      styles: { text: { id: 'style:body', key: 'style-key' } }
    })
  })

  it('accepts advertised native instance-swap ids and keys', () => {
    const designSystem = registerDesignSystemCatalog([
      {
        kind: 'component',
        ref: 'c1',
        tag: 'Button',
        name: 'Button',
        reference: { id: 'component:button', key: 'button-key' },
        nativeSize: { width: 120, height: 40 },
        pageName: 'Components',
        variantCount: 1,
        properties: {
          icon: {
            name: 'Icon',
            type: 'instance',
            default: 'component:icon-alt',
            options: ['icon-alt-key']
          }
        },
        definition: {}
      },
      {
        kind: 'component',
        ref: 'c2',
        tag: 'Icon',
        name: 'Icon',
        reference: { id: 'component:icon-default', key: 'icon-default-key' },
        nativeReferences: [{ id: 'component:icon-alt', key: 'icon-alt-key' }],
        nativeSize: { width: 24, height: 24 },
        pageName: 'Components',
        variantCount: 2,
        properties: {},
        definition: {}
      }
    ])
    const input = ApplyCanvasParametersSchema.parse({
      mode: 'create',
      catalogId: designSystem.id,
      markup:
        '<div data-key="root" class="flex flex-col w-[320px] h-[200px]"><Button data-key="by-id" data-ref="c1" icon="component:icon-alt" /><Button data-key="by-key" data-ref="c1" icon="icon-alt-key" /></div>'
    })
    const resolved = resolveCanvasInput(input)
    const parsed = parseCanvasMarkup(resolved.input, resolved.catalog)

    expect(parsed.root?.children?.map((child) => child.componentProperties)).toEqual([
      { Icon: 'component:icon-alt' },
      { Icon: 'component:icon-alt' }
    ])

    const inheritedProperty = resolveCanvasInput(
      ApplyCanvasParametersSchema.parse({
        mode: 'create',
        catalogId: designSystem.id,
        markup: '<Button data-key="bad" data-ref="c1" constructor="component:icon-alt" />'
      })
    )
    expect(() => parseCanvasMarkup(inheritedProperty.input, inheritedProperty.catalog)).toThrow(
      'Unsupported property "constructor"'
    )
  })

  it('resolves explicit advanced { ref } values before strict native validation', () => {
    const designSystem = catalog()
    const input = ApplyCanvasParametersSchema.parse({
      mode: 'create',
      catalogId: designSystem.id,
      markup: '<div data-key="root" class="w-[100px] h-[100px]"></div>',
      native: {
        root: {
          figma: {
            effects: [{ type: 'SHADER', id: { ref: 'h1' } }]
          }
        }
      }
    })

    const resolved = resolveCanvasInput(input)

    expect(resolved.input.bindings?.root?.figma?.effects).toEqual([
      { type: 'SHADER', id: 'shader:aurora' }
    ])
  })

  it('rejects deeply nested native data before recursive overflow', () => {
    const root: Record<string, unknown> = {}
    let cursor = root
    for (let depth = 0; depth < 1_000; depth += 1) {
      const next: Record<string, unknown> = {}
      cursor.child = next
      cursor = next
    }

    expect(() =>
      resolveCanvasInput({
        mode: 'create',
        markup: '<div data-key="root" class="w-[1px] h-[1px]"></div>',
        native: { root: { figma: root } }
      } as unknown as ApplyCanvasParameters)
    ).toThrow('at most 64 levels deep')
  })

  it('fails closed for expired, unknown, and wrong-kind refs', () => {
    expect(() =>
      resolveCanvasInput(
        ApplyCanvasParametersSchema.parse({
          mode: 'create',
          markup: '<div data-key="root" class="w-[1px] h-[1px]"></div>',
          native: { root: { variableModes: { k1: 'm1_1' } } }
        })
      )
    ).toThrow('requires catalogId')

    expect(() =>
      resolveCanvasInput(
        ApplyCanvasParametersSchema.parse({
          mode: 'create',
          catalogId: 'ds_expired',
          markup: '<div data-key="root" class="w-[1px] h-[1px]"></div>'
        })
      )
    ).toThrow('Unknown or expired')

    const designSystem = catalog()
    const wrongKind = resolveCanvasInput(
      ApplyCanvasParametersSchema.parse({
        mode: 'create',
        catalogId: designSystem.id,
        markup: '<div data-key="root" data-var-opacity="s1" class="w-[1px] h-[1px]"></div>'
      })
    )
    expect(() => parseCanvasMarkup(wrongKind.input, wrongKind.catalog)).toThrow(
      'is style, not variable'
    )

    const resolved = resolveCanvasInput(
      ApplyCanvasParametersSchema.parse({
        mode: 'create',
        catalogId: designSystem.id,
        markup: '<Unknown data-key="root" data-ref="c1" />'
      })
    )
    expect(() => parseCanvasMarkup(resolved.input, resolved.catalog)).toThrow(
      'Unknown component tag'
    )
  })
})
