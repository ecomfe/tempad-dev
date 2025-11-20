import { computed, shallowRef, watch } from 'vue'
import {
  createSharedComposable,
  useDocumentVisibility,
  useEventListener,
  useIdle,
  useTimeoutFn,
  useWindowFocus
} from '@vueuse/core'

import type { GetCodeParametersInput, GetCodeResult } from '@/mcp/src/tools'
import { parseMessageToExtension } from '@/mcp/src/protocol'
import { generateCodeBlocksForNode } from '@/utils'
import { activePlugin, options, runtimeMode, selectedNode, selection } from '@/ui/state'

const PORT_CANDIDATES = [6220, 7431, 8127]
const RECONNECT_DELAY_MS = 3000
const IDLE_TIMEOUT_MS = 10000

export type McpStatus = 'disabled' | 'connecting' | 'connected' | 'error'

function getPortCandidates(lastSuccessfulPort: number | null): number[] {
  if (lastSuccessfulPort && PORT_CANDIDATES.includes(lastSuccessfulPort)) {
    return [lastSuccessfulPort, ...PORT_CANDIDATES.filter((p) => p !== lastSuccessfulPort)]
  }
  return PORT_CANDIDATES
}

type ToolHandler = (args: unknown) => unknown | Promise<unknown>

const DEFAULT_OUTPUT: NonNullable<GetCodeParametersInput['output']> = 'css'

async function generateCode(output: NonNullable<GetCodeParametersInput['output']>) {
  const node = selectedNode.value
  if (!node || selection.value.length !== 1) {
    throw new Error('Select exactly one node to generate code.')
  }

  const codeBlocks = await generateCodeBlocksForNode(
    node,
    {
      cssUnit: options.value.cssUnit,
      rootFontSize: options.value.rootFontSize,
      scale: options.value.scale
    },
    activePlugin.value?.code
  )
  if (!codeBlocks.length) {
    throw new Error('No code available for the current selection.')
  }

  const preferred =
    codeBlocks.find(({ name }) => name === output) ?? codeBlocks.find(({ name }) => name === 'css')

  const block = preferred ?? codeBlocks[0]
  return {
    name: block.name,
    code: block.code
  }
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_code: async (args: unknown) => {
    const typed = (args ?? {}) as GetCodeParametersInput
    const output = typed.output ?? DEFAULT_OUTPUT
    const result = await generateCode(output)
    return {
      code: {
        [result.name]: result.code
      }
    } satisfies GetCodeResult
  }
}

export const useMcp = createSharedComposable(() => {
  const status = shallowRef<McpStatus>('disabled')
  const port = shallowRef<number | null>(null)
  const count = shallowRef(0)
  const activeId = shallowRef<string | null>(null)
  const selfId = shallowRef<string | null>(null)
  const errorMessage = shallowRef<string | null>(null)
  const socket = shallowRef<WebSocket | null>(null)

  let lastSuccessfulPort: number | null = null
  let isConnecting = false
  const documentVisibility = useDocumentVisibility()
  const { idle } = useIdle(IDLE_TIMEOUT_MS)
  const focused = useWindowFocus()

  const isWindowActive = computed(() => {
    return documentVisibility.value === 'visible' && !idle.value && focused.value
  })

  const { start: startReconnectTimer, stop: stopReconnectTimer } = useTimeoutFn(
    () => {
      connect()
    },
    RECONNECT_DELAY_MS,
    { immediate: false }
  )

  function resetState() {
    count.value = 0
    activeId.value = null
    selfId.value = null
    port.value = null
  }

  function cleanupSocket() {
    if (socket.value) {
      try {
        socket.value.close()
      } catch {
        // ignore
      }
    }
    socket.value = null
  }

  function scheduleReconnect() {
    stopReconnectTimer()
    if (options.value.mcpOn) {
      startReconnectTimer()
    }
  }

  function openWebSocket(targetPort: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${targetPort}`)
      const handleOpen = () => {
        ws.removeEventListener('error', handleError)
        resolve(ws)
      }
      const handleError = (event: Event) => {
        ws.removeEventListener('open', handleOpen)
        ws.close()
        const err = event instanceof ErrorEvent ? event.error : null
        reject(err ?? new Error('WebSocket connection failed'))
      }
      ws.addEventListener('open', handleOpen, { once: true })
      ws.addEventListener('error', handleError, { once: true })
    })
  }

  async function connect() {
    if (
      runtimeMode.value !== 'standard' ||
      !options.value.mcpOn ||
      isConnecting ||
      socket.value ||
      !isWindowActive.value
    ) {
      return
    }

    isConnecting = true
    stopReconnectTimer()
    status.value = 'connecting'

    const candidates = getPortCandidates(lastSuccessfulPort)

    for (const candidatePort of candidates) {
      try {
        const ws = await openWebSocket(candidatePort)
        if (!options.value.mcpOn) {
          ws.close()
          break
        }
        lastSuccessfulPort = candidatePort
        port.value = candidatePort
        errorMessage.value = null
        socket.value = ws
        break
      } catch (err) {
        errorMessage.value =
          err instanceof Error ? err.message : 'Failed to connect to MCP WebSocket server'
      }
    }

    if (!socket.value && options.value.mcpOn) {
      scheduleReconnect()
    }

    isConnecting = false
  }

  async function handleMessage(event: MessageEvent<string>) {
    const payload = typeof event.data === 'string' ? event.data : ''
    const message = parseMessageToExtension(payload)

    if (!message) {
      errorMessage.value = 'Received malformed message from MCP server'
      return
    }

    if (message.type === 'registered') {
      selfId.value = message.id
      return
    }

    if (message.type === 'state') {
      activeId.value = message.activeId
      count.value = message.count
      port.value = message.port
      status.value = 'connected'
      errorMessage.value = null
      return
    }

    if (message.type === 'toolCall') {
      await processToolCall(message.id, message.payload.name, message.payload.args)
    }
  }

  function handleClose(event: CloseEvent) {
    if (event.wasClean === false) {
      errorMessage.value = 'MCP connection closed unexpectedly'
    }
    socket.value = null
    resetState()
    if (!options.value.mcpOn) {
      status.value = 'disabled'
      return
    }
    status.value = 'connecting'
    scheduleReconnect()
  }

  function handleError(event: Event) {
    const message = event instanceof ErrorEvent ? event.message : 'MCP connection error'
    errorMessage.value = message
  }

  useEventListener(socket, 'message', (event: MessageEvent<string>) => handleMessage(event))
  useEventListener(socket, 'close', (event: CloseEvent) => handleClose(event))
  useEventListener(socket, 'error', handleError)

  function start() {
    status.value = 'connecting'
    resetState()
    stopReconnectTimer()
    connect()
  }

  function stop() {
    stopReconnectTimer()
    cleanupSocket()
    resetState()
    status.value = 'disabled'
    errorMessage.value = null
  }

  watch(
    () => options.value.mcpOn,
    (enabled) => {
      if (enabled && runtimeMode.value === 'standard') {
        start()
      } else {
        stop()
      }
    },
    { immediate: true }
  )

  watch(isWindowActive, (active) => {
    if (active) {
      if (
        runtimeMode.value === 'standard' &&
        options.value.mcpOn &&
        !socket.value &&
        !isConnecting
      ) {
        console.log('[tempad-dev] MCP connection polling resumed.')
        connect()
      }
    } else {
      if (options.value.mcpOn && !socket.value) {
        console.log('[tempad-dev] MCP connection polling paused.')
        stopReconnectTimer()
      }
    }
  })

  const selfActive = computed(() => !!selfId.value && selfId.value === activeId.value)

  function activate() {
    if (socket.value?.readyState === WebSocket.OPEN) {
      console.log('Activating MCP connection...')
      socket.value.send(JSON.stringify({ type: 'activate' }))
    }
  }

  async function processToolCall(req: string, name: string, args: unknown) {
    const handler = TOOL_HANDLERS[name]
    const currentSocket = socket.value
    if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      if (!handler) {
        throw new Error(`No handler registered for tool "${name}".`)
      }
      const result = await handler(args)
      currentSocket.send(
        JSON.stringify({
          type: 'toolResult',
          id: req,
          payload: result
        })
      )
    } catch (error: unknown) {
      currentSocket.send(
        JSON.stringify({
          type: 'toolResult',
          id: req,
          error: error instanceof Error ? error.message : (error ?? 'Unknown error')
        })
      )
    }
  }

  return {
    status,
    port,
    count,
    activeId,
    selfId,
    selfActive,
    errorMessage,
    activate
  }
})
