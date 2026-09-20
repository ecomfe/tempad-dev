import { describe, expect, it } from 'vitest'

import type { ExtensionConnection } from '../src/types'

import { DesignTasks, resolveDesignTarget } from '../src/design-tasks'
import { legacyToolPayload } from '../src/legacy-extension'

describe('legacy extension routing', () => {
  it('preserves old read parameters and rejects authoring and new read semantics', () => {
    expect(legacyToolPayload('get_structure', { options: { depth: 2 } })).toEqual({
      name: 'get_structure',
      args: { options: { depth: 2 } }
    })
    for (const [name, args] of [
      ['apply_canvas', {}],
      ['get_design_system', {}],
      ['get_structure', { pageId: 'page' }],
      ['get_code', { taskId: 'task' }]
    ] as const) {
      expect(() => legacyToolPayload(name, args)).toThrow(
        expect.objectContaining({
          code: 'EXTENSION_UPGRADE_REQUIRED',
          message: expect.stringContaining('reload the Figma tab')
        })
      )
    }
  })

  it('never creates a design session from a legacy connection', () => {
    const tasks = new DesignTasks({ createId: () => 'task' })
    const legacy = { id: 'legacy', legacy: true } as ExtensionConnection
    expect(() => resolveDesignTarget(tasks, [legacy], legacy.id, 'owner')).toThrow(
      expect.objectContaining({ code: 'EXTENSION_UPGRADE_REQUIRED' })
    )
    // A task id cannot fall back to whichever old tab happens to be active.
    expect(() => resolveDesignTarget(tasks, [legacy], legacy.id, 'owner', 'missing-task')).toThrow(
      expect.objectContaining({ code: 'DESIGN_TASK_INACTIVE' })
    )
  })
})
