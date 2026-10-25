import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'
import { z } from 'zod'

import { ensureFile, SOCK_PATH } from '../shared'
import { LeaseSchema } from './hub-control'
import {
  connectSocket,
  hasHubRecord,
  launch,
  listenPrivate,
  waitForSocket,
  unavailableSocket,
  type PrototypeConfig
} from './processes'
import {
  ControlPeer,
  CONTROL_VERSIONS,
  negotiate,
  RegistrationSchema,
  RENEW_MS,
  SocketTransport
} from './protocol'

export async function startSupervisor(config: PrototypeConfig) {
  const lockPath = join(config.root, 'supervisor.lock')
  ensureFile(lockPath)
  const unlock = await lockfile.lock(lockPath, { retries: 0, stale: 5000, update: 1000 })
  const socketPath = join(config.root, 'supervisor.sock')
  const peers = new Set<ControlPeer>()
  const hub = new ControlPeer()
  let renewing = false
  let closing = false
  const stop = () => void close()
  let timer: ReturnType<typeof setInterval> | undefined
  const server = createServer((socket) => {
    if (peers.size >= 128) {
      socket.destroy()
      return
    }
    const peer = new ControlPeer()
    peers.add(peer)
    const timeout = setTimeout(() => void peer.close(), 5000)
    let registered = false
    peer.onerror = () => void peer.close()
    peer.onclose = () => {
      clearTimeout(timeout)
      peers.delete(peer)
    }
    peer.setRequestHandler(
      z.object({ method: z.literal('tempad/runtime-hello'), params: RegistrationSchema }),
      async ({ params }) => {
        if (registered) throw new Error('A runtime connection can register only once.')
        const version = negotiate(params.versions)
        registered = true
        await hub.request({ method: 'tempad/runtime-register', params }, ResultSchema, {
          timeout: 3000
        })
        clearTimeout(timeout)
        return { ...lease, version, supervisorPid: process.pid }
      }
    )
    void peer.connect(new SocketTransport(socket)).catch(() => void peer.close())
  })
  async function close() {
    if (closing) return
    closing = true
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    clearInterval(timer)
    server.close()
    await Promise.allSettled([...peers].map((peer) => peer.close()))
    await hub.close()
    rmSync(socketPath, { force: true })
    rmSync(join(config.root, 'supervisor.json'), { force: true })
    await unlock()
  }
  let lease: z.infer<typeof LeaseSchema>
  try {
    let socket
    try {
      socket = await connectSocket(SOCK_PATH)
    } catch (error) {
      if (!unavailableSocket(error)) throw error
      // A crashed Hub needs Phase 2's durable execution/recovery rules. This
      // prototype never clears its record or silently recreates its writer.
      if (hasHubRecord(config.root))
        throw new Error('Runtime Hub was lost; preserve the isolated root for diagnosis.', {
          cause: error
        })
      launch(config, 'hub')
      socket = await waitForSocket(SOCK_PATH)
    }
    hub.onerror = () => void close()
    hub.onclose = () => void close()
    await hub.connect(new SocketTransport(socket))
    lease = await hub.request(
      {
        method: 'tempad/runtime-acquire',
        params: {
          secret: config.secret,
          versions: [...CONTROL_VERSIONS]
        }
      },
      LeaseSchema,
      { timeout: 5000 }
    )
    if (closing) throw new Error('Hub closed during supervisor startup.')
    timer = setInterval(() => {
      if (renewing) return
      renewing = true
      void hub
        .request({ method: 'tempad/runtime-renew' }, ResultSchema, { timeout: RENEW_MS })
        .catch(() => close())
        .finally(() => {
          renewing = false
        })
    }, RENEW_MS)
    rmSync(socketPath, { force: true })
    await listenPrivate(server, socketPath)
    if (closing) throw new Error('Hub closed during supervisor startup.')
    chmodSync(socketPath, 0o600)
    writeFileSync(
      join(config.root, 'supervisor.json'),
      JSON.stringify({
        pid: process.pid,
        entry: config.entry,
        bundle: config.bundle,
        ...lease
      }),
      { mode: 0o600 }
    )
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  } catch (error) {
    await close()
    throw error
  }
}
