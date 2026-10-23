// Installed hooks exchange lifecycle identity and Stop notices with the existing Hub. They never
// launch an agent, poll a model, change host trust, or unlock a stopped Figma file.
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { join } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'

import { assertTrustedSocket, resolveDefaultRoot } from './runtime-paths.mjs'

let socket
const deadline = setTimeout(() => process.exit(0), 750)
try {
  let text = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    text += chunk
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
    ((/tempad[-_]dev.*__manage_design_task$/.test(input.tool_name || '') &&
      ['begin', 'resume'].includes(input.tool_input?.action)) ||
      /tempad[-_]dev.*__(?:begin_design|resume_design)$/.test(input.tool_name || ''))
  ) {
    const response = input.tool_response
    if (!response?.isError && !response?.result?.isError) {
      let result = response?.structuredContent || response?.result?.structuredContent || response
      // Claude passes the tool's content directly, as text or content blocks.
      const content = Array.isArray(result) ? result : response?.content
      if (!result?.taskId && Array.isArray(content))
        result = content.find((value) => value?.type === 'text')?.text
      if (typeof result === 'string') {
        try {
          result = JSON.parse(result)
        } catch {
          /* This tool did not return a task. */
        }
      }
      if (!result?.isError && typeof result?.taskId === 'string') taskId = result.taskId
    }
  }
  const identity = {
    version: 1,
    kind: process.argv[2] === 'claude' ? 'claude' : 'codex',
    sessionId: input.session_id
  }
  const runtimeDir = process.env.TEMPAD_MCP_RUNTIME_DIR || join(resolveDefaultRoot(), 'run')
  const path =
    process.platform === 'win32' ? '\\\\.\\pipe\\tempad-mcp' : join(runtimeDir, 'mcp.sock')
  assertTrustedSocket(path)
  socket = connect(path).setEncoding('utf8')
  const result = await new Promise((resolve, reject) => {
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data
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
        if (message?.id !== 1) continue
        if (message.error) reject(new Error('The Hub does not support this hook request.'))
        else resolve(message.result)
        return
      }
    })
    socket.on('error', reject)
    socket.once('close', () => reject(new Error('The Hub hook connection closed.')))
    socket.once('connect', () => {
      socket.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tempad/client-hook',
          params: {
            ...identity,
            event,
            invocationId: randomUUID(),
            ...(taskId ? { taskId } : {}),
            ...(typeof input.turn_id === 'string' ? { turnId: input.turn_id } : {})
          }
        }) + '\n'
      )
    })
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
