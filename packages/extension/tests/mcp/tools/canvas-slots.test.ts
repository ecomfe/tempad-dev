import type { CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { expect, it, vi } from 'vitest'

import { applyResolvedCanvas } from '@/mcp/tools/canvas'

import { createFixture } from '../../fakes/figma'

async function adoptSlot(variant = false) {
  const fixture = createFixture()
  const component = figma.createComponent()
  component.name = 'State=Default'
  const alternate = variant ? figma.createComponent() : undefined
  if (alternate) alternate.name = 'State=Alternate'
  const owner = alternate
    ? figma.combineAsVariants([component, alternate], figma.currentPage)
    : component
  const slot = component.createSlot()
  const input: CanvasResolvedApplyParameters = {
    mode: 'update',
    targetNodeId: component.id,
    markup: `<div data-key="card" class="flex flex-col w-80 h-40"><div data-key="content" data-node-id="${slot.id}" class="w-20 h-10"/></div>`,
    bindings: {
      card: { figma: { component: { type: 'COMPONENT' } } },
      content: { figma: { slot: { property: { name: 'Slot' } } } }
    }
  }
  await applyResolvedCanvas(input)
  return { fixture, component, owner, slot, input }
}

it.each([false, true])(
  'retains an adopted slot property identity when its initial metadata already matches (variant=%s)',
  async (variant) => {
    const { owner, slot, input } = await adoptSlot(variant)
    const propertyName = Object.keys(owner.componentPropertyDefinitions).find(
      (name) => owner.componentPropertyDefinitions[name]?.type === 'SLOT'
    )!
    vi.mocked(owner.editComponentProperty).mockClear()
    await expect(applyResolvedCanvas(input)).resolves.toMatchObject({ mutationCount: 0 })
    expect(owner.editComponentProperty).not.toHaveBeenCalled()

    const rename: CanvasResolvedApplyParameters = {
      mode: 'update',
      targetNodeId: slot.id,
      bindings: { content: { figma: { slot: { property: { name: 'Content' } } } } }
    }
    await applyResolvedCanvas(rename)
    expect(owner.editComponentProperty).toHaveBeenCalledWith(propertyName, { name: 'Content' })
    const names = Object.keys(owner.componentPropertyDefinitions).filter(
      (name) => owner.componentPropertyDefinitions[name]?.type === 'SLOT'
    )
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^Content#/)
    await expect(applyResolvedCanvas(rename)).resolves.toMatchObject({ mutationCount: 0 })
  }
)

it.each([false, true])(
  'keeps slot identity separate from an equally named component property key (legacy=%s)',
  async (legacy) => {
    const { component, owner, slot, input } = await adoptSlot()
    const slotName = Object.keys(owner.componentPropertyDefinitions)[0]!
    if (legacy) {
      slot.setSharedPluginData('tempad_dev', 'slot-property-name', '')
      owner.setSharedPluginData(
        'tempad_dev',
        'component-property-keys',
        JSON.stringify({ content: slotName })
      )
    }
    const update: CanvasResolvedApplyParameters = {
      ...input,
      bindings: {
        card: {
          figma: {
            component: {
              type: 'COMPONENT',
              properties: { content: { type: 'TEXT', name: 'Label', defaultValue: 'Before' } }
            }
          }
        },
        content: { figma: { slot: { property: { name: 'Children' } } } }
      }
    }
    await applyResolvedCanvas(update)
    const entries = Object.entries(owner.componentPropertyDefinitions)
    expect(entries).toHaveLength(2)
    expect(entries.find(([name]) => name.startsWith('Children#'))?.[1].type).toBe('SLOT')
    expect(entries.find(([name]) => name.startsWith('Label#'))?.[1]).toMatchObject({
      type: 'TEXT',
      defaultValue: 'Before'
    })
    await expect(applyResolvedCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    const instance = component.createInstance()
    // Exercise the stable normal-property key, rather than relying on internal map contents.
    const result = await applyResolvedCanvas({
      mode: 'update',
      targetNodeId: instance.id,
      markup: '<div data-key="instance"/>',
      bindings: {
        instance: { component: { id: component.id }, componentProperties: { content: 'After' } }
      }
    })
    expect(result.rootNodeId).toBe(instance.id)
    expect(Object.values(instance.componentProperties)).toContainEqual(
      expect.objectContaining({ type: 'TEXT', value: 'After' })
    )
  }
)

it.each([false, true])(
  'protects a slot property owner outside the native update root (restored=%s)',
  async (restored) => {
    const { fixture, owner, slot } = await adoptSlot()
    const definitions = owner.componentPropertyDefinitions
    const before = structuredClone(definitions)
    if (restored) {
      fixture.triggerUndo.mockImplementationOnce(() => {
        for (const name of Object.keys(definitions)) delete definitions[name]
        Object.assign(definitions, before)
      })
    }
    Object.defineProperty(slot, 'guides', {
      configurable: true,
      get: () => [],
      set: () => {
        throw new Error('Guide setter failed')
      }
    })
    const error = await applyResolvedCanvas({
      mode: 'update',
      targetNodeId: slot.id,
      bindings: {
        content: {
          figma: {
            slot: { property: { name: 'Slot', description: 'Changed' } },
            guides: [{ axis: 'X', offset: 12 }]
          }
        }
      }
    }).catch((error: unknown) => error)
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    if (restored) {
      expect(definitions).toEqual(before)
      expect((error as Error).message).not.toContain('automatic rollback was not available')
    } else {
      expect((error as Error).message).toContain(`Rollback changed pre-existing node ${owner.id}`)
    }
  }
)

it('creates a slot without replacing an equally named normal component property key', async () => {
  const fixture = createFixture()
  const input: CanvasResolvedApplyParameters = {
    mode: 'create',
    markup:
      '<div data-key="card" class="flex flex-col w-80 h-40"><div data-key="content" class="w-20 h-10"/></div>',
    bindings: {
      card: {
        figma: {
          component: {
            type: 'COMPONENT',
            properties: { content: { type: 'TEXT', name: 'Label', defaultValue: 'Before' } }
          }
        }
      },
      content: { figma: { slot: { property: { name: 'Children' } } } }
    }
  }
  const created = await applyResolvedCanvas(input)
  const owner = fixture.getNode(created.rootNodeId!) as unknown as ComponentNode
  expect(
    Object.values(owner.componentPropertyDefinitions)
      .map(({ type }) => type)
      .sort()
  ).toEqual(['SLOT', 'TEXT'])
  await expect(
    applyResolvedCanvas({ ...input, mode: 'update', targetNodeId: owner.id })
  ).resolves.toMatchObject({
    mutationCount: 0
  })
})

it('rejects an ambiguous native slot name before any write', async () => {
  const fixture = createFixture()
  const owner = figma.createComponent()
  const slot = owner.createSlot()
  owner.createSlot()
  const before = structuredClone(owner.componentPropertyDefinitions)
  await expect(
    applyResolvedCanvas({
      mode: 'update',
      targetNodeId: owner.id,
      markup: `<div data-key="card" class="flex flex-col w-80 h-40"><div data-key="content" data-node-id="${slot.id}" class="w-20 h-10"/></div>`,
      bindings: {
        card: { figma: { component: { type: 'COMPONENT' } } },
        content: { figma: { slot: { property: { name: 'Slot' } } } }
      }
    })
  ).rejects.toMatchObject({
    code: 'CANVAS_APPLY_FAILED',
    cause: { code: 'INVALID_CANVAS_SPEC' },
    message: expect.stringContaining('ambiguous')
  })
  expect(owner.componentPropertyDefinitions).toEqual(before)
  expect(fixture.commitUndo).not.toHaveBeenCalled()
})

it('reports a new slot definition as a mutation of its existing owner', async () => {
  const { owner, slot, input } = await adoptSlot(true)
  const update: CanvasResolvedApplyParameters = {
    ...input,
    markup: `<div data-key="card" class="flex flex-col w-80 h-40"><div data-key="content" data-node-id="${slot.id}" class="w-20 h-10"/><div data-key="extra" class="w-20 h-10"/></div>`,
    bindings: {
      ...input.bindings,
      extra: { figma: { slot: { property: { name: 'Slot' } } } }
    }
  }
  const result = await applyResolvedCanvas(update)
  expect(result.updatedNodeIds).toContain(owner.id)
  await expect(applyResolvedCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
})

it('detects a retained slot definition on an owner outside the structural update root', async () => {
  const fixture = createFixture()
  const component = figma.createComponent()
  component.name = 'State=Default'
  const alternate = figma.createComponent()
  alternate.name = 'State=Alternate'
  const owner = figma.combineAsVariants([component, alternate], figma.currentPage)
  const input: CanvasResolvedApplyParameters = {
    mode: 'update',
    targetNodeId: component.id,
    markup: '<div data-key="card" class="flex flex-col w-80 h-40"/>',
    bindings: { card: { figma: { component: { type: 'COMPONENT' } } } }
  }
  await applyResolvedCanvas(input)
  const createSlot = vi.mocked(component.createSlot).getMockImplementation()!
  vi.mocked(component.createSlot).mockImplementationOnce(() => {
    const slot = createSlot()
    Object.defineProperty(slot, 'guides', {
      configurable: true,
      get: () => [],
      set: () => {
        throw new Error('Guide setter failed')
      }
    })
    return slot
  })
  const error = await applyResolvedCanvas({
    ...input,
    markup:
      '<div data-key="card" class="flex flex-col w-80 h-40"><div data-key="content" class="w-20 h-10"/></div>',
    bindings: {
      ...input.bindings,
      content: {
        figma: {
          slot: { property: { name: 'Children' } },
          guides: [{ axis: 'X', offset: 12 }]
        }
      }
    }
  }).catch((error: unknown) => error)
  expect(error).toMatchObject({
    code: 'CANVAS_APPLY_FAILED',
    message: expect.stringContaining(`Rollback changed pre-existing node ${owner.id}`)
  })
  expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  expect(component.children).toEqual([])
  expect(Object.values(owner.componentPropertyDefinitions)).toContainEqual(
    expect.objectContaining({ type: 'SLOT' })
  )
})
