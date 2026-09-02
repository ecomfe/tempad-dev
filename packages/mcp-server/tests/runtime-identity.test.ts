import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  RuntimeIdentityMismatchError,
  assertHubRuntimeIdentity,
  compareExtensionRuntimeIdentity,
  compareHubRuntimeIdentity,
  createHubRuntimeIdentity,
  readHubRuntimeIdentity,
  removeHubRuntimeIdentityIfOwned,
  resolveExpectedExtensionRuntimeFingerprint,
  writeHubRuntimeIdentity
} from '../src/runtime-identity'

describe('runtime identity', () => {
  it('derives the development extension cohort from the configured checkout', async () => {
    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
    await expect(
      resolveExpectedExtensionRuntimeFingerprint({ TEMPAD_MCP_DEV_CHECKOUT: repositoryRoot })
    ).resolves.toMatch(/^[a-f0-9]{64}$/)
    await expect(resolveExpectedExtensionRuntimeFingerprint({})).resolves.toBeNull()
  })

  it('publishes, reads, compares, and owner-removes an atomic Hub identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tempad-runtime-identity-'))
    const entryPath = join(directory, 'hub.mjs')
    const identityPath = join(directory, 'hub-runtime.json')
    writeFileSync(entryPath, 'export const cohort = 1\n')
    const extensionFingerprint = 'a'.repeat(64)
    const identity = createHubRuntimeIdentity(entryPath, '0.8.0', extensionFingerprint, {
      now: new Date('2026-08-26T00:00:00.000Z'),
      processId: 42
    })

    writeHubRuntimeIdentity(identityPath, identity)
    expect(readHubRuntimeIdentity(identityPath)).toEqual(identity)
    expect(JSON.parse(readFileSync(identityPath, 'utf8'))).toEqual(identity)

    const legacyIdentity = JSON.parse(JSON.stringify(identity)) as Record<string, unknown>
    delete legacyIdentity.activeExtension
    writeFileSync(identityPath, JSON.stringify(legacyIdentity))
    expect(readHubRuntimeIdentity(identityPath)).toEqual({ ...identity, activeExtension: null })

    identity.activeExtension = {
      id: 'extension-1',
      connectedAt: '2026-08-26T00:01:00.000Z',
      version: '0.21.0',
      fingerprint: extensionFingerprint
    }
    writeHubRuntimeIdentity(identityPath, identity)
    expect(readHubRuntimeIdentity(identityPath)?.activeExtension).toEqual(identity.activeExtension)
    expect(
      compareHubRuntimeIdentity(identity, {
        packageVersion: '0.8.0',
        runtimeFingerprint: identity.runtimeFingerprint,
        expectedExtensionRuntimeFingerprint: extensionFingerprint
      })
    ).toEqual([])

    removeHubRuntimeIdentityIfOwned(identityPath, 7)
    expect(readHubRuntimeIdentity(identityPath)).toEqual(identity)
    removeHubRuntimeIdentityIfOwned(identityPath, 42)
    expect(readHubRuntimeIdentity(identityPath)).toBeNull()
  })

  it('rejects stale Hub and extension cohorts with deterministic issues', () => {
    const expectation = {
      packageVersion: '0.8.0',
      runtimeFingerprint: 'b'.repeat(64),
      expectedExtensionRuntimeFingerprint: 'c'.repeat(64)
    }

    expect(() => assertHubRuntimeIdentity(null, expectation)).toThrow(RuntimeIdentityMismatchError)
    expect(compareHubRuntimeIdentity(null, expectation)).toEqual([
      'Hub did not publish a valid runtime identity record'
    ])
    expect(
      compareExtensionRuntimeIdentity(undefined, expectation.expectedExtensionRuntimeFingerprint)
    ).toEqual(['Extension did not publish a runtime identity handshake'])
    expect(
      compareExtensionRuntimeIdentity(
        { version: '0.21.0', fingerprint: 'd'.repeat(64) },
        expectation.expectedExtensionRuntimeFingerprint
      )
    ).toEqual(['Active extension fingerprint differs from the development checkout'])
    expect(
      compareExtensionRuntimeIdentity(
        { version: '0.21.0', fingerprint: expectation.expectedExtensionRuntimeFingerprint },
        expectation.expectedExtensionRuntimeFingerprint
      )
    ).toEqual([])
  })
})
