// Installed hooks exchange lifecycle identity and Stop notices with the existing Hub. They never
// launch an agent, poll a model, change host trust, or unlock a stopped Figma file.
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'

let socket
const deadline = setTimeout(() => process.exit(0), 750)
try {
  let text = ''
  for await (const chunk of process.stdin) {
    text += String(chunk)
    if (text.length > 1_000_000) process.exit(0)
  }
  const input = JSON.parse(text)
  if (typeof input.session_id !== 'string' || input.agent_id || input.subagent_id) process.exit(0)
  const event = input.hook_event_name
  if (
    !['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'].includes(
      event
    )
  )
    process.exit(0)
  let taskId
  if (
    event === 'PostToolUse' &&
    /tempad[-_]dev.*__(?:begin_design|resume_design)$/.test(input.tool_name || '')
  ) {
    const response = input.tool_response
    if (!response?.isError) {
      let result = response?.structuredContent || response?.result?.structuredContent || response
      if (!result?.taskId && Array.isArray(response?.content)) {
        const text = response.content.find((value) => value.type === 'text')?.text
        if (text) {
          try {
            result = JSON.parse(text)
          } catch {
            /* This tool did not return a task. */
          }
        }
      }
      if (typeof result?.taskId === 'string') taskId = result.taskId
    }
  }
  const identity = {
    version: 1,
    kind: process.argv[2] === 'claude' ? 'claude' : 'codex',
    sessionId: input.session_id
  }
  const runtimeDir = process.env.TEMPAD_MCP_RUNTIME_DIR || join(tmpdir(), 'tempad-dev', 'run')
  const path =
    process.platform === 'win32' ? '\\\\.\\pipe\\tempad-mcp' : join(runtimeDir, 'mcp.sock')
  socket = connect(path)
  const pending = new Map()
  let sequence = 0
  let buffer = ''
  socket.on('data', (data) => {
    buffer += data.toString()
    if (buffer.length > 1_000_000) {
      socket.destroy()
      return
    }
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const entry = pending.get(message.id)
      if (!entry) continue
      pending.delete(message.id)
      if (message.error) entry.reject(new Error('The Hub does not support this hook request.'))
      else entry.resolve(message.result)
    }
  })
  const disconnected = () => {
    for (const entry of pending.values()) entry.reject(new Error('The Hub hook connection closed.'))
    pending.clear()
  }
  socket.on('error', disconnected)
  socket.on('close', disconnected)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const result = await request('tempad/client-hook', {
    ...identity,
    event,
    invocationId: randomUUID(),
    ...(taskId ? { taskId } : {}),
    ...(typeof input.turn_id === 'string' ? { turnId: input.turn_id } : {})
  })
  // Old Hubs may still offer comment batches; never emit or acknowledge those.
  if (
    !result?.receiptId &&
    result?.output?.hookSpecificOutput?.hookEventName === event &&
    typeof result.output.hookSpecificOutput.additionalContext === 'string'
  ) {
    await new Promise((resolve, reject) => {
      process.stdout.write(JSON.stringify(result.output) + '\n', (error) =>
        error ? reject(error) : resolve()
      )
    })
  }
} catch {
  // Missing/old runtimes never prevent the host from continuing, pausing, or exiting.
} finally {
  socket?.destroy()
  clearTimeout(deadline)
}
