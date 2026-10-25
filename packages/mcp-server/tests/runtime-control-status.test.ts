import { describe, expect, it } from 'vitest'

import type { Registration } from '../src/runtime-prototype/protocol'

import { captureHostContext } from '../src/agent-clients/host-context'
import { controlComponentStatus } from '../src/runtime-prototype/status'

function registration(version?: string): Registration {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    token: '22222222-2222-4222-8222-222222222222',
    context: captureHostContext({ HOME: '/private/host-home', TMPDIR: '/private/host-tmp' }),
    versions: [1],
    ...(version
      ? { updates: { policy: 'stable' as const, version, manifestHash: 'a'.repeat(64) } }
      : {})
  }
}

describe('control component update status', () => {
  it('keeps original control versions visible after a Hub update without leaking registration data', () => {
    expect(controlComponentStatus('0.12.0', [registration('0.12.0')], ['0.12.1'])).toEqual({
      supervisor: { version: '0.12.0', pendingVersion: '0.12.1', restartRequired: true },
      edges: [{ version: '0.12.0', pendingVersion: '0.12.1', restartRequired: true }],
      restartRequired: true
    })
  })

  it('reports the newest available version while avoiding downgrades for newer edges', () => {
    expect(
      controlComponentStatus(
        '0.12.0',
        [registration('0.12.1'), registration('0.13.0')],
        ['0.12.0', '0.12.2', '0.12.1']
      )
    ).toEqual({
      supervisor: { version: '0.12.0', pendingVersion: '0.12.2', restartRequired: true },
      edges: [
        { version: '0.12.1', pendingVersion: '0.12.2', restartRequired: true },
        { version: '0.13.0', pendingVersion: null, restartRequired: false }
      ],
      restartRequired: true
    })
  })

  it('does not invent versions or claim unknown older registrations have current code', () => {
    expect(controlComponentStatus('0.12.0', [registration(), registration('unknown')], [])).toEqual(
      {
        supervisor: { version: '0.12.0', pendingVersion: null, restartRequired: false },
        edges: [
          { version: null, pendingVersion: null, restartRequired: null },
          { version: null, pendingVersion: null, restartRequired: null }
        ],
        restartRequired: null
      }
    )
  })
})
