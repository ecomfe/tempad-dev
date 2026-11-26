// Installed hooks exchange lifecycle identity and Stop notices with the existing Hub. They never
// launch an agent, poll a model, change host trust, or unlock a stopped Figma file.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { pathToFileURL } from 'node:url'

import { assertTrustedSocket, resolveDefaultRoot } from './runtime-paths.mjs'
import {
  checkoutProfile,
  resolveRuntimeProfile,
  runtimeDirectories,
  runtimeSocketPath
} from './runtime-profile.mjs'
import { openWindowsHook } from './windows-hook.mjs'

let windowsHook
const deadline = setTimeout(() => {
  windowsHook?.close()
  process.exit(0)
}, 750)
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
  let profile = { kind: 'release' }
  let path
  if (process.argv[3] === '--runtime-profile') {
    const descriptorPath = process.argv[4]
    const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
    if (typeof descriptor.serverName !== 'string' || !descriptor.serverName)
      throw new Error('Missing checkout MCP server name.')
    // Read the same generated configuration as MCP/preflight so directory overrides cannot drift.
    const pluginRoot = resolve(dirname(descriptorPath), '../..')
    const config = JSON.parse(readFileSync(join(pluginRoot, '.mcp.json'), 'utf8')).mcpServers?.[
      descriptor.serverName
    ]
    if (
      typeof config?.env?.TEMPAD_MCP_DEV_CHECKOUT !== 'string' ||
      typeof config?.args?.[0] !== 'string'
    )
      throw new Error('Missing checkout MCP configuration.')
    const runtimeDir = config.env.TEMPAD_MCP_RUNTIME_DIR
    if (
      runtimeDir !== undefined &&
      (typeof runtimeDir !== 'string' || (runtimeDir && !isAbsolute(runtimeDir)))
    )
      throw new Error('Checkout runtime directory must be an absolute path.')
    const env = {
      ...process.env,
      TEMPAD_MCP_DEV_CHECKOUT: config.env.TEMPAD_MCP_DEV_CHECKOUT,
      ...(runtimeDir !== undefined ? { TEMPAD_MCP_RUNTIME_DIR: runtimeDir } : {})
    }
    profile = resolveRuntimeProfile(env, pathToFileURL(resolve(pluginRoot, config.args[0])))
    if (
      profile.kind !== 'checkout' ||
      profile.id !== descriptor.id ||
      checkoutProfile(descriptor.checkout).id !== profile.id
    )
      throw new Error('Invalid checkout hook profile.')
    path = runtimeSocketPath(runtimeDirectories(env, profile).runtime, profile)
  } else {
    const runtimeDir = process.env.TEMPAD_MCP_RUNTIME_DIR || join(resolveDefaultRoot(), 'run')
    path = runtimeSocketPath(runtimeDir, profile)
  }
  const lifecycle = {
    ...identity,
    event,
    invocationId: randomUUID(),
    ...(taskId ? { taskId } : {}),
    ...(typeof input.turn_id === 'string' ? { turnId: input.turn_id } : {})
  }
  const params = { ...lifecycle, version: 2, profile, issuedAt: Date.now() }
  if (process.platform === 'win32') windowsHook = openWindowsHook(path)
  let legacy = false
  async function unixRequest(frame) {
    const reply = connect(path).setEncoding('utf8')
    reply.once('connect', () => reply.write(frame))
    const timer = setTimeout(() => reply.destroy(), 200)
    try {
      return await new Promise((resolve, reject) => {
        let buffer = ''
        reply.on('data', (data) => {
          buffer += data
          if (buffer.length > 1_000_000) {
            reject(new Error('Oversized hook reply.'))
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
            resolve(message)
            return
          }
        })
        reply.on('error', reject)
        reply.once('close', () => reject(new Error('The Hub hook connection closed.')))
      })
    } finally {
      clearTimeout(timer)
      reply.destroy()
    }
  }
  let result
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 30))
    if (process.platform !== 'win32') assertTrustedSocket(path)
    try {
      const frame =
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tempad/client-hook',
          params: legacy ? lifecycle : params
        }) + '\n'
      const message = await (windowsHook ? windowsHook.request(frame) : unixRequest(frame))
      if (message?.id !== 1) throw new Error('Invalid hook reply.')
      if (message.error)
        throw Object.assign(new Error('The Hub does not support this hook request.'), {
          code: message.error.code
        })
      result = message.result
      if (legacy) break
      const receipt = result?.receipt
      if (receipt?.version !== 2 || receipt.invocationId !== params.invocationId)
        throw new Error('Invalid lifecycle receipt.')
      if (receipt.state === 'applied') break
      if (receipt.state !== 'accepted') throw new Error('Invalid lifecycle receipt state.')
      result = undefined
    } catch (error) {
      result = undefined
      if (!attempt && (error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED')) break
      // Only a definite old-schema rejection permits fallback. A lost reply
      // retries the same v2 invocation, never a second lifecycle effect.
      if (error?.code === -32602 && !legacy) legacy = true
    }
  }
  // Old Hubs may still offer comment batches; never emit or acknowledge those.
  const notice = result?.output?.hookSpecificOutput
  if (
    !result?.receiptId &&
    (event === 'PreToolUse' || event === 'PostToolUse') &&
    notice?.hookEventName === event &&
    typeof notice.additionalContext === 'string'
  ) {
    const output = {
      hookSpecificOutput: { hookEventName: event, additionalContext: notice.additionalContext }
    }
    await new Promise((resolve, reject) => {
      process.stdout.write(JSON.stringify(output) + '\n', (error) =>
        error ? reject(error) : resolve()
      )
    })
  }
} catch {
  // Missing/old runtimes never prevent the host from continuing, pausing, or exiting.
} finally {
  windowsHook?.close()
  clearTimeout(deadline)
}
