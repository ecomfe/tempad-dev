import type { ApplyCanvasParametersInput, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { ApplyCanvasResultSchema } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas, handleApplyCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas dictionary ownership', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    'creates and reuses a component property with stable key %s',
    async (key) => {
      const fixture = createFixture()
      const input: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup:
          '<div data-key="component" class="flex flex-col size-20"><div data-key="child" class="size-4"/></div>',
        bindings: {
          component: {
            figma: {
              component: {
                type: 'COMPONENT',
                properties: { [key]: { type: 'BOOLEAN', name: 'Enabled', defaultValue: true } }
              }
            }
          },
          child: { figma: { componentPropertyReferences: { visible: key } } }
        }
      }
      const result = await applyResolvedCanvas(input)
      const component = fixture.getNode(result.rootNodeId!) as unknown as ComponentNode
      const child = fixture.getNode(result.nodeIdsByKey.child!)
      const name = Object.keys(component.componentPropertyDefinitions)[0]!
      expect(component.componentPropertyDefinitions[name]).toEqual({
        type: 'BOOLEAN',
        defaultValue: true
      })
      expect(child.componentPropertyReferences).toEqual({ visible: name })
      expect(
        JSON.parse(component.getSharedPluginData('tempad_dev', 'component-property-keys'))
      ).toEqual({
        [key]: name
      })

      const update: CanvasResolvedApplyParameters = {
        ...input,
        mode: 'update',
        targetNodeId: component.id
      }
      await expect(applyResolvedCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
      update.bindings!.component!.figma!.component!.properties = {
        other: { type: 'BOOLEAN', name: 'Other', defaultValue: false }
      }
      await applyResolvedCanvas(update)
      expect(child.componentPropertyReferences).toEqual({ visible: name })
      expect(component.componentPropertyDefinitions[name]).toMatchObject({
        type: 'BOOLEAN',
        defaultValue: true
      })
    }
  )

  it('adds an inherited-name property to an existing component', async () => {
    const fixture = createFixture()
    const created = await applyResolvedCanvas({
      mode: 'create',
      markup: '<div data-key="component" class="size-20"/>',
      bindings: { component: { figma: { component: { type: 'COMPONENT' } } } }
    })
    const component = fixture.getNode(created.rootNodeId!) as unknown as ComponentNode
    const key = '__proto__'
    const update: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: component.id,
      bindings: {
        component: {
          figma: {
            component: {
              type: 'COMPONENT',
              properties: { [key]: { type: 'BOOLEAN', name: 'Enabled', defaultValue: true } }
            }
          }
        }
      }
    }
    await applyResolvedCanvas(update)
    expect(Object.values(component.componentPropertyDefinitions)).toEqual([
      { type: 'BOOLEAN', defaultValue: true }
    ])
    await expect(applyResolvedCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
  })

  it.each(['fill', 'effect'] as const)(
    'preserves a shader %s property without a default named __proto__',
    async (type) => {
      const fixture = createFixture()
      const key = '__proto__'
      fixture.importShaderById.mockResolvedValue({
        id: 'shader:prototype',
        type,
        imported: true,
        propertyDefinitions: { [key]: { name: 'Strength', type: 'NUMBER' } }
      })
      const shader = {
        type: 'SHADER' as const,
        id: 'shader:prototype',
        properties: { [key]: 0.75 }
      }
      const input: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup: '<div data-key="root" class="size-20"/>',
        bindings: {
          root: { figma: type === 'fill' ? { fills: [shader] } : { effects: [shader] } }
        }
      }
      const result = await applyResolvedCanvas(input)
      const root = fixture.getNode(result.rootNodeId!)
      const value = (type === 'fill' ? root.fills : root.effects) as Array<
        ShaderPaint | ShaderEffect
      >
      expect(value[0]?.properties).toEqual({ [key]: 0.75 })
      expect(Object.hasOwn(value[0]!.properties!, key)).toBe(true)
      await expect(
        applyResolvedCanvas({ ...input, mode: 'update', targetNodeId: root.id })
      ).resolves.toMatchObject({ mutationCount: 0 })
    }
  )

  it('preserves own prototype keys through public input, resources, reconciliation and wire results', async () => {
    const fixture = createFixture()
    const key = '__proto__'
    const input: ApplyCanvasParametersInput = {
      mode: 'create',
      markup:
        '<div data-key="__proto__" class="flex flex-col size-20 bg-(--surface) border"><div data-key="icon" class="size-4"/></div>',
      theme: { variables: { '--surface': { variableKey: key } } },
      native: {
        [key]: {
          figma: { name: 'Prototype root' },
          styles: { stroke: { styleKey: key } },
          variableModes: { [key]: key }
        },
        icon: { figma: { svg: { assetKey: key } } }
      },
      variableCollections: {
        [key]: {
          name: 'Prototype collection',
          modes: { [key]: { name: 'Prototype mode' }, alternate: { name: 'Alternate mode' } },
          variables: {
            [key]: {
              name: 'Prototype color',
              type: 'COLOR',
              values: { [key]: { r: 1, g: 0, b: 0 }, alternate: { r: 0, g: 1, b: 0 } }
            }
          }
        }
      },
      styles: {
        [key]: {
          type: 'PAINT',
          name: 'Prototype style',
          paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }]
        }
      },
      assets: {
        [key]: { type: 'SVG', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h2"/></svg>' }
      }
    }
    const result = await handleApplyCanvas(JSON.parse(JSON.stringify(input)))
    const root = fixture.getNode(result.nodeIdsByKey[key]!)
    const collection = [...fixture.variableCollections.values()].find(
      (value) => value.name === 'Prototype collection'
    )!
    const variable = [...fixture.variables.values()].find(
      (value) => value.name === 'Prototype color'
    )!
    const style = [...fixture.styles.values()].find((value) => value.name === 'Prototype style')!
    expect(root.name).toBe('Prototype root')
    expect((root.fills as SolidPaint[])[0]?.boundVariables?.color).toMatchObject({
      id: variable.id
    })
    expect((root.fills as SolidPaint[])[0]?.color).toEqual({ r: 1, g: 0, b: 0 })
    expect(root.strokeStyleId).toBe(style.id)
    expect(collection.modes.map((mode) => mode.name)).toEqual(['Prototype mode', 'Alternate mode'])
    expect(variable.valuesByMode[collection.defaultModeId]).toEqual({ r: 1, g: 0, b: 0 })
    expect(root.explicitVariableModes[collection.id]).toBe(collection.defaultModeId)
    expect(JSON.parse(collection.getSharedPluginData('tempad_dev', 'variable-mode-keys'))).toEqual({
      [key]: collection.defaultModeId,
      alternate: collection.modes[1]!.modeId
    })
    expect(figma.createNodeFromSvg).toHaveBeenCalledOnce()
    const wireResult = ApplyCanvasResultSchema.parse(JSON.parse(JSON.stringify(result)))
    expect(Object.hasOwn(wireResult.nodeIdsByKey, key)).toBe(true)
    expect(wireResult.nodeIdsByKey[key]).toBe(root.id)
    await expect(
      handleApplyCanvas({ ...input, mode: 'update', targetNodeId: root.id })
    ).resolves.toMatchObject({ mutationCount: 0 })
  })
})
