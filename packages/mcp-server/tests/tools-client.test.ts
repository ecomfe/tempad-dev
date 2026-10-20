import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { expect, it } from 'vitest'

import { TOOL_DEFS, createDesignTaskToolResponse, createToolErrorResponse } from '../src/tools'

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
