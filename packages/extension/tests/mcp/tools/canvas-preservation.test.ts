import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleApplyCanvas } from '@/mcp/tools/canvas'
import { registerDesignSystemCatalog } from '@/mcp/tools/design-system-catalog'

import { createFixture } from '../../fakes/figma'

function componentCatalog() {
  return registerDesignSystemCatalog([
    {
      kind: 'component',
      ref: 'c1',
      tag: 'Button',
      name: 'Button',
      reference: { id: 'component:1' },
      nativeSize: { width: 100, height: 100 },
      pageName: 'Page 1',
      variantCount: 1,
      properties: {},
      definition: {}
    }
  ])
}

function markup(classes = '') {
  return `<div data-key="root" class="flex flex-col w-80 h-80"><Button data-key="button" data-ref="c1" class="${classes}"/></div>`
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('canvas native-state preservation', () => {
  it.each([
    { classes: '', horizontal: 'HUG', vertical: 'HUG' },
    { classes: 'w-20', horizontal: 'FIXED', vertical: 'HUG' },
    { classes: 'h-20', horizontal: 'HUG', vertical: 'FIXED' },
    { classes: 'grow', horizontal: 'HUG', vertical: 'FILL' }
  ])('preserves omitted instance axes when creating with "$classes"', async (expected) => {
    const fixture = createFixture()
    const component = (await figma.getNodeByIdAsync('component:1')) as ComponentNode
    const createInstance = component.createInstance.bind(component)
    vi.spyOn(component, 'createInstance').mockImplementation(() => {
      const instance = createInstance()
      instance.layoutSizingHorizontal = 'HUG'
      instance.layoutSizingVertical = 'HUG'
      return instance
    })
    const created = await handleApplyCanvas({
      mode: 'create',
      catalogId: componentCatalog().id,
      markup: markup(expected.classes)
    })
    expect(fixture.getNode(created.nodeIdsByKey.button!)).toMatchObject({
      layoutSizingHorizontal: expected.horizontal,
      layoutSizingVertical: expected.vertical
    })
    expect(created.verification.status).toBe('passed')
  })

  it.each(['existing', 'variant', 'native variant'] as const)(
    'preserves %s instance sizing modes when update markup omits them',
    async (source) => {
      const fixture = createFixture()
      const catalogId = componentCatalog().id
      const created = await handleApplyCanvas({ mode: 'create', catalogId, markup: markup() })
      const button = fixture.getNode(created.nodeIdsByKey.button!) as InstanceNode
      const preserveModes = () => {
        button.layoutSizingHorizontal = 'FILL'
        button.layoutSizingVertical = 'HUG'
      }
      if (source === 'existing') preserveModes()
      else {
        const setProperties = vi.mocked(button.setProperties).getMockImplementation()!
        vi.spyOn(button, 'setProperties').mockImplementation((properties) => {
          setProperties(properties)
          preserveModes()
        })
      }
      const updated = await handleApplyCanvas({
        mode: 'update',
        targetNodeId: created.rootNodeId!,
        ...(source === 'native variant' ? {} : { catalogId, markup: markup() }),
        ...(source !== 'existing'
          ? { native: { button: { componentProperties: { State: 'Hover' } } } }
          : {})
      })
      expect(button).toMatchObject({ layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' })
      expect(updated.verification.status).toBe('passed')
      if (source === 'existing') expect(updated.mutationCount).toBe(0)
    }
  )
})
