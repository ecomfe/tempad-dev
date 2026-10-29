import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { createHash } from 'node:crypto'
import { realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

import { hubEnvironment } from '../process-environment'
import { createPrivateTempDirectory, runtimeEndpoint } from '../runtime-platform'
import { contractHashes, readRuntimeContract } from '../stable-edge'
import { connectSocket, fingerprintBundle } from './processes'
import { ControlPeer, RECOVER_MS, SocketTransport } from './protocol'
import { ArtifactSchema } from './state'

/** Run only an explicitly offered local entry, with private stores and no user host identity. */
export async function probeArtifact(entry: string) {
  entry = realpathSync(entry)
  const bundle = fingerprintBundle(entry)
  const root = createPrivateTempDirectory('tp-probe-')
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
  let stderr = Buffer.alloc(0)
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr = Buffer.concat([stderr, chunk.subarray(-16_384)]).subarray(-16_384)
  })
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
  let phase = 'initialize'
  const started = performance.now()
  try {
    // Initial attachment can use the edge's full recovery budget. Allow the
    // following SDK exchange without extending any business-request deadline.
    await client.connect(transport, { timeout: RECOVER_MS + 5000 })
    phase = 'runtime-status'
    await control.connect(
      new SocketTransport(await connectSocket(runtimeEndpoint(root, 'supervisor.sock')))
    )
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
    phase = 'contract'
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
    phase = 'shutdown'
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
  if (!exited) {
    const diagnostic = {
      phase,
      elapsedMs: Math.round(performance.now() - started),
      pids,
      failure:
        failure instanceof Error ? (failure.stack ?? failure.message).slice(-16_384) : undefined,
      stderr: stderr.toString('utf8')
    }
    try {
      writeFileSync(join(root, 'probe-failure.json'), JSON.stringify(diagnostic), { mode: 0o600 })
    } catch {
      // Evidence collection must not replace the original failure or permit cleanup.
    }
    const reason = pids ? 'did not stop' : `ownership is unknown after ${phase} failed`
    // Release preparation runs this probe in a subprocess. Include its bounded
    // private diagnostic so an uncaught failure retains the evidence in stderr.
    throw Object.assign(
      new Error(`Local runtime probe ${reason}; preserve ${root} for diagnosis.`, {
        cause: failure
      }),
      { diagnostic }
    )
  }
  rmSync(root, { recursive: true, force: true })
  if (failure) throw failure
  return result!
}
