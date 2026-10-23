import type { CanvasBinding, CanvasPageProperties } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyResolvedCanvas as applyCanvas,
  handleApplyCanvas as applyCanvasFromTool
} from '@/mcp/tools/canvas'
import { CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME } from '@/mcp/tools/canvas/identity'
import {
  createApplyState,
  markMutation,
  recordCreatedNode
} from '@/mcp/tools/canvas/reconcile/state'
import { withUndoBoundary } from '@/mcp/tools/canvas/reconcile/undo'
import {
  preflightStyleDeclarations,
  prepareStyleResources,
  removeStyleResources
} from '@/mcp/tools/canvas/styles'
import {
  preflightVariableDeclarations,
  reconcileVariableCollections,
  removeVariableResources
} from '@/mcp/tools/canvas/variables'

import { createFixture } from '../../fakes/figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function markup(classes = '', fail = false): string {
  return `<div data-key="root" class="flex flex-col w-80 h-40 ${classes}"><div data-key="child" class="w-20 h-10 ${fail ? 'bg-[#112233]' : ''}"/></div>`
}

const changes: Array<{
  name: string
  classes?: string
  binding?: (node: FrameNode) => CanvasBinding
  read: (node: FrameNode) => unknown
}> = [
  { name: 'clipping', classes: 'overflow-hidden', read: (node) => node.clipsContent },
  { name: 'auto-layout gap', classes: 'gap-8', read: (node) => node.itemSpacing },
  { name: 'padding', classes: 'pl-8', read: (node) => node.paddingLeft },
  { name: 'size constraint', classes: 'min-w-40', read: (node) => node.minWidth },
  { name: 'rotation', classes: 'rotate-45', read: (node) => node.relativeTransform },
  { name: 'corner radius', classes: 'rounded-[12px]', read: (node) => node.cornerRadius },
  { name: 'stroke width', classes: 'border-[3px]', read: (node) => node.strokeWeight },
  {
    name: 'shear',
    binding: (node) => ({
      figma: {
        relativeTransform: [
          [1, 0.25, node.x],
          [0, 1, node.y]
        ]
      }
    }),
    read: (node) => node.relativeTransform
  }
]

describe('canvas rollback verification', () => {
  it('certifies a failure before the native apply callback starts as aborted', async () => {
    const fixture = createFixture()
    const apply = vi.fn()
    fixture.commitUndo.mockImplementationOnce(() => {
      throw new Error('Undo boundary unavailable')
    })
    await expect(withUndoBoundary(apply, createApplyState(null, new Set()))).rejects.toMatchObject({
      code: 'CANVAS_APPLY_ABORTED',
      message: 'Undo boundary unavailable'
    })
    expect(apply).not.toHaveBeenCalled()
  })

  it.each([undefined, 'INVALID_CANVAS_SPEC', 'CANVAS_APPLY_ABORTED'])(
    'does not certify a partial rollback as safe after %s',
    async (code) => {
      const fixture = createFixture()
      const label = figma.createText()
      const before = 12
      label.paragraphSpacing = before
      const beforeName = label.name
      fixture.triggerUndo.mockImplementationOnce(() => {
        label.name = beforeName
      })
      const state = createApplyState(label, new Set())
      const cause = Object.assign(new Error('Later native operation failed'), { code })
      const error = await withUndoBoundary(async () => {
        label.name = 'Changed by request'
        label.paragraphSpacing = before + 20
        markMutation(state, label)
        throw cause
      }, state).catch((error: unknown) => error)

      // Undo restored the name but left the paragraph metric changed.
      expect(label.paragraphSpacing).toBe(before + 20)
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED', cause })
      if (code === 'INVALID_CANVAS_SPEC') expect((error as Error).message).toContain(code)
      expect((error as Error).message).not.toContain('CANVAS_APPLY_ABORTED')
    }
  )

  it.each(['no-op', 'cancelled changes'] as const)(
    'does not consume a previous successful edit after counted %s',
    async (kind) => {
      const fixture = createFixture()
      const label = figma.createText()
      label.fontSize = 8
      const first = createApplyState(label, new Set())
      await withUndoBoundary(async () => {
        label.fontSize = 13
        markMutation(first, label)
      }, first)
      fixture.triggerUndo.mockImplementation(() => {
        label.fontSize = 8
      })
      const state = createApplyState(label, new Set())
      const cause = new Error('Verification failed after a counted setter')
      const error = await withUndoBoundary(async () => {
        if (kind === 'cancelled changes') {
          label.fontSize = 18
          markMutation(state, label)
        }
        label.fontSize = 13
        markMutation(state, label)
        throw cause
      }, state).catch((error: unknown) => error)

      expect(label.fontSize).toBe(13)
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
      expect(error).toMatchObject({
        code: 'CANVAS_APPLY_FAILED',
        cause,
        message: expect.stringContaining('Undo was skipped')
      })
    }
  )

  it('attempts Undo for paragraph-only changes and detects incomplete restoration', async () => {
    const fixture = createFixture()
    const label = figma.createText()
    label.paragraphSpacing = 12
    const state = createApplyState(label, new Set())
    const cause = new Error('Later operation failed')
    const error = await withUndoBoundary(async () => {
      label.paragraphSpacing = 24
      markMutation(state, label)
      throw cause
    }, state).catch((error: unknown) => error)

    expect(label.paragraphSpacing).toBe(24)
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED', cause })
    expect((error as Error).message).toContain(`Rollback changed pre-existing node ${label.id}`)
  })

  it.each(
    (['add', 'remove', 'value'] as const).flatMap((change) =>
      [false, true].map((restored) => ({ change, restored }))
    )
  )(
    'detects component property $change and verifies restoration=$restored',
    async ({ change, restored }) => {
      const fixture = createFixture()
      const component = figma.createComponent()
      const property = component.addComponentProperty('Label', 'TEXT', 'Before')
      const definitions = component.componentPropertyDefinitions
      const before = structuredClone(definitions)
      const state = createApplyState(component, new Set())
      const cause = new Error('Later operation failed')
      if (restored) {
        fixture.triggerUndo.mockImplementationOnce(() => {
          for (const name of Object.keys(definitions)) delete definitions[name]
          Object.assign(definitions, before)
        })
      }
      const error = await withUndoBoundary(async () => {
        if (change === 'add') component.addComponentProperty('Visible', 'BOOLEAN', true)
        else if (change === 'remove') component.deleteComponentProperty(property)
        else component.editComponentProperty(property, { defaultValue: 'After' })
        markMutation(state, component)
        throw cause
      }, state).catch((error: unknown) => error)

      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED', cause })
      if (restored) {
        expect(definitions).toEqual(before)
        expect((error as Error).message).not.toContain('automatic rollback was not available')
      } else {
        expect((error as Error).message).toContain(
          `Rollback changed pre-existing node ${component.id}`
        )
      }
    }
  )

  it.each([
    'fontSize',
    'lineHeight',
    'letterSpacing',
    'paragraphIndent',
    'paragraphSpacing',
    'boundVariables'
  ] as const)(
    'admits a retained rich-text %s change even when whole-node fields stay mixed',
    async (field) => {
      const fixture = createFixture()
      const label = figma.createText()
      label.characters = 'A\nB'
      let value: unknown =
        field === 'boundVariables' ? { fontSize: { type: 'VARIABLE_ALIAS', id: 'before' } } : 12
      const before = value
      vi.mocked(label.getStyledTextSegments).mockImplementation(
        () =>
          [{ start: 0, end: 3, characters: label.characters, [field]: value }] as ReturnType<
            TextNode['getStyledTextSegments']
          >
      )
      const state = createApplyState(label, new Set())
      fixture.triggerUndo.mockImplementationOnce(() => {
        value = before
      })
      const error = await withUndoBoundary(async () => {
        value =
          field === 'boundVariables' ? { fontSize: { type: 'VARIABLE_ALIAS', id: 'after' } } : 24
        markMutation(state, label)
        throw new Error('Later operation failed')
      }, state).catch((error: unknown) => error)

      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(value).toEqual(before)
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
      expect((error as Error).message).not.toContain('automatic rollback was not available')
    }
  )

  it.each(['collection', 'variable', 'style'] as const)(
    'admits retained newly created %s evidence and verifies its removal',
    async (kind) => {
      const fixture = createFixture()
      const state = createApplyState(null, new Set())
      const existingCollection = figma.variables.createVariableCollection('Existing')
      const beforeCollections = new Set(fixture.variableCollections.keys())
      const beforeVariables = new Set(fixture.variables.keys())
      const beforeStyles = new Set(fixture.styles.keys())
      fixture.triggerUndo.mockImplementationOnce(() => {
        for (const [id, style] of fixture.styles) if (!beforeStyles.has(id)) style.remove()
        for (const [id, variable] of fixture.variables)
          if (!beforeVariables.has(id)) variable.remove()
        for (const [id, collection] of fixture.variableCollections)
          if (!beforeCollections.has(id)) collection.remove()
      })
      const error = await withUndoBoundary(async () => {
        if (kind === 'style') {
          await prepareStyleResources(
            { paint: { type: 'PAINT', name: 'Paint' } },
            state.styles,
            state.mutations
          )
        } else if (kind === 'collection') {
          await reconcileVariableCollections(
            { tokens: { name: 'Tokens', modes: { base: { name: 'Base' } } } },
            state.variables,
            state.mutations
          )
        } else {
          const collection = existingCollection
          await reconcileVariableCollections(
            {
              tokens: {
                id: collection.id,
                variables: {
                  value: { name: 'Value', type: 'FLOAT', values: { [collection.defaultModeId]: 8 } }
                }
              }
            },
            state.variables,
            state.mutations
          )
        }
        throw new Error('Later operation failed')
      }, state).catch((error: unknown) => error)
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
      expect((error as Error).message).not.toContain('automatic rollback was not available')
      expect(new Set(fixture.variableCollections.keys())).toEqual(beforeCollections)
      expect(new Set(fixture.variables.keys())).toEqual(beforeVariables)
      expect(new Set(fixture.styles.keys())).toEqual(beforeStyles)
    }
  )

  it.each(['collection', 'variable', 'style'] as const)(
    'admits an existing %s change without any changed canvas node',
    async (kind) => {
      const fixture = createFixture()
      const state = createApplyState(null, new Set())
      const collection = figma.variables.createVariableCollection('Existing')
      const variable = figma.variables.createVariable('Value', collection, 'FLOAT')
      variable.setValueForMode(collection.defaultModeId, 8)
      const style = figma.createPaintStyle()
      if (kind === 'style')
        await preflightStyleDeclarations(
          { paint: { id: style.id, type: style.type as 'PAINT', name: 'Changed' } },
          state.styles
        )
      else
        await preflightVariableDeclarations(
          {
            tokens: {
              id: kind === 'variable' ? variable.variableCollectionId : collection.id,
              ...(kind === 'variable'
                ? { variables: { value: { id: variable.id, name: 'Changed' } } }
                : { name: 'Changed' })
            }
          },
          state.variables
        )
      const resource = kind === 'style' ? style : kind === 'variable' ? variable : collection
      const name = resource.name
      fixture.triggerUndo.mockImplementationOnce(() => {
        resource.name = name
      })
      const error = await withUndoBoundary(async () => {
        resource.name = 'Changed'
        state.mutations.count += 1
        throw new Error('Later operation failed')
      }, state).catch((error: unknown) => error)
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(resource.name).toBe(name)
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
      expect((error as Error).message).not.toContain('automatic rollback was not available')
    }
  )

  it('does not discard confirmed creation evidence when another touched node is uninspectable', async () => {
    const fixture = createFixture()
    const unknown = figma.createFrame()
    const state = createApplyState(null, new Set())
    let created: FrameNode | undefined
    const error = await withUndoBoundary(async () => {
      created = figma.createFrame()
      recordCreatedNode(created, state)
      markMutation(state, unknown)
      throw new Error('Later operation failed')
    }, state).catch((error: unknown) => error)
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    expect(created?.removed).toBe(true)
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
  })

  it.each(['collection', 'variable', 'style'] as const)(
    'admits a confirmed existing %s removal without trusting a missing lookup alone',
    async (kind) => {
      const fixture = createFixture()
      const state = createApplyState(null, new Set())
      const collection = figma.variables.createVariableCollection('Existing')
      const variable = figma.variables.createVariable('Value', collection, 'FLOAT')
      const style = figma.createPaintStyle()
      const resource = kind === 'style' ? style : kind === 'variable' ? variable : collection
      const remove = vi.mocked(resource.remove).getMockImplementation()!
      vi.spyOn(resource, 'remove').mockImplementation(() => {
        remove()
        Object.defineProperty(resource, 'id', {
          get() {
            throw new Error('Removed resource is unavailable')
          }
        })
      })
      if (kind === 'style') state.styles.selections = [{ key: 'style', style, spec: null }]
      else if (kind === 'variable')
        state.variables.selectedVariables = new Map([['value', variable]])
      else state.variables.selectedCollections = new Map([['tokens', collection]])
      const error = await withUndoBoundary(async () => {
        if (kind === 'style') {
          state.styles.removals.push({ key: 'style', style })
          await removeStyleResources(state.styles, state.mutations)
        } else {
          if (kind === 'variable') state.variables.variableRemovals.push(variable)
          else state.variables.collectionRemovals.push(collection)
          await removeVariableResources(state.variables, state.mutations)
        }
        throw new Error('Later operation failed')
      }, state).catch((error: unknown) => error)
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
      expect((error as Error).message).toContain('Rollback did not restore pre-existing resource')
    }
  )

  it.each(['no-op', 'net-zero', 'missing lookup'] as const)(
    'does not treat %s resource observations as a distinct Undo entry',
    async (kind) => {
      const fixture = createFixture()
      const state = createApplyState(null, new Set())
      const style = figma.createPaintStyle()
      state.styles.selections = [{ key: 'style', style, spec: { type: 'PAINT' } }]
      const before = style.name
      const error = await withUndoBoundary(async () => {
        if (kind === 'net-zero') {
          style.name = 'Changed'
          state.mutations.count += 1
        }
        style.name = before
        state.mutations.count += 1
        if (kind === 'missing lookup') {
          vi.mocked(figma.getStyleByIdAsync).mockResolvedValue(null)
          vi.mocked(figma.getStyleById).mockReturnValue(null)
        }
        throw new Error('Later operation failed')
      }, state).catch((error: unknown) => error)
      expect(fixture.triggerUndo).not.toHaveBeenCalled()
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
      expect((error as Error).message).toContain('Undo was skipped')
    }
  )

  it('does not use an unrelated user edit as evidence for this attempt', async () => {
    const fixture = createFixture()
    const root = figma.createFrame()
    const unrelated = figma.createFrame()
    const state = createApplyState(root, new Set())
    const error = await withUndoBoundary(async () => {
      unrelated.name = 'User edit'
      markMutation(state, root)
      throw new Error('No-op setter failed verification')
    }, state).catch((error: unknown) => error)

    expect(unrelated.name).toBe('User edit')
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
  })

  it.each(['node', 'page'] as const)(
    'does not use a removed newly created %s as evidence for an Undo entry',
    async (kind) => {
      const fixture = createFixture()
      const state = createApplyState(null, new Set())
      const error = await withUndoBoundary(async () => {
        if (kind === 'page') {
          const page = figma.createPage()
          state.createdPageIds.add(page.id)
          state.mutations.count += 1
          page.remove()
        } else {
          const node = figma.createFrame()
          recordCreatedNode(node, state)
          node.remove()
        }
        throw new Error('Creation was already cancelled')
      }, state).catch((error: unknown) => error)

      expect(fixture.triggerUndo).not.toHaveBeenCalled()
      expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
    }
  )

  it('does not attempt Undo when a touched node can no longer be inspected', async () => {
    const fixture = createFixture()
    const root = figma.createFrame()
    const state = createApplyState(root, new Set())
    const cause = new Error('Later operation failed')
    const error = await withUndoBoundary(async () => {
      markMutation(state, root)
      Object.defineProperty(root, 'name', {
        get: () => {
          throw new Error('Native state unavailable')
        }
      })
      throw cause
    }, state).catch((error: unknown) => error)

    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED', cause })
  })

  it('does not interpret an unresolved touched node as a confirmed removal', async () => {
    const fixture = createFixture()
    const root = figma.createFrame()
    const state = createApplyState(root, new Set())
    const error = await withUndoBoundary(async () => {
      markMutation(state, root)
      vi.mocked(figma.getNodeById).mockReturnValue(null)
      vi.mocked(figma.getNodeByIdAsync).mockResolvedValue(null)
      throw new Error('Native lookup unavailable')
    }, state).catch((error: unknown) => error)

    expect(root.removed).toBe(false)
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED' })
  })

  it('attempts Undo for a confirmed removal from this request', async () => {
    const fixture = createFixture()
    const root = figma.createFrame()
    const state = createApplyState(root, new Set())
    state.removalNodeIds.add(root.id)
    const error = await withUndoBoundary(async () => {
      root.remove()
      state.mutations.count += 1
      throw new Error('Later operation failed')
    }, state).catch((error: unknown) => error)

    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    expect(error).toMatchObject({
      code: 'CANVAS_APPLY_FAILED',
      message: expect.stringContaining('Rollback did not preserve pre-existing node')
    })
  })

  it('keeps an uncounted native failure uncertain after the write phase starts', async () => {
    const fixture = createFixture()
    const root = figma.createFrame()
    const state = createApplyState(root, new Set())
    const cause = new Error('Setter failed after changing native state')
    const error = await withUndoBoundary(async () => {
      root.name = 'Changed before mutation accounting'
      throw cause
    }, state).catch((error: unknown) => error)

    expect(root.name).toBe('Changed before mutation accounting')
    expect(fixture.triggerUndo).not.toHaveBeenCalled()
    expect(error).toMatchObject({ code: 'CANVAS_APPLY_FAILED', cause })
  })

  it.each([false, true])(
    'adds only the innermost context to a nested native failure (non-Error=%s)',
    async (nonError) => {
      const fixture = createFixture()
      const cause = new Error('native cause')
      const failure = Object.assign(new Error('paint unavailable.', { cause }), {
        code: TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC
      })
      vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
        throw nonError ? 'paint unavailable.' : failure
      })
      const error = await applyCanvas({
        mode: 'create',
        markup:
          '<div data-key="root" class="w-80 h-40"><div data-key="outer" class="absolute left-0 top-0 w-fit h-fit"><div data-key="inner" class="absolute left-0 top-0 w-fit h-fit"><div data-key="child" class="absolute left-0 top-0 w-20 h-10 bg-[#112233]"/></div></div></div>',
        bindings: { outer: { figma: { group: true } }, inner: { figma: { group: true } } }
      }).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toMatch(/^paint unavailable on "child" \(node:\d+\)\./)
      expect(error).toMatchObject({ code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED })
      if (!nonError) {
        expect((error as Error).cause).toBe(failure)
        expect((error as Error).message).toContain('INVALID_CANVAS_SPEC')
        expect(failure.cause).toBe(cause)
        expect(failure.code).toBe(TEMPAD_MCP_ERROR_CODES.INVALID_CANVAS_SPEC)
      }
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    }
  )

  it('joins a node failure and rollback failure without repeated punctuation', async () => {
    const fixture = createFixture()
    fixture.triggerUndo.mockImplementationOnce(() => {
      throw new Error('Undo unavailable.')
    })
    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable.')
    })
    const error = await applyCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-20 h-10 bg-[#112233]"/>'
    }).catch((error: unknown) => error)
    expect(error).toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      cause: expect.objectContaining({
        message: expect.stringMatching(/^paint unavailable on "root"/)
      })
    })
    expect((error as Error).message).toMatch(/on "root" \(node:\d+\); automatic rollback/)
    expect((error as Error).message).toContain('Undo unavailable. Read back the affected canvas')
    expect((error as Error).message).not.toContain('or use Figma Undo')
  })

  it.each(
    (['component', 'hyperlink', 'pattern'] as const).flatMap((reference) =>
      [false, true].map((corruptUndo) => ({ reference, corruptUndo }))
    )
  )(
    'snapshots an outside-scope $reference after preparation and detects corruption=$corruptUndo',
    async ({ reference, corruptUndo }) => {
      const fixture = createFixture()
      const otherPage = figma.createPage()
      const referenced = reference === 'component' ? figma.createComponent() : figma.createFrame()
      otherPage.appendChild(referenced)
      referenced.name = 'Before user edit'
      const bindings: Record<string, CanvasBinding> = {
        wait: { figma: { text: { fontName: { family: 'Roboto', style: 'Regular' } } } }
      }
      let referenceMarkup = ''
      if (reference === 'component') {
        bindings.reference = { component: { id: referenced.id } }
        referenceMarkup = '<div data-key="reference" class="w-20 h-10"/>'
      } else if (reference === 'hyperlink') {
        bindings.reference = {
          figma: { text: { hyperlink: { type: 'NODE', value: referenced.id } } }
        }
        referenceMarkup = '<span data-key="reference" class="w-fit h-fit">Link</span>'
      } else {
        bindings.root = {
          figma: {
            fills: [
              {
                type: 'PATTERN',
                sourceNodeId: referenced.id,
                tileType: 'RECTANGULAR',
                scalingFactor: 1,
                spacing: { x: 0, y: 0 },
                horizontalAlignment: 'CENTER'
              }
            ]
          }
        }
      }
      const requested = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      fixture.loadFontAsync.mockImplementation(async (font: FontName) => {
        if (font.family !== 'Roboto') return
        requested.resolve()
        await ready.promise
      })
      fixture.triggerUndo.mockImplementationOnce(() => {
        if (corruptUndo) referenced.name = 'Undo corruption'
      })
      vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
        throw new Error('paint unavailable')
      })
      const pending = applyCanvas({
        mode: 'create',
        markup: `<div data-key="root" class="flex flex-col w-80 h-40">${referenceMarkup}<span data-key="wait" class="w-fit h-fit">Wait</span><div data-key="failure" class="w-20 h-10 bg-[#112233]"/></div>`,
        bindings
      })
      void pending.catch(() => undefined)
      let error: unknown
      try {
        await Promise.race([requested.promise, pending])
        expect(fixture.commitUndo).not.toHaveBeenCalled()
        referenced.name = 'User edit before request writes'
      } finally {
        ready.resolve()
        error = await pending.catch((error: unknown) => error)
      }
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('paint unavailable')
      if (corruptUndo) {
        expect((error as Error).message).toContain(
          `Rollback changed pre-existing node ${referenced.id}`
        )
      } else {
        expect(referenced.name).toBe('User edit before request writes')
        expect((error as Error).message).not.toContain('automatic rollback was not available')
      }
    }
  )

  it.each(['background', 'guides', 'mode', 'ownership', 'order'] as const)(
    'reports retained page %s after incomplete Undo',
    async (field) => {
      const fixture = createFixture()
      figma.createPage()
      const collection = figma.variables.createVariableCollection('Theme')
      const alternate = collection.addMode('Alternate')
      const changes: Record<typeof field, Partial<CanvasPageProperties>> = {
        background: { background: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
        guides: { guides: [{ axis: 'X', offset: 12 }] },
        mode: { variableModes: { [collection.id]: alternate } },
        ownership: { pageKey: 'claimed-page' },
        order: { index: 1 }
      }
      vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
        throw new Error('paint unavailable')
      })

      await expect(
        applyCanvas({
          mode: 'create',
          page: { id: fixture.page.id, ...changes[field] },
          markup: '<div data-key="root" class="w-20 h-10 bg-[#112233]"/>'
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        message: expect.stringContaining(`Rollback changed pre-existing node ${fixture.page.id}`),
        cause: expect.objectContaining({ message: expect.stringContaining('paint unavailable') })
      })
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
      expect(fixture.page.children).toHaveLength(0)
    }
  )

  it('checks page-only updates after a later page setter fails', async () => {
    const fixture = createFixture()
    Object.defineProperty(fixture.page, 'guides', {
      get: () => [],
      set: () => {
        throw new Error('guides unavailable')
      }
    })

    await expect(
      applyCanvas({
        mode: 'update',
        page: { id: fixture.page.id, name: 'Changed', guides: [{ axis: 'X', offset: 12 }] }
      })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining(`Rollback changed pre-existing node ${fixture.page.id}`),
      cause: expect.objectContaining({ message: expect.stringContaining('guides unavailable') })
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('checks page state when native removal verification fails', async () => {
    const fixture = createFixture()
    const page = figma.createPage()
    page.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME, 'owned-page')
    vi.spyOn(page, 'remove').mockImplementationOnce(() => {
      page.name = 'Incomplete removal'
    })

    await expect(
      applyCanvas({ mode: 'remove', page: { id: page.id, pageKey: 'owned-page' } })
    ).rejects.toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
      message: expect.stringContaining(`Rollback changed pre-existing node ${page.id}`),
      cause: expect.objectContaining({ message: expect.stringContaining('is still present') })
    })
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('preserves unrelated edits made while page fonts preload before the Undo boundary', async () => {
    const fixture = createFixture()
    const unrelated = figma.createFrame()
    unrelated.name = 'Before user edit'
    const collection = figma.variables.createVariableCollection('Typography')
    const alternate = collection.addMode('Alternate')
    const family = figma.variables.createVariable('Family', collection, 'STRING')
    family.setValueForMode(collection.defaultModeId, 'Inter')
    family.setValueForMode(alternate, 'Roboto')
    const label = figma.createText()
    label.characters = 'Label'
    label.setBoundVariable('fontFamily', family)
    fixture.page.setExplicitVariableModeForCollection(collection, collection.defaultModeId)
    fixture.listAvailableFontsAsync.mockResolvedValue(
      ['Inter', 'Roboto'].map((family) => ({ fontName: { family, style: 'Regular' } }))
    )
    const requested = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    fixture.loadFontAsync.mockImplementation(async (font: FontName) => {
      if (font.family !== 'Roboto') return
      requested.resolve()
      await ready.promise
    })
    Object.defineProperty(fixture.page, 'guides', {
      get: () => [],
      set: () => {
        throw new Error('guides unavailable')
      }
    })
    const beforeName = fixture.page.name
    fixture.triggerUndo.mockImplementationOnce(() => {
      fixture.page.name = beforeName
    })
    const pending = applyCanvasFromTool({
      mode: 'update',
      page: {
        id: fixture.page.id,
        name: 'Changed by request',
        guides: [{ axis: 'X', offset: 12 }],
        variableModes: { [collection.id]: alternate }
      }
    })
    void pending.catch(() => undefined)
    let error: unknown
    try {
      await Promise.race([requested.promise, pending])
      expect(fixture.commitUndo).not.toHaveBeenCalled()
      expect(fixture.page.name).toBe(beforeName)
      unrelated.name = 'User edit before request writes'
    } finally {
      ready.resolve()
      error = await pending.catch((error: unknown) => error)
    }
    expect(unrelated.name).toBe('User edit before request writes')
    expect(fixture.page.name).toBe(beforeName)
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    expect(error).toMatchObject({
      code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED
    })
    expect((error as Error).message).toBe('guides unavailable')
  })

  it('keeps the original error when Undo restores the existing page', async () => {
    const fixture = createFixture()
    const backgrounds = fixture.page.backgrounds
    fixture.triggerUndo.mockImplementationOnce(() => {
      fixture.page.backgrounds = backgrounds
      fixture.page.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_PAGE_KEY_NAME, '')
    })
    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })

    await expect(
      applyCanvas({
        mode: 'create',
        page: {
          id: fixture.page.id,
          pageKey: 'claimed-page',
          background: { r: 0.1, g: 0.2, b: 0.3, a: 1 }
        },
        markup: '<div data-key="root" class="w-20 h-10 bg-[#112233]"/>'
      })
    ).rejects.toThrow(/^paint unavailable on "root"/)
    expect(fixture.page.children).toHaveLength(0)
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('does not protect a newly created page from failed-apply cleanup', async () => {
    const fixture = createFixture()
    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })

    await expect(
      applyCanvas({
        mode: 'create',
        page: { pageKey: 'new-page', name: 'New page' },
        markup: '<div data-key="root" class="w-20 h-10 bg-[#112233]"/>'
      })
    ).rejects.toThrow(/^paint unavailable on "root"/)
    expect(figma.root.children.map((page) => page.id)).toEqual([fixture.page.id])
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })

  it('does not require grid-child getters when protecting a free-canvas root', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({ mode: 'create', markup: markup() })
    const root = fixture.getNode(created.rootNodeId!) as FrameNode
    const gridPosition = vi.fn(() => {
      throw new Error('Grid child coordinates are unavailable in this context')
    })
    Object.defineProperty(root, 'gridRowAnchorIndex', { get: gridPosition })

    await expect(
      applyCanvas({ mode: 'update', targetNodeId: root.id, markup: markup('opacity-50') })
    ).resolves.toMatchObject({ updatedNodeIds: [root.id] })
    expect(root.opacity).toBe(0.5)
    expect(gridPosition).not.toHaveBeenCalled()
  })

  it.each(changes)(
    'reports a retained $name change after incomplete Undo',
    async ({ classes, binding, read }) => {
      const fixture = createFixture()
      const created = await applyCanvas({ mode: 'create', markup: markup() })
      const root = fixture.getNode(created.rootNodeId!) as FrameNode
      const before = structuredClone(read(root))
      const geometry = { width: root.width, height: root.height, x: root.x, y: root.y }
      fixture.triggerUndo.mockImplementationOnce(() => {
        // Explicitly model incomplete Undo without changing the shared fake's host contract.
        expect(read(root)).not.toEqual(before)
        expect(root).toMatchObject(geometry)
      })
      vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
        throw new Error('paint unavailable')
      })

      await expect(
        applyCanvas({
          mode: 'update',
          targetNodeId: root.id,
          markup: markup(classes, true),
          ...(binding ? { bindings: { root: binding(root) } } : {})
        })
      ).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        message: expect.stringContaining(`Rollback changed pre-existing node ${root.id}`),
        cause: expect.objectContaining({ message: expect.stringContaining('paint unavailable') })
      })
      expect(fixture.triggerUndo).toHaveBeenCalledOnce()
    }
  )

  it('keeps the original failure when Undo restores the changed layout', async () => {
    const fixture = createFixture()
    const created = await applyCanvas({ mode: 'create', markup: markup() })
    const root = fixture.getNode(created.rootNodeId!) as FrameNode
    fixture.triggerUndo.mockImplementationOnce(() => {
      expect(root.clipsContent).toBe(true)
      root.clipsContent = false
    })
    vi.mocked(figma.util.solidPaint).mockImplementationOnce(() => {
      throw new Error('paint unavailable')
    })

    await expect(
      applyCanvas({
        mode: 'update',
        targetNodeId: root.id,
        markup: markup('overflow-hidden', true)
      })
    ).rejects.toThrow(/^paint unavailable on "child"/)
    expect(root.clipsContent).toBe(false)
    expect(fixture.triggerUndo).toHaveBeenCalledOnce()
  })
})
