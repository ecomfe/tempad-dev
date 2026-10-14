import { lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'

function inspectRoot(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return null
  }
}

function isPrivateRoot(stat, uid) {
  return stat?.isDirectory() && stat.uid === uid && (stat.mode & 0o777) === 0o700
}

function hasHubFiles(root) {
  return (
    inspectRoot(join(root, 'run', 'mcp.sock')) !== null ||
    inspectRoot(join(root, 'run', 'hub.lock.lock')) !== null
  )
}

export function resolveDefaultRoot(
  systemTmpDir = tmpdir(),
  platform = process.platform,
  uid = process.getuid?.()
) {
  const legacyRoot = join(systemTmpDir, 'tempad-dev')
  if (platform !== 'linux') return legacyRoot
  const isolatedRoot = join(systemTmpDir, `tempad-dev-${uid}`)
  const legacy = inspectRoot(legacyRoot)
  const isolated = inspectRoot(isolatedRoot)
  const legacyPrivate = isPrivateRoot(legacy, uid)
  const isolatedPrivate = isPrivateRoot(isolated, uid)
  const legacyActive = legacy?.uid === uid && hasHubFiles(legacyRoot)
  const isolatedActive = isolated?.uid === uid && hasHubFiles(isolatedRoot)
  if (
    (legacyActive && !legacyPrivate) ||
    (isolatedActive && !isolatedPrivate) ||
    (legacyActive && isolatedActive)
  )
    throw new Error(
      `Ambiguous or unsafe Hub runtime roots: ${legacyRoot}, ${isolatedRoot}. Stop the existing runtimes and correct ownership/permissions before reconnecting; automatic migration is refused.`
    )
  if (isolatedPrivate && !legacyActive) return isolatedRoot
  if (legacyPrivate || !legacy) return legacyRoot
  return isolatedRoot
}

export function prepareDefaultRoot(
  systemTmpDir = tmpdir(),
  platform = process.platform,
  uid = process.getuid?.()
) {
  const selected = resolveDefaultRoot(systemTmpDir, platform, uid)
  if (platform !== 'linux' || selected !== join(systemTmpDir, 'tempad-dev')) return selected
  // Claim the released path atomically so old installed hooks still work after a reboot.
  try {
    mkdirSync(selected, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  return resolveDefaultRoot(systemTmpDir, platform, uid)
}

export function assertTrustedSocket(
  socketPath,
  platform = process.platform,
  uid = process.getuid?.()
) {
  if (platform === 'win32') return
  const parent = lstatSync(dirname(socketPath))
  const socket = lstatSync(socketPath)
  if (
    !parent.isDirectory() ||
    parent.uid !== uid ||
    (parent.mode & 0o077) !== 0 ||
    !socket.isSocket() ||
    socket.uid !== uid ||
    (socket.mode & 0o077) !== 0
  )
    throw new Error(
      `Refusing untrusted Hub socket: ${socketPath}. Check its owner and private permissions before reconnecting.`
    )
}
