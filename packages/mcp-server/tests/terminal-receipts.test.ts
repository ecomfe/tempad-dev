import type { FigmaSession, ToolCompletionMessage } from '@tempad-dev/shared'
import type { WebSocket } from 'ws'

import { describe, expect, it } from 'vitest'

import type { ExtensionConnection } from '../src/types'

import { TerminalReceipts } from '../src/terminal-receipts'

const session: FigmaSession = {
  sessionId: 'page',
  fileKey: 'file',
  fileName: 'File',
  pageId: '1:1',
  busy: false,
  tabId: 1,
  documentId: 'document'
}
function peer(id = 'original'): ExtensionConnection {
  return {
    id,
    ws: {} as WebSocket,
    origin: 'chrome-extension://owner',
    connectedAt: '',
    runtime: {
      protocolVersion: 15,
      version: '1',
      fingerprint: 'a'.repeat(64),
      terminalReceipts: true
    },
    sessions: {
      type: 'sessions',
      browserId: 'browser',
      activeSessionId: 'page',
      sessions: [{ ...session }]
    }
  }
}
function dispatched(registry: TerminalReceipts, id = 'call'): ToolCompletionMessage {
  return { type: 'toolCompletion', id, ...registry.reserve(id, peer(), session, 'task', true)! }
}

describe('terminal receipts', () => {
  it('recovers only once across a same-browser reconnect and preserves the original operation identity', () => {
    const registry = new TerminalReceipts()
    const completion = dispatched(registry)
    expect(registry.accept(completion, peer('replacement'))).toMatchObject({
      accepted: true,
      recovered: { extensionId: 'original', taskId: 'task', write: true }
    })
    expect(registry.accept(completion, peer('replacement'))).toEqual({ accepted: true })
  })

  it.each([
    'generation',
    'receiptId',
    'id',
    'origin',
    'browser',
    'document',
    'tab',
    'session',
    'file',
    'capability'
  ])('does not finish the operation for a mismatched %s', (field) => {
    const registry = new TerminalReceipts()
    const completion = dispatched(registry)
    const originalCompletion = { ...completion }
    const replacement = peer('replacement')
    if (field === 'generation' || field === 'receiptId' || field === 'id')
      completion[field] = 'wrong'
    if (field === 'origin') replacement.origin = 'chrome-extension://other'
    if (field === 'browser') replacement.sessions!.browserId = 'other'
    if (field === 'document') replacement.sessions!.sessions[0]!.documentId = 'new-document'
    if (field === 'tab') replacement.sessions!.sessions[0]!.tabId = 2
    if (field === 'session') replacement.sessions!.sessions[0]!.sessionId = 'other'
    if (field === 'file') replacement.sessions!.sessions[0]!.fileKey = 'other'
    if (field === 'capability') delete replacement.runtime!.terminalReceipts
    expect(registry.accept(completion, replacement)).toEqual({ accepted: false })
    // Rejection must not consume the original authority.
    expect(registry.accept(originalCompletion, peer())).toMatchObject({
      accepted: true,
      recovered: { extensionId: 'original' }
    })
  })

  it('normal results settle before the completion arrives, and wrong connections cannot settle', () => {
    const registry = new TerminalReceipts()
    const completion = dispatched(registry)
    registry.settle('call', 'other')
    registry.settle('call', 'original')
    expect(registry.accept(completion, peer())).toEqual({ accepted: true })
  })

  it('retires disconnected reads without losing an unresolved write receipt', () => {
    const registry = new TerminalReceipts()
    const write = dispatched(registry)
    registry.settle(write.id, 'original', false)
    for (let index = 0; index < 256; index++) {
      const id = `read-${index}`
      registry.reserve(id, peer(), session, undefined, false)
      registry.settle(id, 'original', false)
    }
    expect(registry.accept(write, peer('replacement'))).toMatchObject({
      accepted: true,
      recovered: { write: true, extensionId: 'original' }
    })
  })

  it('bounds pending calls without eviction, retires replaced documents, and bounds completed tombstones', () => {
    const registry = new TerminalReceipts()
    const first = dispatched(registry, '0')
    for (let index = 1; index < 128; index++) dispatched(registry, String(index))
    expect(() => dispatched(registry, 'overflow')).toThrow(/Too many calls/)
    registry.reconcile(peer()) // An idle snapshot is not completion.
    expect(() => dispatched(registry, 'overflow')).toThrow(/Too many calls/)
    const otherBrowser = peer()
    otherBrowser.sessions!.browserId = 'other'
    otherBrowser.sessions!.openTabIds = []
    registry.reconcile(otherBrowser)
    expect(() => dispatched(registry, 'overflow')).toThrow(/Too many calls/)
    const replacement = peer()
    replacement.sessions!.sessions[0]!.documentId = 'replacement'
    registry.reconcile(replacement)
    expect(registry.accept(first, peer())).toEqual({ accepted: false })
    let oldest: ToolCompletionMessage | undefined
    let newest: ToolCompletionMessage | undefined
    for (let index = 0; index < 129; index++) {
      newest = dispatched(registry, String(index))
      oldest ??= newest
      registry.settle(String(index), 'original')
    }
    expect(registry.accept(oldest!, peer())).toEqual({ accepted: false })
    expect(registry.accept(newest!, peer())).toEqual({ accepted: true })
  })

  it('keeps old peers and sessions without browser document identity on the existing path', () => {
    const registry = new TerminalReceipts()
    const old = peer()
    delete old.runtime!.terminalReceipts
    expect(registry.reserve('old', old, session, undefined, false)).toBeUndefined()
    expect(
      registry.reserve(
        'unknown-document',
        peer(),
        { ...session, documentId: undefined },
        undefined,
        false
      )
    ).toBeUndefined()
  })
})
