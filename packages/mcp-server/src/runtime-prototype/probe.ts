import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

import { hubEnvironment } from '../process-environment'
import { contractHashes, readRuntimeContract } from '../stable-edge'
import { connectSocket, fingerprintBundle } from './processes'
import { ControlPeer, SocketTransport } from './protocol'
import { ArtifactSchema } from './state'

/** Run only an explicitly offered local entry, with private stores and no user host identity. */
export async function probeArtifact(entry: string) {
  entry = realpathSync(entry)
  const bundle = fingerprintBundle(entry)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tp-probe-')))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, '--root', root],
    stderr: 'pipe',
    env: Object.fromEntries(
      Object.entries(hubEnvironment(process.env)).filter(
        (value): value is [string, string] => typeof value[1] === 'string'
      )
    )
  })
  transport.stderr?.on('data', () => {})
  const client = new Client({ name: 'tempad-artifact-probe', version: '1' })
  const control = new ControlPeer()
  let pids: number[] | undefined
  let result:
    | {
        artifact: z.infer<typeof ArtifactSchema>
        contract: string
        wireHash: string
        presentationHash: string
      }
    | undefined
  let failure: unknown
  try {
    await client.connect(transport, { timeout: 15_000 })
    await control.connect(new SocketTransport(await connectSocket(join(root, 'supervisor.sock'))))
    const state = await control.request(
      { method: 'tempad/runtime-status' },
      ResultSchema.extend({
        handoffVersion: z.literal(1),
        hubPid: z.number().int().positive(),
        supervisorPid: z.number().int().positive()
      }),
      { timeout: 5000 }
    )
    pids = [state.hubPid, state.supervisorPid]
    const contract = await readRuntimeContract(client, AbortSignal.timeout(10_000), 5000)
    const artifact = ArtifactSchema.parse({
      entry,
      bundle,
      version: client.getServerVersion()!.version
    })
    if (fingerprintBundle(entry) !== bundle)
      throw new Error('Local runtime changed during verification.')
    result = {
      artifact,
      ...contractHashes(contract),
      contract: createHash('sha256')
        .update(JSON.stringify({ ...contract, pages: [...contract.pages] }))
        .digest('hex')
    }
  } catch (error) {
    failure = error
  } finally {
    await control.close()
    await client.close()
    await transport.close()
  }
  // No forced PID kill: an uncertain probe retains its private evidence and
  // cannot authorize activation. The prototype's idle-owner rule stops children.
  let exited = false
  for (let attempt = 0; pids && attempt < 60; attempt++) {
    exited = pids.every((pid) => {
      try {
        process.kill(pid, 0)
        return false
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
        throw error
      }
    })
    if (exited) break
    await delay(100)
  }
  if (!exited)
    throw new Error(`Local runtime probe did not stop; preserve ${root} for diagnosis.`, {
      cause: failure
    })
  rmSync(root, { recursive: true, force: true })
  if (failure) throw failure
  return result!
}
