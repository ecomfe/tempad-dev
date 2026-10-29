import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { expect, it } from 'vitest'

import {
  TOOL_DEFS,
  createApplyCanvasToolResponse,
  createDesignTaskToolResponse,
  createToolErrorResponse
} from '../src/tools'

it('preserves canvas identities through SDK input parsing and formatted results', async () => {
  const definition = TOOL_DEFS.find((tool) => tool.name === 'apply_canvas')!
  const server = new McpServer({ name: 'canvas-fixture', version: '1' })
  const client = new Client({ name: 'sdk-fixture', version: '1' })
  const native = Object.fromEntries([
    ['__proto__', { figma: { locked: true } }],
    ['constructor', { figma: { locked: false } }]
  ])
  const received: unknown[] = []
  server.registerTool(definition.name, { inputSchema: definition.parameters }, (args) => {
    // The Hub parses once more after the SDK validates tool arguments.
    const parsed = definition.parameters.parse(args)
    received.push(parsed.native)
    return createApplyCanvasToolResponse({
      rootNodeId: '1:1',
      nodeIdsByKey: Object.fromEntries(Object.keys(parsed.native ?? {}).map((key) => [key, '1:1'])),
      createdNodeIds: ['1:1'],
      updatedNodeIds: [],
      removedNodeIds: [],
      mutationCount: 1,
      verification: { status: 'passed', nodesChecked: 1, referencesChecked: 0, warnings: [] }
    })
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const { tools } = await client.listTools()
    expect(tools[0]?.inputSchema.properties?.native).toMatchObject({
      type: 'object',
      propertyNames: { minLength: 1, maxLength: 128, pattern: '^[\\w./:-]+$' }
    })
    const args = {
      mode: 'create',
      markup: '<div data-key="__proto__"><div data-key="constructor" /></div>',
      native
    }
    const result = await client.callTool({ name: definition.name, arguments: args })
    expect(result.isError).not.toBe(true)
    expect(received).toEqual([native])
    expect(result.structuredContent).toMatchObject({
      nodeIdsByKey: Object.fromEntries([
        ['__proto__', '1:1'],
        ['constructor', '1:1']
      ])
    })

    const rejected = await client.callTool({
      name: definition.name,
      arguments: { ...args, native: Object.fromEntries([['__proto__', { component: { id: 1 } }]]) }
    })
    expect(rejected.isError).toBe(true)
    expect(received).toHaveLength(1)
  } finally {
    await client.close()
    await server.close()
  }
})

it('returns recovery guidance through an SDK client without changing successful task output', async () => {
  const recoveryGeneration = '00000000-0000-4000-8000-000000000001'
  const definition = TOOL_DEFS.find((tool) => tool.name === 'manage_design_task')!
  const server = new McpServer({ name: 'recovery-fixture', version: '1' })
  const client = new Client({ name: 'sdk-fixture', version: '1' })
  const task = {
    taskId: 'task-a',
    title: 'Recovered task',
    status: 'active' as const,
    operation: null,
    target: { sessionId: 'tab-a', fileKey: 'file-a', fileName: 'Design', pageId: 'page-a' },
    expiresAt: 1000,
    revision: 1,
    needsRead: true
  }
  server.registerTool(
    definition.name,
    { inputSchema: definition.parameters, outputSchema: definition.outputSchema },
    (args) =>
      args.recoveryGeneration === recoveryGeneration
        ? createDesignTaskToolResponse(task)
        : createToolErrorResponse(
            definition.name,
            Object.assign(
              new Error(`Begin a fresh task with recoveryGeneration "${recoveryGeneration}".`),
              { code: 'DESIGN_TASK_INACTIVE', recoveryGeneration }
            )
          )
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    await client.listTools()
    const args = {
      action: 'begin',
      title: task.title,
      requestId: '00000000-0000-4000-8000-000000000002'
    }
    const rejected = await client.callTool({ name: definition.name, arguments: args })
    expect(rejected).toMatchObject({
      isError: true,
      _meta: { code: 'DESIGN_TASK_INACTIVE', recoveryGeneration },
      content: [{ type: 'text', text: expect.stringContaining(recoveryGeneration) }]
    })
    expect(rejected.structuredContent).toBeUndefined()

    const accepted = await client.callTool({
      name: definition.name,
      arguments: { ...args, recoveryGeneration }
    })
    expect(accepted.isError).not.toBe(true)
    expect(accepted.structuredContent).toEqual(task)
    expect(definition.outputSchema?.parse(accepted.structuredContent)).toEqual(task)
  } finally {
    await client.close()
    await server.close()
  }
})
