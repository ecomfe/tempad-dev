import type { Socket } from 'node:net'

import { ResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { z } from 'zod'

import type { TerminalReceipts } from './terminal-receipts'

import { ControlPeer, SocketTransport } from './runtime-prototype/protocol'

const BlockSchema = z.object({
  id: z.string(),
  revision: z.uuid(),
  fileKey: z.string(),
  browserId: z.string(),
  tabId: z.number().optional(),
  documentId: z.string().optional(),
  recordedAt: z.number()
})
const StatusSchema = ResultSchema.extend({ blocks: z.array(BlockSchema) })
const PreparedSchema = ResultSchema.extend({ block: BlockSchema, challenge: z.uuid() })
export const RECOVERY_METHODS = ['tempad/runtime-status', 'tempad/runtime-prepare-resolution']

/** Private same-user socket only; never registered in the MCP tool catalog. */
export async function attachRuntimeRecovery(
  socket: Socket,
  receipts: TerminalReceipts,
  resolved: (record: NonNullable<ReturnType<TerminalReceipts['abandon']>>) => void
) {
  const peer = new ControlPeer()
  let confirmation: { id: string; revision: string; challenge: string; expires: number } | undefined
  const timeout = setTimeout(() => void peer.close(), 120_000)
  timeout.unref()
  peer.onclose = () => {
    clearTimeout(timeout)
    confirmation = undefined
  }
  peer.onerror = () => void peer.close()
  peer.setRequestHandler(z.object({ method: z.literal('tempad/runtime-status') }), () => ({
    blocks: receipts.status()
  }))
  peer.setRequestHandler(
    z.object({
      method: z.literal('tempad/runtime-prepare-resolution'),
      params: z.object({ id: z.string() }).strict()
    }),
    ({ params }) => {
      const block = receipts.status().find((record) => record.id === params.id)
      if (!block)
        throw new Error('No unresolved execution with this ID. Inspect --runtime-status again.')
      confirmation = {
        id: block.id,
        revision: block.revision,
        challenge: randomUUID(),
        expires: performance.now() + 120_000
      }
      return { block, challenge: confirmation.challenge }
    }
  )
  peer.setRequestHandler(
    z.object({
      method: z.literal('tempad/runtime-resolve-block'),
      params: z.object({ challenge: z.uuid(), stopped: z.literal(true) }).strict()
    }),
    ({ params }) => {
      const selected = confirmation
      confirmation = undefined
      if (
        !selected ||
        selected.challenge !== params.challenge ||
        performance.now() >= selected.expires
      )
        throw new Error('Recovery confirmation expired or was already used.')
      const record = receipts.abandon(selected.id, selected.revision)
      if (record) resolved(record)
      return { resolved: selected.id, readRequired: true }
    }
  )
  await peer.connect(new SocketTransport(socket))
  return peer
}

export async function runRuntimeRecovery(
  args: string[],
  connect: () => Promise<Socket>,
  io = {
    interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
    write: (value: string) => process.stdout.write(value),
    confirm: async (prompt: string) => {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await terminal.question(prompt)
      } finally {
        terminal.close()
      }
    }
  }
): Promise<void> {
  const status = args.length === 1 && args[0] === '--runtime-status'
  const id = args.length === 2 && args[0] === '--resolve-runtime-block' ? args[1] : undefined
  if (!status && !id) throw new Error('Use --runtime-status or --resolve-runtime-block <block-id>.')
  if (id && !io.interactive)
    throw new Error(
      'Runtime recovery requires an interactive terminal and confirmation that the original execution environment has stopped.'
    )
  const peer = new ControlPeer()
  peer.onerror = () => void peer.close()
  try {
    await peer.connect(new SocketTransport(await connect()))
    if (status) {
      const result = await peer.request({ method: 'tempad/runtime-status' }, StatusSchema)
      io.write(JSON.stringify(result, null, 2) + '\n')
      return
    }
    const prepared = await peer.request(
      { method: 'tempad/runtime-prepare-resolution', params: { id } },
      PreparedSchema
    )
    io.write(JSON.stringify(prepared.block, null, 2) + '\n')
    const answer = await io.confirm(
      'This cannot stop remote code. Close the original Figma page/browser first. Type the exact block ID to attest that its execution environment has stopped: '
    )
    if (answer !== id) throw new Error('Recovery cancelled; execution remains blocked.')
    await peer.request(
      {
        method: 'tempad/runtime-resolve-block',
        params: { challenge: prepared.challenge, stopped: true }
      },
      ResultSchema
    )
    io.write(
      'Execution retired. Stop fences remain; explicitly resume an eligible task and reread the original target before writing.\n'
    )
  } finally {
    await peer.close()
  }
}
