import { MCP_HASH_HEX_LENGTH, MCP_LEGACY_HASH_HEX_LENGTH } from '@tempad-dev/shared'

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto?.subtle?.digest !== 'function') {
    throw new Error('crypto.subtle.digest is unavailable in this environment.')
  }
  const input = new Uint8Array(bytes.byteLength)
  input.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function digestMatchesAssetHash(digest: string, hash: string): boolean {
  return (
    (hash.length === MCP_HASH_HEX_LENGTH && digest === hash) ||
    (hash.length === MCP_LEGACY_HASH_HEX_LENGTH && digest.startsWith(hash))
  )
}
